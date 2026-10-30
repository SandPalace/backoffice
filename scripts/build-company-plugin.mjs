#!/usr/bin/env node
// Builds this install's COMPANY plugin, so several Back Offices (one folder per company) live on one machine and each
// company's agents write to their own server and data:
//
//   dist/company-plugin/                              a local marketplace (gitignored, regenerated every time)
//     .claude-plugin/marketplace.json                 name `backoffice-<slug>`, one plugin
//     plugins/backoffice-<slug>/                      a copy of plugins/backoffice with:
//       .claude-plugin/plugin.json                    name `backoffice-<slug>`, version `<base>+<content hash>`
//       company.json                                  { name, slug, home, root, port, web_port, repo, plugin }: read FIRST by
//                                                     server/src/company-file.mjs (stdio MCP + SessionStart hook)
//       hooks/hooks.json                              HTTP hooks on this install's port, X-BackOffice-Port baked
//       .mcp.json                                     meta-browser profile under this install's data/ (no global env)
//       agents/, skills/, …                           `mcp__plugin_backoffice_` → `mcp__plugin_backoffice-<slug>_`,
//                                                     `backoffice:<id>` → `backoffice-<slug>:<id>`, ports in links
//
// The company comes from data/.env (BACKOFFICE_COMPANY, optional BACKOFFICE_COMPANY_SLUG; scripts/company.mjs setup);
// ports from env / data/.env. Without a company it does nothing (exit 0): the generic `backoffice@backoffice` serves a
// single-company install. Zero dependencies; idempotent (same input → same files and version).
//
//   node scripts/build-company-plugin.mjs [--name <empresa>] [--slug <s>] [--out <dir>] [--register] [--json]
//     --register  also `claude plugin marketplace add|update` + `claude plugin install|update backoffice-<slug>@backoffice-<slug>`
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as mp from "./migrate-plugins.mjs";
import { companyOf, slugify, validSlug, portsOf, dataDir, workspacesDir, REPO } from "./company.mjs";

export const OUT_DIR = (repo = REPO) => join(repo, "dist", "company-plugin");
const MARKER = ".backoffice-company-plugin";
const say = (m) => console.log(`    ${m}`);

// Never copied into a company plugin: tests and local junk.
const skip = (rel) => {
  const parts = rel.split(sep);
  return parts.includes("node_modules") || parts.includes(".DS_Store") || rel === join("server", "test") || rel.startsWith(join("server", "test") + sep) || rel.endsWith(".test.mjs") || rel === "company.json";
};
const TEXT = new Set([".md", ".json", ".mjs", ".js"]);

/**
 * Rewrites one text file of the copy for company `slug`. The server code (server/) is copied untouched: it finds its
 * company through company.json. Elsewhere: tool prefixes everywhere; skill/agent references and local links in Markdown.
 */
export function rewriteText(rel, text, { slug, port, web_port }) {
  if (rel.split(sep)[0] === "server") return text;
  let t = text.replaceAll("plugin_backoffice_", `plugin_backoffice-${slug}_`); // mcp__plugin_backoffice_<server>, also inside regexes
  if (rel.endsWith(".md")) {
    // `backoffice:canvas-artifacts`, `--agent backoffice:ceo` → backoffice-<slug>:… ; not X-BackOffice-*, paths, URLs,
    // `"backoffice": {` (JSON) nor an already prefixed `backoffice-<x>:`.
    t = t.replace(/(?<![\w./@-])backoffice:(?=[a-z])/g, `backoffice-${slug}:`);
    t = t.replace(/(?<![\w./@-])backoffice@backoffice\b(?!-)/g, `backoffice-${slug}@backoffice-${slug}`); // health-check expectations
    t = t.replace(/\b(localhost|127\.0\.0\.1):4780\b/g, `$1:${port}`).replace(/\b(localhost|127\.0\.0\.1):4781\b/g, `$1:${web_port}`);
    t = t.replace(/BACKOFFICE_PORT\|\|4780/g, `BACKOFFICE_PORT||${port}`);
  }
  return t;
}

/** hooks.json for this company: every HTTP hook on its port, the port header baked (not from the global env). */
export function companyHooks(hooks, { port }) {
  const h = structuredClone(hooks);
  for (const groups of Object.values(h.hooks ?? {}))
    for (const g of groups)
      for (const x of g.hooks ?? []) {
        if (x.type !== "http") continue;
        x.url = String(x.url).replace(/^http:\/\/(127\.0\.0\.1|localhost):\d+/, `http://127.0.0.1:${port}`);
        x.headers = { "X-BackOffice-Port": String(port), "X-BackOffice-Workspace": "$BACKOFFICE_WORKSPACE" };
        x.allowedEnvVars = ["BACKOFFICE_WORKSPACE"];
      }
  h.description = `${h.description ?? ""} Company plugin: hooks go to this company's server only (port ${port}).`.trim();
  return h;
}

/** .mcp.json for this company: `${BACKOFFICE_HOME}` (global env, one per machine) → this install's data/ folder. */
export function companyMcp(mcp, { home }) {
  return JSON.parse(JSON.stringify(mcp).replaceAll("${BACKOFFICE_HOME}", home.replaceAll("\\", "/")));
}

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const rel = relative(base, full);
    if (skip(rel)) continue;
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/**
 * Generates the marketplace in `out` for company `c` ({ name, slug, port, web_port, home, root, repo }). Returns
 * { out, plugin, marketplace, version, dir }. Throws when `out` exists and was not made by this script.
 */
export function buildCompanyPlugin(c, { repo = REPO, out = OUT_DIR(repo) } = {}) {
  if (!validSlug(c?.slug)) throw new Error(`nombre corto inválido: «${c?.slug}»`);
  const src = join(repo, "plugins", "backoffice");
  const name = `backoffice-${c.slug}`;
  const base = JSON.parse(readFileSync(join(src, ".claude-plugin", "plugin.json"), "utf8"));
  if (existsSync(out)) {
    if (!existsSync(join(out, MARKER))) throw new Error(`${out} existe y no lo generó este script; no lo toco`);
    rmSync(out, { recursive: true, force: true });
  }
  const dir = join(out, "plugins", name);
  const company = { name: c.name, slug: c.slug, home: c.home, root: c.root, port: c.port, web_port: c.web_port, repo: c.repo ?? repo, plugin: name };
  const hash = createHash("sha256");
  for (const rel of walk(src)) {
    if (rel === join(".claude-plugin", "plugin.json")) continue;
    const from = join(src, rel);
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    let body;
    if (rel === join("hooks", "hooks.json")) body = JSON.stringify(companyHooks(JSON.parse(rewriteText(rel, readFileSync(from, "utf8"), c)), c), null, 2) + "\n";
    else if (rel === ".mcp.json") body = JSON.stringify(companyMcp(JSON.parse(readFileSync(from, "utf8")), c), null, 2) + "\n";
    else if (TEXT.has(extname(rel))) body = rewriteText(rel, readFileSync(from, "utf8"), c);
    if (body !== undefined) writeFileSync(to, body);
    else copyFileSync(from, to);
    hash.update(rel.split(sep).join("/")).update("\0").update(body ?? readFileSync(from)).update("\0");
  }
  const companyJson = JSON.stringify(company, null, 2) + "\n";
  writeFileSync(join(dir, "company.json"), companyJson);
  hash.update(companyJson);
  const version = `${base.version}+${hash.digest("hex").slice(0, 10)}`;
  const plugin = {
    ...base,
    name,
    version,
    description: `Back Office · ${c.name} (${name}): ${base.description} This copy works only with ${c.name}'s Back Office folder (${company.repo}, port ${c.port}).`,
  };
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  const market = {
    name,
    owner: { name: "Back Office" },
    description: `Back Office · ${c.name}: los equipos de agentes de esta empresa (carpeta ${company.repo}, puerto ${c.port}).`,
    plugins: [
      {
        name,
        source: `./plugins/${name}`,
        description: `Back Office · ${c.name}: el Assistant y todos los equipos de agentes, conectados al Back Office de ${c.name} (puerto ${c.port}).`,
        author: { name: "Back Office" },
      },
    ],
  };
  mkdirSync(join(out, ".claude-plugin"), { recursive: true });
  writeFileSync(join(out, ".claude-plugin", "marketplace.json"), JSON.stringify(market, null, 2) + "\n");
  writeFileSync(join(out, MARKER), `Generado por scripts/build-company-plugin.mjs para ${c.name}. No editar: se regenera en cada ./bin/backoffice update.\n`);
  return { out, dir, plugin: name, marketplace: name, version, company };
}

/**
 * Registers the generated marketplace and installs/updates its plugin with the `claude` CLI. A marketplace of the same
 * name at another existing folder is ANOTHER company with the same short name: refused (never stolen). Claude keys its
 * plugin cache by version, so a plugin whose version changed is reinstalled (uninstall + install). Returns true when
 * `backoffice-<slug>@backoffice-<slug>` ends up installed at this version.
 */
export function registerCompanyPlugin(built, env = process.env) {
  if (mp.envOf(env, "SKIP_CLAUDE") === "1") {
    say(`Plugin ${built.plugin}: omitido (BACKOFFICE_SKIP_CLAUDE=1).`);
    return true;
  }
  const { out, marketplace: mk, version } = built;
  const id = `${built.plugin}@${mk}`;
  const first = (x) => (x.err || x.out).trim().split("\n")[0];
  const add = () => {
    const a = mp.claude(["plugin", "marketplace", "add", out], env);
    say(a.ok ? `Registré el marketplace ${mk} (${out}).` : `!! No pude registrar el marketplace ${mk}: ${first(a)}. A mano: claude plugin marketplace add "${out}"`);
    return a.ok;
  };
  const reg = mp.registeredMarketplace(env, mk);
  if (reg === null || reg === undefined) {
    if (!add() && reg === undefined) mp.claude(["plugin", "marketplace", "update", mk], env);
  } else if (reg.path && mp.sameDir(reg.path, out)) {
    const u = mp.claude(["plugin", "marketplace", "update", mk], env);
    say(u.ok ? `Marketplace ${mk} actualizado.` : `!! No pude actualizar el marketplace ${mk}: ${first(u)}.`);
  } else if (reg.path && existsSync(reg.path)) {
    say(`!! Ya hay otra empresa registrada como ${mk} (${reg.path}). Elige otro nombre corto: BACKOFFICE_COMPANY_SLUG=<otro> en data/.env y corre ./bin/backoffice update.`);
    return false;
  } else {
    mp.claude(["plugin", "marketplace", "remove", mk], env); // its folder is gone (moved): register it here
    say(`El marketplace ${mk} apuntaba a una carpeta que ya no existe (${reg.path || reg.source || "?"}); lo registro aquí.`);
    add();
  }
  const before = mp.installedPlugins(env) ?? [];
  const cur = before.find((x) => x.id === id);
  let r;
  if (!cur) r = mp.claude(["plugin", "install", id], env);
  else if (cur.version === version) r = mp.claude(["plugin", "update", id], env);
  else {
    mp.claude(["plugin", "uninstall", id, ...(cur.scope ? ["--scope", String(cur.scope)] : [])], env);
    r = mp.claude(["plugin", "install", id, ...(cur.scope && cur.scope !== "user" ? ["--scope", String(cur.scope)] : [])], env);
  }
  const after = (mp.installedPlugins(env) ?? []).find((x) => x.id === id);
  const ok = !!after && (after.version == null || after.version === version);
  say(ok ? `Plugin ${id} ${cur ? "actualizado" : "instalado"} (${version}).` : `!! No quedó instalado ${id}: ${first(r)}. A mano: claude plugin marketplace add "${out}" y claude plugin install ${id}`);
  return ok;
}

/**
 * With a company plugin installed, the generic `backoffice@backoffice` of THIS folder would show every agent twice
 * (backoffice:ceo and backoffice-<slug>:ceo) and post hooks to port 4780 (maybe another company's server). Offer to
 * remove it: `answer` 'yes' | 'no' | undefined (ask on a terminal; otherwise only explain). A generic plugin that belongs
 * to another folder is left alone. Returns 'removed' | 'kept' | 'absent' | 'other-folder'.
 */
export async function offerRemoveGeneric(env = process.env, repo = REPO, answer = (mp.envOf(env, "REMOVE_GENERIC") || "").toLowerCase()) {
  if (mp.envOf(env, "SKIP_CLAUDE") === "1") return "absent";
  const id = `${mp.PLUGIN}@${mp.MARKETPLACE}`;
  const inst = mp.installedPlugins(env) ?? [];
  if (!inst.some((x) => x.id === id)) return "absent";
  const reg = mp.registeredMarketplace(env, mp.MARKETPLACE);
  if (reg?.path && !mp.sameDir(reg.path, repo) && existsSync(reg.path)) return "other-folder";
  let yes = ["yes", "si", "sí", "s", "y", "1"].includes(answer);
  if (!answer && process.stdin.isTTY) {
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = (await rl.question(`    Ya tienes el plugin de tu empresa. ¿Quito el plugin genérico ${id} para no ver cada agente dos veces? [S/n] `)).trim().toLowerCase();
    rl.close();
    yes = !["n", "no"].includes(a);
  }
  if (!yes) {
    say(`Sigue instalado el plugin genérico ${id} (cada agente aparece dos veces: backoffice:<agente> y el de tu empresa). Para quitarlo: claude plugin uninstall ${id}`);
    return "kept";
  }
  const r = mp.claude(["plugin", "uninstall", id], env);
  if (!r.ok) {
    say(`!! No pude quitar ${id}. A mano: claude plugin uninstall ${id}`);
    return "kept";
  }
  if (reg?.path && mp.sameDir(reg.path, repo)) mp.claude(["plugin", "marketplace", "remove", mp.MARKETPLACE], env);
  say(`Quité el plugin genérico ${id}: ahora usas solo el de tu empresa.`);
  return "removed";
}

const arg = (args, f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
export async function main(args = process.argv.slice(2), env = process.env, repo = REPO) {
  let c = companyOf(repo, env);
  const name = arg(args, "--name");
  if (name) {
    const slug = arg(args, "--slug") || slugify(name);
    c = { name, slug, ...portsOf(repo, env), home: dataDir(repo, env), root: workspacesDir(repo, env), repo };
  }
  if (!c) {
    if (args.includes("--json")) console.log(JSON.stringify({ company: null }));
    else say("Sin empresa en data/.env (BACKOFFICE_COMPANY): se usa el plugin genérico backoffice@backoffice.");
    return 0;
  }
  const outArg = arg(args, "--out");
  const built = buildCompanyPlugin(c, { repo, out: outArg ? resolve(outArg) : OUT_DIR(repo) });
  if (args.includes("--json")) console.log(JSON.stringify(built));
  else say(`Plugin de ${c.name}: ${built.plugin} ${built.version} en ${built.out}`);
  if (!args.includes("--register")) return 0;
  return registerCompanyPlugin(built, env) ? 0 : 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain)
  main()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.log(`    !! Plugin de empresa: ${e.message}`);
      process.exit(1);
    });
