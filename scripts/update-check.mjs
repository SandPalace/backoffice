#!/usr/bin/env node
// Read-only diagnosis before updating Back Office (skill `update-backoffice`). It changes nothing: the only network/git side
// effect is `git fetch origin main` (updates origin/main; --no-fetch skips it). It reads Claude's own config files
// (settings.json, installed_plugins.json, known_marketplaces.json, Claude Desktop config and the Back Office extension
// settings) but only the Back Office entries, and never opens data/.env or the MCP key. Zero dependencies. Mac, Windows, Linux.
//
//   node scripts/update-check.mjs                 diagnosis of this folder, in Spanish
//   node scripts/update-check.mjs --json          the same as JSON: { plan, then, reasons, notes, facts }
//   node scripts/update-check.mjs --dir <folder>  diagnose another folder (e.g. when running the latest copy of this
//                                                 script from `git show origin/main:scripts/update-check.mjs`)
//   --no-fetch                                    do not contact the remote (offline; the latest version is then unknown)
//
// Plans (decision table; SKILL.md maps each one to exact commands):
//   blocked                        no Node 22.13+/node:sqlite, no git, not enough disk, offline, or not an install
//   not-a-clone-reinstall          the folder is not a git clone (hand-copied): clone fresh beside it, copy data
//   diverged-ask                   local commits + new remote commits, another branch, or another remote: stop and ask
//   stash-then-update              files that come from the repo were edited (or untracked files would be overwritten)
//   move-then-update               installed outside Documents/AgentOS (e.g. ~/AgentOS-app): offer the move first
//   migrate-old-layout-then-update ~/.agentos or ~/AgentOS (layout before 2026-10-16) still exists
//   fast-forward                   clean and behind origin/main
//   up-to-date                     nothing to pull (notes may still ask for a repair: old plugins, paths elsewhere)
// `then` is the update step after a preparatory plan (fast-forward | up-to-date | null when unknown).
//
// Env: HOME/USERPROFILE, APPDATA, LOCALAPPDATA, CLAUDE_CONFIG_DIR, BACKOFFICE_PORT (4780), BACKOFFICE_WEB_PORT (4781),
// BACKOFFICE_OFFICIAL_REMOTE (an extra remote URL/path accepted as official and used to read the latest version; tests).
// Their AGENTOS_* names still count (rename compat).
//
// AgentOS → Back Office: this script also diagnoses a folder from before the rename (plugins/agentos, data/agentos.db,
// the `.agentos-export` marker, plugin agentos@agentos, `mcpServers.agentos`, AGENTOS_* in settings.json). The update
// migrates those (migrate-plugins.mjs → migrate-backoffice.mjs); here they only show up as the `pre-rename` note.
import { existsSync, readFileSync, readdirSync, lstatSync, statfsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OFFICIAL_URL = "https://github.com/SandPalace/backoffice.git";
const OFFICIAL_OWNER = OFFICIAL_URL.split("/")[3].toLowerCase();
// Old homes of the public repo: kikirrins/agentos until 2026-10-22, SandPalace/backoffice until 2026-10-29.
// SandPalace/backoffice is now the private monorepo, so a clone still pointing there must be repointed (`old-remote`).
const OLD_REMOTES = ["kikirrins/agentos", "sandpalace/agentos"];
const RAW_PLUGIN_JSON = "https://raw.githubusercontent.com/SandPalace/backoffice/main/plugins/backoffice/.claude-plugin/plugin.json";
const PLUGIN_JSON = "plugins/backoffice/.claude-plugin/plugin.json";
const OLD_PLUGIN_JSON = "plugins/agentos/.claude-plugin/plugin.json"; // a folder or commit from before the rename
/** Old plugin ids (all in the pre-rename marketplace `agentos`): the single `agentos` and the 7 before 2026-10-22. */
export const OLD_PLUGINS = ["agentos", "agentos-core", "marketing-team", "sales-team", "collections-team", "executive-team", "finance-team", "dev-team"];
const envOf = (env, k) => env[`BACKOFFICE_${k}`] || env[`AGENTOS_${k}`] || "";
export const MIN_NODE = [22, 13];
const GB = 1e9;
export const MIN_FREE = 1.5 * GB; // npm ci + next build + a little headroom; the backup size is added on top

// ── small helpers ──
const homeOf = (env) => env.HOME || env.USERPROFILE || "";
const canon = (p, win = process.platform === "win32") => {
  let r;
  try { r = realpathSync.native(p); } catch { r = resolve(p); }
  return win ? r.toLowerCase() : r;
};
export const sameDir = (a, b) => !!a && !!b && canon(a) === canon(b);
const inside = (p, dir) => !!p && !!dir && (sameDir(p, dir) || canon(p).startsWith(canon(dir) + sep));
const readJson = (f) => {
  try { return JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return null; }
};
const isBackofficeFolder = (x) =>
  existsSync(join(x, ".claude-plugin", "marketplace.json")) && (existsSync(join(x, "plugins", "backoffice")) || existsSync(join(x, "plugins", "agentos")));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: opts.timeout ?? 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env }, cwd: opts.cwd, windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || "").trimEnd(), err: (r.stderr || (r.error ? r.error.message : "")).trim(), missing: r.error?.code === "ENOENT" };
};
const git = (dir, ...args) => run("git", ["-C", dir, "-c", "core.quotepath=off", ...args], { timeout: args[0] === "fetch" ? 90000 : 20000 });
const versionOf = (text) => { try { return JSON.parse(text).version || null; } catch { return null; } };

/** -1 | 0 | 1 for dotted versions ("1.2.0" < "1.10.0"). */
export function cmpVersion(a, b) {
  const pa = String(a || "0").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Is `url` the public Back Office repo? `old` = the pre-2026-10-22 kikirrins/agentos (GitHub redirects it). */
export function classifyRemote(url, extra = "") {
  const u = String(url || "").trim();
  if (!u) return { official: false, old: false };
  if (extra && (u === extra || sameDir(u, extra))) return { official: true, old: false };
  const m = u.match(/github\.com[:/]+([^/]+)\/(agentos|backoffice)(?:\.git)?\/?$/i);
  if (!m) return { official: false, old: false };
  const slug = `${m[1]}/${m[2]}`.toLowerCase();
  const old = OLD_REMOTES.includes(slug);
  return { official: old || slug === `${OFFICIAL_OWNER}/backoffice`, old };
}

/** Bytes under `dir` (no symlinks followed). Stops counting after `limit` entries so a huge folder cannot stall it. */
export function dirSize(dir, limit = 400000) {
  let bytes = 0, n = 0, truncated = false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let es;
    try { es = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      if (++n > limit) { truncated = true; stack.length = 0; break; }
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { bytes += lstatSync(p).size; } catch { /* vanished */ } }
    }
  }
  return { bytes, truncated };
}

// ── facts ──
function nodeFacts() {
  const v = process.versions.node.split(".").map(Number);
  const okVersion = v[0] > MIN_NODE[0] || (v[0] === MIN_NODE[0] && v[1] >= MIN_NODE[1]);
  return { version: process.versions.node, ok: okVersion, required: MIN_NODE.join(".") };
}

async function hasSqlite() {
  try { await import("node:sqlite"); return true; } catch { return false; }
}

async function latestFromRemote(extra) {
  // A local path (tests, or a mirror): read main straight from it. Otherwise the public raw file.
  if (extra && existsSync(extra)) {
    const gd = existsSync(join(extra, ".git")) ? join(extra, ".git") : extra;
    let r = run("git", ["--git-dir", gd, "show", `main:${PLUGIN_JSON}`]);
    if (!r.ok) r = run("git", ["--git-dir", gd, "show", `main:${OLD_PLUGIN_JSON}`]);
    return r.ok ? { version: versionOf(r.out), error: null } : { version: null, error: r.err.split("\n")[0] };
  }
  try {
    const res = await fetch(RAW_PLUGIN_JSON, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { version: null, error: `HTTP ${res.status}` };
    return { version: versionOf(await res.text()), error: null };
  } catch (e) {
    return { version: null, error: e.cause?.code || e.message };
  }
}

function repoFacts(dir, { doFetch, extra }) {
  const f = { isGit: false, toplevel: null, insideOtherRepo: false, remote: null, official: false, oldRemote: false, branch: null, detached: false,
    head: null, fetched: false, fetchError: null, remoteRef: null, ahead: 0, behind: 0, localVersion: null, headVersion: null, latestVersion: null,
    dirty: [], untracked: [], untrackedConflicts: [], dirtyTouchedByUpdate: [], incoming: [] };
  const pj = [PLUGIN_JSON, OLD_PLUGIN_JSON].find((x) => existsSync(join(dir, x)));
  f.localVersion = versionOf(pj ? readFileSync(join(dir, pj), "utf8") : "");
  const top = git(dir, "rev-parse", "--show-toplevel");
  if (!top.ok) return f;
  f.toplevel = resolve(top.out);
  if (!sameDir(f.toplevel, dir)) { f.insideOtherRepo = true; return f; }
  f.isGit = true;
  f.remote = git(dir, "remote", "get-url", "origin").out || null;
  Object.assign(f, (({ official, old }) => ({ official, oldRemote: old }))(classifyRemote(f.remote, extra)));
  const br = git(dir, "symbolic-ref", "--quiet", "--short", "HEAD");
  f.branch = br.ok ? br.out : null;
  f.detached = !br.ok;
  f.head = git(dir, "rev-parse", "--short", "HEAD").out || null;
  const showVersion = (ref) => versionOf(git(dir, "show", `${ref}:${PLUGIN_JSON}`).out) || versionOf(git(dir, "show", `${ref}:${OLD_PLUGIN_JSON}`).out);
  f.headVersion = showVersion("HEAD");
  if (f.remote && doFetch) {
    const r = git(dir, "fetch", "--quiet", "--no-tags", "origin", "main");
    f.fetched = r.ok;
    if (!r.ok) f.fetchError = (r.err || "git fetch falló").split("\n").filter(Boolean).pop();
  }
  const ref = ["origin/main", "FETCH_HEAD"].find((x) => git(dir, "rev-parse", "--verify", "--quiet", `${x}^{commit}`).ok);
  f.remoteRef = ref || null;
  if (ref) {
    const c = git(dir, "rev-list", "--left-right", "--count", `HEAD...${ref}`).out.split(/\s+/).map(Number);
    f.ahead = c[0] || 0;
    f.behind = c[1] || 0;
    f.latestVersion = showVersion(ref);
    if (f.behind) f.incoming = git(dir, "diff", "--name-only", `HEAD...${ref}`).out.split("\n").filter(Boolean);
  }
  // Tracked changes vs untracked files (data/, workspaces/, backups/ are ignored and never listed).
  for (const line of git(dir, "status", "--porcelain=v1", "--untracked-files=all").out.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2), path = line.slice(3).replace(/^.* -> /, "");
    if (code === "??") f.untracked.push(path);
    else f.dirty.push({ status: code.trim(), path });
  }
  const inc = new Set(f.incoming);
  f.untrackedConflicts = f.untracked.filter((p) => inc.has(p));
  f.dirtyTouchedByUpdate = f.dirty.map((d) => d.path).filter((p) => inc.has(p));
  return f;
}

function layoutFacts(dir, env) {
  const home = homeOf(env);
  const candidates = [join(home, "Documents", "AgentOS")];
  if (env.OneDrive) candidates.push(join(env.OneDrive, "Documents", "AgentOS"), join(env.OneDrive, "Documentos", "AgentOS"));
  const tail = canon(dir).split(/[\\/]/).slice(-2).join("/").toLowerCase();
  const inDocuments = candidates.some((c) => sameDir(c, dir)) || tail === "documents/agentos" || tail === "documentos/agentos";
  const expected = candidates[0];
  const oldHome = join(home, ".agentos"), oldRoot = join(home, "AgentOS");
  return {
    expected,
    inDocuments,
    documentsTaken: !inDocuments && existsSync(expected) && !sameDir(expected, dir),
    appFolder: basename(dir) === "AgentOS-app",
    oldHome: existsSync(oldHome) && !sameDir(oldHome, dir) ? oldHome : null,
    // ~/AgentOS is the OLD workspaces root unless it is the Back Office install itself.
    oldRoot: existsSync(oldRoot) && !sameDir(oldRoot, dir) && !isBackofficeFolder(oldRoot) ? oldRoot : null,
  };
}

function desktopDirs(env) {
  const home = homeOf(env);
  const dirs = [join(home, "Library", "Application Support", "Claude"), join(home, ".config", "Claude")];
  if (env.APPDATA) dirs.push(join(env.APPDATA, "Claude"));
  if (env.LOCALAPPDATA) {
    try {
      for (const d of readdirSync(join(env.LOCALAPPDATA, "Packages"))) if (d.startsWith("Claude_")) dirs.push(join(env.LOCALAPPDATA, "Packages", d, "LocalCache", "Roaming", "Claude"));
    } catch { /* none */ }
  }
  return [...new Set(dirs)].filter((d) => existsSync(d));
}

function claudeFacts(dir, env) {
  const cfg = env.CLAUDE_CONFIG_DIR || join(homeOf(env), ".claude");
  const out = { settingsFile: join(cfg, "settings.json"), settingsEnv: {}, envPointsHere: null, allowRule: false, oldAllowRule: false,
    backofficeInstalled: false, installedVersion: null, oldPlugins: [], marketplacePath: null, marketplaceHere: null, oldMarketplace: false, desktop: [], extension: null,
    oldEnvNames: false };
  const s = readJson(out.settingsFile);
  if (s) {
    for (const k of ["BACKOFFICE_HOME", "BACKOFFICE_ROOT", "AGENTOS_HOME", "AGENTOS_ROOT"]) if (typeof s.env?.[k] === "string") out.settingsEnv[k] = s.env[k];
    out.oldEnvNames = Object.keys(s.env && typeof s.env === "object" ? s.env : {}).some((k) => k.startsWith("AGENTOS_"));
    const vals = Object.values(out.settingsEnv);
    out.envPointsHere = vals.length ? vals.every((v) => inside(v, dir)) : null;
    const allow = Array.isArray(s.permissions?.allow) ? s.permissions.allow : [];
    out.allowRule = allow.includes("mcp__plugin_backoffice_backoffice");
    out.oldAllowRule = allow.some((r) => typeof r === "string" && r.startsWith("mcp__plugin_agentos")); // -core_ or the pre-rename _agentos
  }
  const inst = readJson(join(cfg, "plugins", "installed_plugins.json"));
  const plugins = inst?.plugins && typeof inst.plugins === "object" ? inst.plugins : {};
  for (const [id, entries] of Object.entries(plugins)) {
    if (id === "backoffice@backoffice") {
      out.backofficeInstalled = true;
      out.installedVersion = (Array.isArray(entries) ? entries : [entries]).map((e) => e?.version).filter(Boolean).pop() || null;
    }
    if (OLD_PLUGINS.some((o) => id === `${o}@agentos`)) out.oldPlugins.push(id);
  }
  const kms = readJson(join(cfg, "plugins", "known_marketplaces.json"));
  out.oldMarketplace = !!kms?.agentos;
  const km = kms?.backoffice ?? kms?.agentos;
  if (km) {
    out.marketplacePath = km.source?.path || km.installLocation || null;
    out.marketplaceHere = out.marketplacePath ? sameDir(out.marketplacePath, dir) : null;
  }
  for (const d of desktopDirs(env)) {
    const c = readJson(join(d, "claude_desktop_config.json"));
    const e = c?.mcpServers?.backoffice ?? c?.mcpServers?.agentos;
    if (e) {
      const mcp = (Array.isArray(e.args) ? e.args : []).find((a) => typeof a === "string" && /mcp\.mjs$/.test(a)) || null;
      out.desktop.push({ file: join(d, "claude_desktop_config.json"), mcpPath: mcp, pointsHere: mcp ? inside(mcp, dir) && existsSync(mcp) : null,
        oldPath: mcp ? /plugins[\\/]agentos/.test(mcp) : false, oldKey: !c.mcpServers.backoffice });
    }
    // The desktop extension: backoffice.mcpb, or agentos.mcpb from before the rename (setting agentos_folder).
    const ext = readJson(join(d, "Claude Extensions Settings", "local.mcpb.backoffice.backoffice.json")) ?? readJson(join(d, "Claude Extensions Settings", "local.mcpb.agentos.agentos.json"));
    if (ext && !out.extension) {
      const folder = ext.userConfig?.backoffice_folder || ext.userConfig?.agentos_folder || null;
      out.extension = { enabled: ext.isEnabled !== false, folder, pointsHere: folder ? sameDir(folder, dir) : null };
    }
  }
  return out;
}

/** Which folder a listening process runs from (server.mjs / next path in its command line, else its cwd). */
function processFolder(pid) {
  if (!pid) return null;
  let cmd = "", cwd = "";
  if (process.platform === "win32") {
    cmd = run("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`]).out;
  } else {
    cmd = run("ps", ["-o", "command=", "-p", String(pid)]).out;
    const l = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).out.split("\n").find((x) => x.startsWith("n"));
    cwd = l ? l.slice(1) : "";
  }
  const m = cmd.match(/(\S+?)[\\/]plugins[\\/](?:backoffice|agentos(?:-core)?)[\\/]server[\\/]src[\\/]server\.mjs/) || cmd.match(/(\S+?)[\\/]web[\\/]node_modules[\\/]next[\\/]/);
  if (m) return m[1].replace(/^["']/, "");
  if (cwd) return /[\\/]web$/.test(cwd) ? dirname(cwd) : cwd;
  return null;
}

function portPid(port) {
  if (process.platform === "win32") {
    const r = run("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`]);
    return Number(r.out) || null;
  }
  const r = run("lsof", ["-nP", "-t", `-iTCP:${Number(port)}`, "-sTCP:LISTEN"]);
  return Number(r.out.split("\n")[0]) || null;
}

async function probe(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).status > 0; } catch { return false; }
}

async function runningFacts(dir, env) {
  const out = {};
  for (const [k, port, path] of [["server", Number(envOf(env, "PORT") || 4780), "/health"], ["web", Number(envOf(env, "WEB_PORT") || 4781), "/"]]) {
    const up = await probe(`http://127.0.0.1:${port}${path}`);
    const pid = up ? portPid(port) : null;
    const folder = processFolder(pid);
    out[k] = { port, up, pid, folder, here: folder ? sameDir(folder, dir) : null };
  }
  return out;
}

function diskFacts(dir, needBackup) {
  try {
    const s = statfsSync(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    const need = MIN_FREE + needBackup;
    return { free, need, ok: free >= need };
  } catch {
    return { free: null, need: null, ok: true };
  }
}

/** Everything the decision needs. `fetch: false` = offline. */
export async function collect({ dir = REPO, fetch: doFetch = true, env = process.env } = {}) {
  dir = resolve(dir);
  const extra = envOf(env, "OFFICIAL_REMOTE");
  const gv = run("git", ["--version"]);
  const facts = {
    dir,
    platform: process.platform,
    isBackofficeFolder: isBackofficeFolder(dir),
    oldPluginFolder: existsSync(join(dir, "plugins", "agentos")) && !existsSync(join(dir, "plugins", "backoffice")),
    exportMarker: existsSync(join(dir, ".backoffice-export")) || existsSync(join(dir, ".agentos-export")), // .agentos-export: before the rename
    node: { ...nodeFacts(), sqlite: await hasSqlite() },
    git: { available: gv.ok, version: gv.ok ? gv.out.replace(/^git version /, "") : null },
  };
  facts.repo = repoFacts(dir, { doFetch: doFetch && gv.ok, extra });
  if (!facts.repo.isGit && doFetch) {
    const l = await latestFromRemote(extra);
    facts.repo.latestVersion = l.version;
    facts.repo.fetchError = l.error;
  }
  const data = join(dir, "data"), ws = join(dir, "workspaces");
  const ds = existsSync(data) ? dirSize(data) : { bytes: 0, truncated: false };
  const wsz = existsSync(ws) ? dirSize(ws) : { bytes: 0, truncated: false };
  const dbFile = [join(data, "backoffice.db"), join(data, "agentos.db")].find((x) => existsSync(x)); // agentos.db: not migrated yet
  facts.data = { dir: data, exists: existsSync(data), bytes: ds.bytes, truncated: ds.truncated, db: !!dbFile, dbBytes: dbFile ? lstatSync(dbFile).size : 0,
    oldDbName: !!dbFile && basename(dbFile) === "agentos.db" };
  let projects = 0;
  try { projects = readdirSync(ws, { withFileTypes: true }).filter((e) => e.isDirectory()).length; } catch { /* none */ }
  facts.workspaces = { dir: ws, exists: existsSync(ws), bytes: wsz.bytes, truncated: wsz.truncated, projects };
  facts.backups = (() => { try { return readdirSync(join(dir, "backups")).filter((n) => /^(?:backoffice|agentos)-\d{8}-\d{6}$/.test(n)).sort(); } catch { return []; } })();
  facts.webBuilt = existsSync(join(dir, "web", ".next"));
  facts.layout = layoutFacts(dir, env);
  facts.claude = claudeFacts(dir, env);
  facts.running = await runningFacts(dir, env);
  facts.disk = diskFacts(dir, facts.data.bytes + facts.workspaces.bytes);
  return facts;
}

// ── decision (pure: unit-tested) ──
/** { plan, then, reasons[], notes[] } from the facts. The first matching row of the decision table wins. */
export function decide(f) {
  const reasons = [], notes = [];
  const r = f.repo || {};
  if (!f.node?.ok || f.node?.sqlite === false) reasons.push("node-too-old");
  if (!f.git?.available) reasons.push("no-git");
  if (f.disk && f.disk.ok === false) reasons.push("low-disk");
  if (!f.isBackofficeFolder) reasons.push("not-backoffice-folder");
  if (r.insideOtherRepo && !f.exportMarker) reasons.push("inside-other-repo");

  // Notes never change the plan; most are fixed by `./bin/backoffice update` (migrate-plugins) or need a word with the person.
  const c = f.claude || {};
  if (c.oldPlugins?.length) notes.push("old-plugins");
  if (c.oldAllowRule) notes.push("old-allow-rule");
  // Anything still named the AgentOS way (the update migrates it in place: migrate-backoffice.mjs).
  if (f.oldPluginFolder || f.data?.oldDbName || c.oldEnvNames || c.oldMarketplace || (c.desktop || []).some((d) => d.oldKey)) notes.push("pre-rename");
  if (c.marketplaceHere === false) notes.push("marketplace-elsewhere");
  if (c.envPointsHere === false) notes.push("env-elsewhere");
  if ((c.desktop || []).some((d) => d.pointsHere === false)) notes.push("desktop-mcp-elsewhere");
  if (c.extension && c.extension.enabled !== false && c.extension.pointsHere === false) notes.push("extension-elsewhere"); // a disabled one is harmless
  for (const k of ["server", "web"]) if (f.running?.[k]?.up && f.running[k].here === false) notes.push(`${k}-running-elsewhere`);
  if (f.running?.server?.up || f.running?.web?.up) notes.push("office-running");
  if (r.oldRemote) notes.push("old-remote");
  if (f.webBuilt === false) notes.push("web-not-built");
  if (r.ahead > 0 && !r.behind) notes.push("local-commits");
  if (!f.data?.exists && !f.workspaces?.exists) notes.push("no-data");
  if (f.layout?.documentsTaken) notes.push("documents-taken");
  const repair = notes.some((n) => ["old-plugins", "old-allow-rule", "pre-rename", "marketplace-elsewhere", "env-elsewhere", "desktop-mcp-elsewhere", "web-not-built"].includes(n));

  const out = (plan, then = null) => ({ plan, then, reasons, notes, repair });
  if (reasons.length) return out("blocked");
  if (!r.isGit) {
    reasons.push(r.insideOtherRepo ? "copy-inside-other-repo" : "not-git");
    if (r.fetchError) notes.push("latest-unknown");
    return out("not-a-clone-reinstall");
  }
  if (!r.official) { reasons.push("foreign-remote"); return out("diverged-ask"); }
  if (r.fetchError || !r.remoteRef) { reasons.push("fetch-failed"); return out("blocked"); }
  if (r.detached || r.branch !== "main") { reasons.push("not-on-main"); return out("diverged-ask"); }
  if (r.ahead > 0 && r.behind > 0) { reasons.push("diverged"); return out("diverged-ask"); }
  const then = r.behind > 0 ? "fast-forward" : "up-to-date";
  if (r.dirty?.length) reasons.push("tracked-changes");
  if (r.untrackedConflicts?.length) reasons.push("untracked-would-be-overwritten");
  if (reasons.length) return out("stash-then-update", then);
  if (!f.layout?.inDocuments) { reasons.push(f.layout?.appFolder ? "app-folder" : "outside-documents"); return out("move-then-update", then); }
  if (f.layout?.oldHome || f.layout?.oldRoot) { reasons.push("old-layout"); return out("migrate-old-layout-then-update", then); }
  reasons.push(then === "fast-forward" ? "behind" : "current");
  return out(then);
}

// ── human output (Spanish) ──
const size = (b) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const PLAN_ES = {
  "up-to-date": "ya estás en la versión más nueva",
  "fast-forward": "actualizar con git pull --ff-only (limpio, solo faltan cambios nuevos)",
  "stash-then-update": "hay archivos del repo editados: preguntar si se guardan aparte (git stash) antes de actualizar",
  "move-then-update": "Back Office está fuera de Documentos/AgentOS: ofrecer moverlo y luego actualizar",
  "migrate-old-layout-then-update": "quedan carpetas de la estructura vieja (~/.agentos o ~/AgentOS): migrarlas y actualizar",
  "diverged-ask": "la historia local no coincide con la nueva (commits propios, otra rama u otro remoto): parar y preguntar",
  "not-a-clone-reinstall": "esta carpeta no es un clon de git: clonar limpio a un lado y copiar data/ y workspaces/",
  blocked: "no se puede actualizar todavía (ver motivos)",
};

export function render(f, d) {
  const r = f.repo, L = [];
  L.push(`Carpeta de Back Office: ${f.dir}${f.layout.inDocuments ? "" : "  (fuera de Documentos/AgentOS)"}`);
  L.push(`Git: ${r.isGit ? `clon de ${r.remote || "(sin remoto)"}${r.oldRemote ? " (dirección vieja, GitHub redirige)" : ""}, rama ${r.branch || "(sin rama)"} @ ${r.head}` : r.insideOtherRepo ? `esta carpeta está DENTRO de otro repo git (${r.toplevel}), no es un clon propio` : f.git.available ? "esta carpeta NO es un clon de git" : "git no está instalado"}`);
  L.push(`Versión: local ${r.localVersion || "?"} → nueva ${r.latestVersion || "(desconocida)"}${r.isGit && r.remoteRef ? ` · ${r.behind} commits nuevos, ${r.ahead} propios` : ""}${r.fetchError ? ` · no pude consultar: ${r.fetchError}` : ""}`);
  L.push(`Datos: data/ ${f.data.exists ? size(f.data.bytes) : "no existe"}${f.data.db ? ` (base de datos ${size(f.data.dbBytes)})` : ""} · workspaces/ ${f.workspaces.exists ? `${size(f.workspaces.bytes)}, ${f.workspaces.projects} carpetas` : "no existe"} · respaldos: ${f.backups.length}`);
  if (r.dirty.length) L.push(`Archivos del repo editados (${r.dirty.length}): ${r.dirty.slice(0, 8).map((x) => x.path).join(", ")}${r.dirty.length > 8 ? ", …" : ""}`);
  if (r.untrackedConflicts.length) L.push(`Archivos sueltos que la actualización pisaría: ${r.untrackedConflicts.join(", ")}`);
  if (f.layout.oldHome || f.layout.oldRoot) L.push(`Estructura vieja: ${[f.layout.oldHome, f.layout.oldRoot].filter(Boolean).join(", ")}`);
  const c = f.claude;
  L.push(`Claude: plugin backoffice@backoffice ${c.backofficeInstalled ? `instalado (${c.installedVersion || "?"})` : "NO instalado"}${c.oldPlugins.length ? ` · plugins viejos: ${c.oldPlugins.join(", ")}` : ""}${c.marketplaceHere === false ? ` · marketplace apunta a ${c.marketplacePath}` : ""}`);
  for (const x of c.desktop) if (x.pointsHere === false) L.push(`Claude Desktop: el MCP backoffice apunta a ${x.mcpPath}`);
  if (c.extension?.pointsHere === false) L.push(`Extensión Back Office de Claude Desktop: carpeta ${c.extension.folder}`);
  if (c.envPointsHere === false) L.push(`~/.claude/settings.json: BACKOFFICE_HOME/ROOT apuntan a otra carpeta (${Object.values(c.settingsEnv).join(", ")})`);
  for (const [k, n] of [["server", "Servidor"], ["web", "Oficina web"]]) {
    const x = f.running[k];
    L.push(`${n}: ${x.up ? `corriendo en ${x.port}${x.folder ? ` desde ${x.folder}${x.here === false ? " (OTRA carpeta)" : ""}` : ""}` : "detenido"}`);
  }
  L.push(`Disco libre: ${f.disk.free == null ? "?" : size(f.disk.free)}${f.disk.ok ? "" : ` (hacen falta ~${size(f.disk.need)})`} · Node ${f.node.version}${f.node.ok && f.node.sqlite ? "" : ` (se necesita ${f.node.required}+)`} · git ${f.git.version || "no"}`);
  L.push("");
  L.push(`Plan recomendado: ${d.plan}${d.then ? ` → ${d.then}` : ""} — ${PLAN_ES[d.plan]}`);
  L.push(`Motivos: ${d.reasons.join(", ") || "-"}${d.notes.length ? ` · notas: ${d.notes.join(", ")}` : ""}${d.repair ? " · reparar config con ./bin/backoffice update" : ""}`);
  L.push("(Diagnóstico de solo lectura: no cambié nada.)");
  return L.join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  const i = a.indexOf("--dir");
  const facts = await collect({ dir: i >= 0 ? a[i + 1] : REPO, fetch: !a.includes("--no-fetch") });
  const d = decide(facts);
  if (a.includes("--json")) console.log(JSON.stringify({ version: 1, ...d, facts }, null, 2));
  else console.log(render(facts, d));
}
