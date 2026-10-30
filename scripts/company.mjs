#!/usr/bin/env node
// One Back Office per company, several on one machine: this install's company name/slug and port pair, saved in
// data/.env (BACKOFFICE_COMPANY, BACKOFFICE_COMPANY_SLUG, BACKOFFICE_PORT, BACKOFFICE_WEB_PORT). The launchers read the
// ports from there, scripts/build-company-plugin.mjs bakes them into the company plugin, scripts/build-mcpb.mjs into the
// desktop extension. Zero dependencies. Messages to the person are Spanish.
//
//   node scripts/company.mjs setup [--name "Acme"] [--slug acme]   installers: saves the company (if given) and a port pair
//        (kept if already saved; an existing install keeps 4780/4781; a new one gets the first free pair not used by
//        another Back Office: 4780/4781, 4782/4783, …). Prints shell lines BACKOFFICE_PORT=… BACKOFFICE_WEB_PORT=…
//        BACKOFFICE_COMPANY_SLUG=… (values are digits / [a-z0-9-] only, safe to eval). Name also from env BACKOFFICE_COMPANY.
//   node scripts/company.mjs set-env KEY…   writes those keys into data/.env from the env vars of the same name (0600;
//        values never on the command line). The installers use it for BACKOFFICE_USER / BACKOFFICE_PASSWORD.
//   node scripts/company.mjs show [--json]  this install's company (or «sin empresa») and ports.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as mp from "./migrate-plugins.mjs";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PORT = 4780;
export const DEFAULT_WEB_PORT = 4781;

/** «Panadería Doña Ana, S.A.» → `panaderia-dona-ana-s-a` (lowercase ASCII, digits and single dashes, max 40). */
export function slugify(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
export const validSlug = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);
const validPort = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1024 && n < 65535 ? n : null;
};

// ── data/.env ──
/** Parses KEY=VALUE lines (same rules as the server's parseEnv: `export`, quotes and comments allowed). */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}
export function readEnvFile(file) {
  try {
    const v = parseEnv(readFileSync(file, "utf8").replace(/^﻿/, ""));
    for (const k of Object.keys(v)) // written before the rename: AGENTOS_* counts as BACKOFFICE_*
      if (k.startsWith("AGENTOS_") && v[`BACKOFFICE_${k.slice(8)}`] === undefined) v[`BACKOFFICE_${k.slice(8)}`] = v[k];
    return v;
  } catch {
    return {};
  }
}
/** Sets (or replaces) keys in an env file, keeping every other line. A value with a newline is refused. Mode 0600. */
export function setEnvKeys(file, kv) {
  for (const [k, v] of Object.entries(kv))
    if (/[\r\n]/.test(String(v))) throw new Error(`${k}: el valor no puede tener saltos de línea`);
  mkdirSync(dirname(file), { recursive: true });
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const keys = new Set(Object.keys(kv));
  const kept = lines.filter((l) => {
    const m = l.trim().replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return !(m && keys.has(m[1]));
  });
  for (const [k, v] of Object.entries(kv)) kept.push(`${k}=${v}`);
  writeFileSync(file, kept.join("\n") + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
}

/** data/ of this install (BACKOFFICE_HOME unless it belongs to another Back Office folder). */
export function dataDir(repo = REPO, env = process.env) {
  const v = mp.envOf(env, "HOME");
  return v && !mp.foreignPath(v, "data", repo) ? v : join(repo, "data");
}
export function workspacesDir(repo = REPO, env = process.env) {
  const v = mp.envOf(env, "ROOT");
  return v && !mp.foreignPath(v, "workspaces", repo) ? v : join(repo, "workspaces");
}
export const envFile = (repo = REPO, env = process.env) => join(dataDir(repo, env), ".env");

/** Ports of this install: env (the launcher exports them) > data/.env > 4780/4781. */
export function portsOf(repo = REPO, env = process.env) {
  const f = readEnvFile(envFile(repo, env));
  return {
    port: validPort(mp.envOf(env, "PORT")) ?? validPort(f.BACKOFFICE_PORT) ?? DEFAULT_PORT,
    web_port: validPort(mp.envOf(env, "WEB_PORT")) ?? validPort(f.BACKOFFICE_WEB_PORT) ?? DEFAULT_WEB_PORT,
  };
}

/**
 * This install's company: { name, slug, port, web_port, home, root, repo, plugin } or null when it has no company
 * (single-company install: the generic plugin `backoffice@backoffice`).
 */
export function companyOf(repo = REPO, env = process.env) {
  const f = readEnvFile(envFile(repo, env));
  const name = String(f.BACKOFFICE_COMPANY ?? "").trim();
  if (!name) return null;
  const slug = validSlug(f.BACKOFFICE_COMPANY_SLUG) ? f.BACKOFFICE_COMPANY_SLUG : slugify(name);
  if (!validSlug(slug)) return null;
  return { name, slug, ...portsOf(repo, env), home: dataDir(repo, env), root: workspacesDir(repo, env), repo, plugin: `backoffice-${slug}` };
}

// ── Ports ──
/** Is 127.0.0.1:<port> free to listen on? */
export function portFree(port) {
  return new Promise((done) => {
    const s = createServer();
    s.once("error", () => done(false));
    s.listen(port, "127.0.0.1", () => s.close(() => done(true)));
  });
}

/**
 * Ports used by OTHER Back Offices on this machine, running or not: every registered company marketplace
 * (`backoffice-<slug>` → its company.json), the generic `backoffice` marketplace of another folder (its data/.env or
 * 4780/4781), and Claude Desktop `mcpServers.backoffice*` entries of other folders.
 */
export function claimedPorts(repo = REPO, env = process.env) {
  const out = new Set();
  const add = (...ps) => ps.map(validPort).filter(Boolean).forEach((p) => out.add(p));
  const mine = (p) => typeof p === "string" && p && (mp.sameDir(p, repo) || resolve(p).startsWith(resolve(repo) + sep));
  const r = mp.claude(["plugin", "marketplace", "list", "--json"], env);
  if (r.ok) {
    let arr = [];
    try {
      const v = JSON.parse(r.out);
      arr = Array.isArray(v) ? v : Array.isArray(v?.marketplaces) ? v.marketplaces : [];
    } catch {
      /* none */
    }
    for (const m of arr) {
      const p = m?.path ?? m?.installLocation;
      if (typeof m?.name !== "string" || typeof p !== "string" || mine(p)) continue;
      if (m.name === "backoffice") {
        if (!existsSync(p)) continue;
        const f = readEnvFile(join(p, "data", ".env"));
        add(f.BACKOFFICE_PORT ?? DEFAULT_PORT, f.BACKOFFICE_WEB_PORT ?? DEFAULT_WEB_PORT);
      } else if (m.name.startsWith("backoffice-")) {
        try {
          const c = JSON.parse(readFileSync(join(p, "plugins", m.name, "company.json"), "utf8"));
          if (!mine(c.repo)) add(c.port, c.web_port);
        } catch {
          /* not a company plugin */
        }
      }
    }
  }
  for (const f of mp.desktopConfigs(env)) {
    try {
      const s = JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")).mcpServers ?? {};
      for (const [k, e] of Object.entries(s)) {
        if (!/^backoffice(-|$)/.test(k) || !e?.env) continue;
        if (mine(e.env.BACKOFFICE_HOME)) continue;
        add(e.env.BACKOFFICE_PORT ?? (k === "backoffice" ? DEFAULT_PORT : null), e.env.BACKOFFICE_WEB_PORT ?? (k === "backoffice" ? DEFAULT_WEB_PORT : null));
      }
    } catch {
      /* unreadable: migrate-plugins reports it */
    }
  }
  return out;
}

/** First pair (p, p+1) from `start`, stepping by 2, with neither port claimed nor busy. */
export async function pickPorts({ start = DEFAULT_PORT, claimed = new Set(), free = portFree, tries = 50 } = {}) {
  for (let i = 0, p = start; i < tries; i++, p += 2) {
    if (claimed.has(p) || claimed.has(p + 1)) continue;
    if ((await free(p)) && (await free(p + 1))) return { port: p, web_port: p + 1 };
  }
  throw new Error(`no encontré dos puertos libres a partir de ${start}`);
}

/**
 * Installer step: saves the company (when `name` is given) and a port pair in data/.env. Ports already saved (or set in
 * env) are kept; an existing install (it has a database) keeps 4780/4781 so updating never moves it; a new install gets
 * the first free pair not claimed by another Back Office. Returns { company, slug, port, web_port, picked }.
 */
export async function setup({ repo = REPO, env = process.env, name, slug, free = portFree, claimed } = {}) {
  const file = envFile(repo, env);
  const cur = readEnvFile(file);
  const kv = {};
  name = String(name ?? mp.envOf(env, "COMPANY") ?? "").trim();
  if (/[\r\n]/.test(name)) throw new Error("el nombre no puede tener saltos de línea");
  if (name) {
    const s = slug || (cur.BACKOFFICE_COMPANY === name && validSlug(cur.BACKOFFICE_COMPANY_SLUG) ? cur.BACKOFFICE_COMPANY_SLUG : slugify(name));
    if (!validSlug(s)) throw new Error(`«${name}» no sirve como nombre corto (usa letras o números)`);
    if (cur.BACKOFFICE_COMPANY !== name) kv.BACKOFFICE_COMPANY = name;
    if (cur.BACKOFFICE_COMPANY_SLUG !== s) kv.BACKOFFICE_COMPANY_SLUG = s;
  }
  let port = validPort(mp.envOf(env, "PORT")) ?? validPort(cur.BACKOFFICE_PORT);
  let web = validPort(mp.envOf(env, "WEB_PORT")) ?? validPort(cur.BACKOFFICE_WEB_PORT);
  let picked = false;
  if (!port && !web) {
    const existing = ["backoffice.db", "agentos.db"].some((f) => existsSync(join(dirname(file), f)));
    if (existing) ({ port, web } = { port: DEFAULT_PORT, web: DEFAULT_WEB_PORT });
    else {
      const p = await pickPorts({ claimed: claimed ?? claimedPorts(repo, env), free });
      ({ port, web } = { port: p.port, web: p.web_port });
      picked = true;
    }
  } else if (!web) web = port + 1;
  else if (!port) port = web - 1;
  if (String(cur.BACKOFFICE_PORT) !== String(port)) kv.BACKOFFICE_PORT = String(port);
  if (String(cur.BACKOFFICE_WEB_PORT) !== String(web)) kv.BACKOFFICE_WEB_PORT = String(web);
  if (Object.keys(kv).length) setEnvKeys(file, kv);
  const after = readEnvFile(file);
  const company = String(after.BACKOFFICE_COMPANY ?? "").trim() || null;
  return {
    company,
    slug: company ? (validSlug(after.BACKOFFICE_COMPANY_SLUG) ? after.BACKOFFICE_COMPANY_SLUG : slugify(company)) : null,
    port,
    web_port: web,
    picked,
  };
}

const arg = (args, f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
export async function main(args = process.argv.slice(2), env = process.env) {
  const cmd = args[0];
  if (cmd === "setup") {
    const r = await setup({ env, name: arg(args, "--name"), slug: arg(args, "--slug") });
    console.log(`BACKOFFICE_PORT=${r.port}`);
    console.log(`BACKOFFICE_WEB_PORT=${r.web_port}`);
    console.log(`BACKOFFICE_COMPANY_SLUG=${r.slug ?? ""}`);
    return 0;
  }
  if (cmd === "set-env") {
    const keys = args.slice(1).filter((k) => /^[A-Z_][A-Z0-9_]*$/.test(k));
    const kv = Object.fromEntries(keys.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
    setEnvKeys(envFile(REPO, env), kv);
    return 0;
  }
  if (cmd === "show") {
    const c = companyOf(REPO, env);
    const p = portsOf(REPO, env);
    if (args.includes("--json")) console.log(JSON.stringify({ company: c, ...p }));
    else console.log(c ? `Empresa: ${c.name} (plugin ${c.plugin}), puertos ${p.port}/${p.web_port}` : `Sin empresa (plugin genérico backoffice), puertos ${p.port}/${p.web_port}`);
    return 0;
  }
  console.log("Uso: node scripts/company.mjs setup [--name <empresa>] [--slug <corto>] | set-env KEY… | show [--json]");
  return 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain)
  main()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`!! ${e.message}`);
      process.exit(1);
    });
