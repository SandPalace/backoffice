#!/usr/bin/env node
// AgentOS → Back Office: migrates an existing install IN PLACE after an update pulled the renamed code. The folder stays
// where it is; only what already exists is renamed, nothing new is registered globally. Zero dependencies. Messages to
// the person are Spanish. Idempotent and resumable: every step looks at the current state and does only what is left,
// so an interrupted run is finished by running it again (every launcher/installer runs it on each update).
//
// Called through scripts/migrate-plugins.mjs (the entry point every launcher, old or new, already calls), in this order:
//   0. Backup first, with scripts/backup-backoffice.mjs (data/ + workspaces/ → backups/backoffice-<date>/), only when
//      something from before the rename is still there. If the backup fails, nothing is changed and it exits 1.
//   1. data/agentos.db → data/backoffice.db, only with the server stopped (its pid file and /health): WAL checkpointed
//      (TRUNCATE) and integrity-checked first, the -wal/-shm sidecars renamed before the main file. While the server
//      runs, the step waits for the next update (the server keeps using agentos.db meanwhile: db.mjs dbFileIn()).
//   2. ~/.claude/settings.json and Claude Desktop (`mcpServers.agentos` → `mcpServers.backoffice`, AGENTOS_* →
//      BACKOFFICE_*, tool permissions) — migrate-plugins.mjs steps 1, 2, 2b.
//   3. Claude Code: agentos@agentos (and the 7 older plugins) + the `agentos` marketplace → backoffice@backoffice —
//      migrate-plugins.mjs step 3, driven through the `claude` CLI.
//   4. Agent definitions edited in Back Office (Equipos → editor) before the rename: <workspace>/.claude/agents/<id>.md and
//      <claude config>/agents/<id>.md of roster agents get the new tool names (their `tools` allowlist would otherwise
//      block every Back Office tool). A `.backoffice-backup` copy of each changed file is kept.
//   5. What the person still has to do by hand (Claude Desktop/Cowork), printed in Spanish.
//
//   node scripts/migrate-plugins.mjs [--no-claude] [--plugins-only] [--no-settings] [--no-desktop] [--from-npm]
//   (flags as in migrate-plugins.mjs; --no-backup skips step 0, for tests only)
//
// Env: those of migrate-plugins.mjs, plus BACKOFFICE_PORT (4780; the server whose /health is checked) and
// BACKOFFICE_LAUNCHER (set by launchers from this version on). AGENTOS_LAUNCHER without BACKOFFICE_LAUNCHER = a launcher
// from before the rename is running this: it restarts the server with the old plugins/agentos path, so the server is
// started here with the new one (its own start is then a no-op) — same hand-off as legacyHandoff() below.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  renameSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as mp from "./migrate-plugins.mjs";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DB = "backoffice.db";
export const OLD_DB = "agentos.db";
const SIDECARS = ["-wal", "-shm", "-journal"];

const say = (m) => console.log(`    ${m}`);

// ── Where the data is ──
/** data/ and workspaces/ of this install: BACKOFFICE_HOME/ROOT (or the old names) unless they belong to another location. */
export function dataDirs(env = process.env, repo = REPO) {
  const pick = (k, sub) => {
    const v = mp.envOf(env, k);
    return v && !mp.foreignPath(v, sub, repo) ? v : join(repo, sub);
  };
  return { data: pick("HOME", "data"), workspaces: pick("ROOT", "workspaces") };
}

// ── Is the server of this install running? ──
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
async function healthy(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}
/** true when a server may be using the database: its pid file names a live process, or /health answers on its port. */
export async function serverRunning(data, env = process.env) {
  try {
    const pid = Number(readFileSync(join(data, "run", "server.pid"), "utf8").trim());
    if (pid > 0 && alive(pid)) return true;
  } catch {
    /* no pid file */
  }
  return healthy(Number(mp.envOf(env, "PORT") || 4780));
}

// ── Step 1: the database file ──
/**
 * data/agentos.db → data/backoffice.db. Returns 'renamed' | 'none' (nothing to rename) | 'conflict' (both exist: neither
 * is touched, the server uses backoffice.db) | 'busy' (server running: try again on the next update) | 'error: …'.
 * Resumable: the sidecars move before the main file, so an interrupted run leaves agentos.db (still the one in use) and
 * the next run finishes it; after the checkpoint the -wal is empty anyway.
 */
export async function renameDb(data, env = process.env, { running = serverRunning } = {}) {
  const oldF = join(data, OLD_DB), newF = join(data, DB);
  if (!existsSync(oldF)) return "none";
  if (existsSync(newF)) return "conflict";
  if (await running(data, env)) return "busy";
  const { DatabaseSync } = await import("node:sqlite");
  try {
    const db = new DatabaseSync(oldF);
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const ok = db.prepare("PRAGMA quick_check").get();
      if (Object.values(ok)[0] !== "ok") return `error: quick_check dice ${Object.values(ok)[0]}`;
    } finally {
      db.close();
    }
    for (const s of SIDECARS) {
      if (existsSync(oldF + s) && !existsSync(newF + s)) renameSync(oldF + s, newF + s);
    }
    renameSync(oldF, newF);
    const check = new DatabaseSync(newF, { readOnly: true });
    try {
      check.prepare("SELECT COUNT(*) FROM sqlite_master").get();
    } finally {
      check.close();
    }
    return "renamed";
  } catch (e) {
    return `error: ${e.message}`;
  }
}

// ── Step 4: agent definitions edited before the rename ──
/** The text of an agent definition with the pre-rename tool/skill/agent ids replaced. */
export function renameAgentText(t) {
  return t
    .replace(/mcp__plugin_agentos(?:-core)?_agentos/g, mp.NEW_RULE)
    .replace(/mcp__plugin_agentos_(playwright|meta-ads|meta-browser)/g, "mcp__plugin_backoffice_$1")
    .replace(/\bagentos_([a-z][a-z_]*)/g, "backoffice_$1")
    .replace(/\bagentos:([a-z])/g, "backoffice:$1");
}
const NEEDS = /mcp__plugin_agentos|\bagentos_[a-z]|\bagentos:[a-z]/;

/** Folders that may hold agent copies: <claude config>/agents and <root>/.claude/agents of every workspace. */
async function agentDirs(env, repo, data, workspaces) {
  const dirs = [join(env.CLAUDE_CONFIG_DIR || join(env.HOME || env.USERPROFILE || "", ".claude"), "agents")];
  const roots = new Set([join(workspaces, "default")]);
  try {
    for (const e of readdirSync(workspaces, { withFileTypes: true })) if (e.isDirectory()) roots.add(join(workspaces, e.name));
  } catch {
    /* none */
  }
  const file = [join(data, DB), join(data, OLD_DB)].find((f) => existsSync(f));
  if (file) {
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        for (const { root } of db.prepare("SELECT root FROM workspaces WHERE root IS NOT NULL").all()) roots.add(root);
      } finally {
        db.close();
      }
    } catch {
      /* old schema or busy: the folders above still count */
    }
  }
  for (const r of roots) dirs.push(join(r, ".claude", "agents"));
  return [...new Set(dirs)];
}

/** Rewrites the agent copies of roster agents that still use the old ids. Returns the list of files changed. */
export async function migrateAgentDefs(env = process.env, repo = REPO, dirs = dataDirs(env, repo)) {
  const ids = new Set();
  try {
    for (const f of readdirSync(join(repo, "plugins", "backoffice", "agents"))) if (f.endsWith(".md")) ids.add(f.slice(0, -3));
  } catch {
    return [];
  }
  const changed = [];
  for (const d of await agentDirs(env, repo, dirs.data, dirs.workspaces)) {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".md") || !ids.has(n.slice(0, -3))) continue; // only Back Office's own agents
      const f = join(d, n);
      try {
        if (!statSync(f).isFile() || statSync(f).size > 256 * 1024) continue;
        const t = readFileSync(f, "utf8");
        if (!NEEDS.test(t)) continue;
        if (!existsSync(`${f}.backoffice-backup`)) copyFileSync(f, `${f}.backoffice-backup`);
        writeFileSync(f, renameAgentText(t));
        changed.push(f);
      } catch (e) {
        say(`!! No pude actualizar ${f}: ${e.message}`);
      }
    }
  }
  return changed;
}

// ── Is there anything from before the rename? ──
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const hasOldEnv = (e) => !!e && typeof e === "object" && Object.keys(e).some((k) => k.startsWith("AGENTOS_"));
const hasOldRule = (p) => ["allow", "ask", "deny"].some((k) => Array.isArray(p?.[k]) && p[k].some((r) => typeof r === "string" && r.startsWith("mcp__plugin_agentos")));
/** What is still named the old way: [] when the install is fully migrated (or never had the old names). */
export function leftovers(env = process.env, repo = REPO, dirs = dataDirs(env, repo)) {
  const out = [];
  if (existsSync(join(dirs.data, OLD_DB))) out.push(`data/${OLD_DB}`);
  const s = readJson(mp.settingsFile(env));
  if (hasOldEnv(s?.env) || hasOldRule(s?.permissions)) out.push("settings.json");
  for (const f of mp.desktopConfigs(env)) {
    const c = readJson(f);
    if (c?.mcpServers?.agentos || hasOldEnv(c?.mcpServers?.backoffice?.env)) out.push(f);
  }
  return out;
}

// ── Step 5 ──
export const MANUAL_STEPS = [
  "AgentOS ahora se llama Back Office. Lo que falta, a mano:",
  "  1. Cierra y vuelve a abrir tus sesiones de Claude Code (las herramientas nuevas se cargan al iniciar).",
  "  2. Claude Desktop / Cowork: si agregaste el plugin desde Personalizar → Plugins, quita «agentos» y agrega",
  "     «backoffice» desde el mismo marketplace (sincronizar de nuevo). Luego cierra y abre Claude Desktop.",
  "  3. Si usabas la extensión agentos.mcpb: en Ajustes → Extensiones desinstálala e instala dist/backoffice.mcpb",
  "     (en «Carpeta de Back Office» elige esta carpeta).",
  "  4. Codex, OpenCode o Cursor (MCP por HTTP): la dirección y la llave no cambian; si quieres, renombra el servidor",
  "     a «backoffice». Los nombres viejos de herramientas (agentos_*) siguen funcionando por una versión.",
];

// ── Old launchers ──
/** Starts this folder's server with the new path when it is not running (an old launcher would try the old path). */
async function startServer(env, data) {
  const port = Number(mp.envOf(env, "PORT") || 4780);
  if (await healthy(port)) return;
  try {
    mkdirSync(join(data, "logs"), { recursive: true });
    mkdirSync(join(data, "run"), { recursive: true });
    const log = openSync(join(data, "logs", "server.log"), "a");
    const child = spawn(process.execPath, [join(REPO, "plugins", "backoffice", "server", "src", "server.mjs")], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env,
    });
    writeFileSync(join(data, "run", "server.pid"), `${child.pid}\n`);
    child.unref();
    for (let i = 0; i < 40 && !(await healthy(port)); i++) await new Promise((r) => setTimeout(r, 250));
    say((await healthy(port)) ? `Servidor iniciado con la ruta nueva (puerto ${port}).` : `!! El servidor no arrancó; revisa ${join(data, "logs", "server.log")}.`);
  } catch (e) {
    say(`!! No pude iniciar el servidor: ${e.message}`);
  }
}
const isExport = () => existsSync(join(REPO, ".backoffice-export")) || existsSync(join(REPO, ".agentos-export"));

/** The whole migration. `args` = CLI flags. Returns the exit code. */
export async function migrate(args = [], env = process.env, repo = REPO) {
  const has = (f) => args.includes(f);
  const dirs = dataDirs(env, repo);
  const before = leftovers(env, repo, dirs);
  if (before.length) {
    console.log("\n==> AgentOS ahora se llama Back Office: migrando esta instalación (se queda en esta carpeta)");
    if (!has("--no-backup")) {
      try {
        const { backup } = await import("./backup-backoffice.mjs");
        const b = await backup({ dir: repo, data: dirs.data, workspaces: dirs.workspaces });
        say(`Respaldo antes de migrar: ${b.path}`);
      } catch (e) {
        say(`!! No pude hacer el respaldo (${e.message}): no cambié nada. Libera espacio y vuelve a correr la actualización.`);
        return 1;
      }
    }
  }
  if (!has("--plugins-only")) {
    const r = await renameDb(dirs.data, env);
    if (r === "renamed") say(`Base de datos: data/${OLD_DB} ahora es data/${DB}.`);
    else if (r === "busy") say(`Base de datos: el servidor está encendido; data/${OLD_DB} se renombra en la próxima actualización (mientras tanto se sigue usando).`);
    else if (r === "conflict") say(`!! Hay data/${OLD_DB} y data/${DB}: uso ${DB} y no toqué ${OLD_DB} (revísalo a mano; hay un respaldo en backups/).`);
    else if (r.startsWith("error")) say(`!! No pude renombrar data/${OLD_DB} (${r.slice(7)}); se sigue usando tal cual. Hay un respaldo en backups/.`);
    await mp.migrateJson(env, { settings: !has("--no-settings"), desktop: !has("--no-desktop"), repo });
  }
  const report = {};
  // A company (data/.env BACKOFFICE_COMPANY) gets its own plugin backoffice-<slug>; the generic one is left to single-company installs.
  let company = null;
  try {
    company = (await import("./company.mjs")).companyOf(repo, env);
  } catch {
    /* no company.mjs (older copy) or unreadable data/.env: generic */
  }
  let ok = has("--no-claude") ? true : mp.migrateClaudePlugins(env, repo, report, { generic: !company });
  if (company) {
    const cp = await import("./build-company-plugin.mjs");
    try {
      const built = cp.buildCompanyPlugin(company, { repo });
      say(`Plugin de ${company.name}: ${built.plugin} ${built.version} (${built.out}).`);
      if (!has("--no-claude")) {
        if (!cp.registerCompanyPlugin(built, env)) ok = false;
        else await cp.offerRemoveGeneric(env, repo);
      }
    } catch (e) {
      say(`!! No pude generar el plugin de ${company.name}: ${e.message}`);
      ok = false;
    }
  }
  if (!has("--plugins-only")) {
    const defs = await migrateAgentDefs(env, repo, dirs);
    if (defs.length) say(`Agentes editados antes del cambio de nombre: actualicé ${defs.length} (respaldo .backoffice-backup): ${defs.join(", ")}`);
  }
  if (before.length || report.removedOld) {
    console.log("");
    for (const l of MANUAL_STEPS) say(l);
  }
  if (env.AGENTOS_LAUNCHER && !env.BACKOFFICE_LAUNCHER && !has("--plugins-only")) await startServer(env, dirs.data);
  return ok ? 0 : 1;
}

// The bin/agentos and agentos.ps1 from before 1.0 cannot run new code: the shell already loaded the old script before
// `git pull` replaced it. The one new code they run is `npm ci` in web/, so web/package.json's `postinstall` calls
// migrate-plugins.mjs with --from-npm. It acts only in a student copy (export marker) and only when no launcher or
// installer is running (they set BACKOFFICE_LAUNCHER / AGENTOS_LAUNCHER and migrate themselves). It never fails npm.
async function legacyHandoff(env = process.env) {
  if (!isExport() || env.BACKOFFICE_LAUNCHER || env.AGENTOS_LAUNCHER) return 0;
  await migrate([], env);
  await startServer(env, dataDirs(env).data);
  say("Si ahora ves avisos de «plugin not found» para agentos-core, marketing-team, etc., ignóralos: ya son un solo plugin.");
  say("La próxima vez usa ./bin/backoffice update (Windows .\\bin\\backoffice.cmd update): ya trae esta migración.");
  return 0;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--from-npm")) {
    try {
      return await legacyHandoff();
    } catch (e) {
      console.log(`    !! Migración: ${e.message}`);
      return 0;
    }
  }
  return migrate(args);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().then((code) => process.exit(code));
