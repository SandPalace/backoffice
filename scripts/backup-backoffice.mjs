#!/usr/bin/env node
// Backs up the person's Back Office data before an update: data/ (database, files, logins, logs, WhatsApp) and workspaces/
// (every project folder) into <Back Office folder>/backups/backoffice-<YYYYMMDD-HHMMSS>/, which the student .gitignore ignores
// (/backups/): a backup never enters git history. Keeps the newest 3 backups (--keep N). Zero dependencies.
//
//   node scripts/backup-backoffice.mjs                       back up this folder's data/ and workspaces/
//   node scripts/backup-backoffice.mjs --dir <Back Office folder> [--data <dir>] [--workspaces <dir>] [--out <dir>] [--keep 3] [--json]
//   ./bin/backoffice backup   (Windows .\bin\backoffice.cmd backup) passes the folders it resolved (old layout included).
//
// The database is copied with SQLite's online backup (node:sqlite `backup()`, or `VACUUM INTO` on older Node), so the
// copy is consistent even while the server is running; every other file is copied as is. Regenerable folders
// (node_modules, .next, browser caches) and run/ (pid files) are skipped. backup.json records the row count of every
// table so a restore can be checked. Restore = stop Back Office, rename data/ aside, copy the backup's data/ back.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statfsSync,
  utimesSync,
  chmodSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "Cache", "Code Cache", "GPUCache", "DawnCache", "ShaderCache"]);
// backoffice.db, and agentos.db: its name before the AgentOS → Back Office rename (an install backed up before migrating).
const DB_NAMES = ["backoffice.db", "agentos.db"];
const DB_FILES = new Set(DB_NAMES.flatMap((n) => [n, `${n}-wal`, `${n}-shm`, `${n}-journal`]));
// Backups made before the rename are named agentos-<date>: they count (and rotate) like the new ones.
export const BACKUP_RE = /^(?:backoffice|agentos)-\d{8}-\d{6}$/;

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Bytes and files under `dir`, with the same skips as the copy. */
export function measure(dir, top = true) {
  let bytes = 0, files = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || (top && e.name === "run")) continue;
      const m = measure(p, false);
      bytes += m.bytes;
      files += m.files;
    } else if (e.isFile()) {
      try {
        bytes += lstatSync(p).size;
        files++;
      } catch { /* vanished */ }
    }
  }
  return { bytes, files };
}

/** Recursive copy that never follows symlinks, skips sockets and regenerable folders, and keeps going on errors. */
function copyTree(src, dst, { top = true, skipTop = new Set(), stats }) {
  mkdirSync(dst, { recursive: true });
  let entries;
  try {
    entries = readdirSync(src, { withFileTypes: true });
  } catch (e) {
    stats.errors.push(`${src}: ${e.code || e.message}`);
    return;
  }
  for (const e of entries) {
    const s = join(src, e.name), d = join(dst, e.name);
    if (top && skipTop.has(e.name)) continue;
    try {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        copyTree(s, d, { top: false, stats });
      } else if (e.isFile()) {
        copyFileSync(s, d);
        const st = lstatSync(s);
        utimesSync(d, st.atime, st.mtime);
        stats.files++;
        stats.bytes += st.size;
      } // symlinks, sockets, fifos: not data (browser singleton locks, etc.)
    } catch (e2) {
      stats.errors.push(`${s}: ${e2.code || e2.message}`);
    }
  }
}

/** Consistent copy of a SQLite database (works while the server writes to it). Returns the method used. */
export async function backupDb(src, dst, { forceVacuum = false } = {}) {
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(src, { readOnly: true });
  try {
    if (typeof sqlite.backup === "function" && !forceVacuum) {
      await sqlite.backup(db, dst);
      return "sqlite-backup";
    }
    db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
    return "vacuum-into";
  } finally {
    db.close();
  }
}

/** { table: rowCount } of a database (opened read-only). */
export async function tableCounts(file) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    return Object.fromEntries(names.map((n) => [n, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${n.replace(/"/g, '""')}"`).get().n)]));
  } finally {
    db.close();
  }
}

/** Backups of `out` made by this script, newest first. */
export function listBackups(out) {
  try {
    return readdirSync(out)
      .filter((n) => BACKUP_RE.test(n) && existsSync(join(out, n, "backup.json")))
      .sort()
      .reverse()
      .map((n) => join(out, n));
  } catch {
    return [];
  }
}

export async function backup({ dir = REPO, data, workspaces, out, keep = 3, now = new Date() } = {}) {
  dir = resolve(dir);
  data = resolve(data || join(dir, "data"));
  workspaces = resolve(workspaces || join(dir, "workspaces"));
  out = resolve(out || join(dir, "backups"));
  if (!existsSync(data) && !existsSync(workspaces)) throw new Error(`no encontré datos que respaldar (${data}, ${workspaces})`);
  const need = measure(data).bytes + measure(workspaces).bytes;
  mkdirSync(out, { recursive: true });
  try {
    const fs = statfsSync(out);
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (free < need * 1.1 + 50e6) throw new Error(`no hay espacio: el respaldo necesita ~${mb(need)} y hay ${mb(free)} libres`);
  } catch (e) {
    if (e.message.startsWith("no hay espacio")) throw e;
  }
  let t = now.getTime(), name = `backoffice-${stamp(now)}`;
  while (existsSync(join(out, name))) name = `backoffice-${stamp(new Date((t += 1000)))}`; // two backups in one second
  const target = join(out, name);
  mkdirSync(target, { recursive: true });
  try { chmodSync(target, 0o700); } catch { /* Windows */ }
  const stats = { files: 0, bytes: 0, errors: [] };
  const manifest = { createdAt: now.toISOString(), source: { dir, data, workspaces }, db: null };
  if (existsSync(data)) {
    copyTree(data, join(target, "data"), { skipTop: new Set([...DB_FILES, "run"]), stats });
    // Every database file there (normally one). `db` describes the one the server uses: backoffice.db, else agentos.db.
    for (const name of DB_NAMES) {
      const dbFile = join(data, name);
      if (!existsSync(dbFile)) continue;
      const dst = join(target, "data", name);
      const method = await backupDb(dbFile, dst);
      // A self-contained single file (no -wal/-shm beside it); the server switches it back to WAL when it opens it.
      const { DatabaseSync } = await import("node:sqlite");
      const c = new DatabaseSync(dst);
      c.exec("PRAGMA journal_mode = DELETE");
      c.close();
      const info = { file: name, method, bytes: lstatSync(dst).size, tables: await tableCounts(dst) };
      if (!manifest.db) manifest.db = info;
      else (manifest.otherDbs ??= []).push(info);
      stats.files++;
      stats.bytes += info.bytes;
    }
  }
  if (existsSync(workspaces)) copyTree(workspaces, join(target, "workspaces"), { stats });
  for (const plugin of ["backoffice", "agentos"]) { // plugins/agentos: a folder from before the rename
    try {
      manifest.version = JSON.parse(readFileSync(join(dir, "plugins", plugin, ".claude-plugin", "plugin.json"), "utf8")).version;
      break;
    } catch { /* older folder */ }
  }
  Object.assign(manifest, { files: stats.files, bytes: stats.bytes, errors: stats.errors });
  writeFileSync(join(target, "backup.json"), JSON.stringify(manifest, null, 2) + "\n");
  const removed = [];
  for (const old of listBackups(out).slice(Math.max(1, keep))) {
    rmSync(old, { recursive: true, force: true });
    removed.push(old);
  }
  return { path: target, ...manifest, removed };
}

const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  try {
    const r = await backup({ dir: opt("--dir"), data: opt("--data"), workspaces: opt("--workspaces"), out: opt("--out"), keep: Number(opt("--keep") || 3) });
    if (a.includes("--json")) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`Respaldo listo: ${r.path}`);
      console.log(`  ${r.files} archivos, ${mb(r.bytes)}${r.db ? ` · base de datos (${r.db.method}): ${Object.keys(r.db.tables).length} tablas` : " · sin base de datos"}`);
      if (r.errors.length) console.log(`  !! ${r.errors.length} archivos no se pudieron copiar (el primero: ${r.errors[0]})`);
      for (const x of r.removed) console.log(`  Borré un respaldo viejo (se guardan los 3 más nuevos): ${x}`);
      console.log("  (está en backups/, que git ignora: nunca se sube ni se borra al actualizar)");
    }
  } catch (e) {
    console.error(`No pude hacer el respaldo: ${e.message}`);
    process.exit(1);
  }
}
