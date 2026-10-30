#!/usr/bin/env node
// Imports ONE workspace (company) of an old install (AgentOS or Back Office, any layout) into THIS install's `default`
// workspace: one Back Office per company. The old install is only read (its database is opened read-only; nothing there is
// modified, moved or deleted). Zero dependencies (Node 24 node:sqlite).
//
//   node scripts/import-agentos.mjs --from <old install folder>                 plan (shows what would be copied; changes nothing)
//   node scripts/import-agentos.mjs --from <old> --list                         the old workspaces with counts (to ask which company this is)
//   node scripts/import-agentos.mjs --from <old> --workspace <id> --yes         copy it (server stopped; backs up this install first)
//   options: --json (machine output) · --dir <Back Office folder> (default: this folder; for tests)
//
// Old database: <from>/data/backoffice.db, <from>/data/agentos.db, <from>/backoffice.db|agentos.db (a data folder), a .db
// file, else ~/.agentos/backoffice.db|agentos.db (old layout). Old store: <folder of that database>/store/.
// With several non-archived workspaces and no --workspace, it lists them and exits 0 (the agent asks the person).
//
// What is copied (workspace_id → 'default', bucket ws-<old> → ws-default): tasks, outputs, teams + team_members, leads,
// artifacts + artifact_versions + artifact_comments, wa_messages, wa_drafts, issue_reports, the Assistant (coo) row of
// workspace_agents (only empty target fields), user_profile (only empty target fields) and profile_insights. Not copied:
// sessions, events, auth_sessions, settings. Text primary keys use INSERT OR IGNORE; autoincrement tables are checked by
// natural key, so running it twice copies nothing new. Files: store/ws-<old>/** (and its .meta sidecars) →
// store/ws-default/**, and the old workspace's disk folder → workspaces/default/ (without overwriting; node_modules, .git
// and .next skipped). Absolute outputs.path / tasks.output_dir inside the old folder are rewritten to the new one.
import {
  existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, utimesSync, realpathSync, mkdtempSync, rmSync, constants,
} from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { pathInside } from '../plugins/backoffice/server/src/paths.mjs' // also folds AGENTOS_* env into BACKOFFICE_*

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.next'])
const FACTORY_NAMES = new Set(['Back Office', 'Default', 'AgentOS', ''])
const DB_NAMES = ['backoffice.db', 'agentos.db']
const bucketOf = (ws) => `ws-${ws}`

class ImportError extends Error {}

// ── Locate things ──

/** The old install's database file, or null. */
export function findOldDb(from, home = homedir()) {
  const f = resolve(from)
  const cands = []
  if (existsSync(f) && lstatSync(f).isFile()) cands.push(f)
  for (const n of DB_NAMES) cands.push(join(f, 'data', n))
  for (const n of DB_NAMES) cands.push(join(f, n))
  for (const n of DB_NAMES) cands.push(join(home, '.agentos', n))
  return cands.find((c) => existsSync(c) && lstatSync(c).isFile()) || null
}

/** This install's data/ and workspaces/ (env BACKOFFICE_HOME/ROOT only when they point inside this folder). */
export function targetPaths(dir = REPO, env = process.env) {
  dir = resolve(dir)
  const inside = (v, sub) => (v && pathInside(v, dir) ? resolve(v) : join(dir, sub))
  const data = inside(env.BACKOFFICE_HOME, 'data'), root = inside(env.BACKOFFICE_ROOT, 'workspaces')
  return { dir, data, root, defaultRoot: join(root, 'default') }
}

const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }

// ── Old database (read-only) ──

const tableExists = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
const hasCol = (db, t, c) => tableExists(db, t) && cols(db, t).includes(c)
const count = (db, sql, ...a) => Number(db.prepare(sql).get(...a)?.n ?? 0)

/** Files under `dir` (not following symlinks; `.meta`/`.tmp` excluded at the top). */
function countFiles(dir) {
  let n = 0
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    if (e.isDirectory()) n += countFiles(join(dir, e.name))
    else if (e.isFile()) n++
  }
  return n
}

/** Workspaces of the old database with counts. A database from before workspaces has only `default`. */
export function listWorkspaces(db, store) {
  const rows = tableExists(db, 'workspaces')
    ? db.prepare('SELECT id, name, root, archived_at FROM workspaces ORDER BY created_at, id').all()
    : [{ id: 'default', name: 'Default', root: null, archived_at: null }]
  const per = (t, ws) => {
    if (!tableExists(db, t)) return 0
    if (!hasCol(db, t, 'workspace_id')) return ws === 'default' ? count(db, `SELECT COUNT(*) AS n FROM ${t}`) : 0
    return count(db, `SELECT COUNT(*) AS n FROM ${t} WHERE workspace_id = ?`, ws)
  }
  return rows.map((w) => ({
    id: w.id, name: w.name, root: w.root, archived: !!w.archived_at,
    counts: { tasks: per('tasks', w.id), leads: per('leads', w.id), artifacts: per('artifacts', w.id), teams: per('teams', w.id), files: countFiles(join(store, bucketOf(w.id))) },
  }))
}

// ── Is this install's server running? (pid file or /health, like migrate-backoffice.mjs) ──

function envFilePort(data) {
  try {
    const txt = readFileSync(join(data, '.env'), 'utf8')
    const m = txt.match(/^\s*(?:BACKOFFICE|AGENTOS)_PORT\s*=\s*"?(\d+)"?/m)
    return m ? Number(m[1]) : null
  } catch { return null }
}
export async function serverRunning(data, env = process.env) {
  try {
    const pid = Number(readFileSync(join(data, 'run', 'server.pid'), 'utf8').trim())
    if (pid > 0) { try { process.kill(pid, 0); return true } catch (e) { if (e.code === 'EPERM') return true } }
  } catch { /* no pid file */ }
  const port = Number(env.BACKOFFICE_PORT || envFilePort(data) || 4780)
  try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) })).ok } catch { return false }
}

// ── Files ──

/**
 * Copies the tree `src` into `dst` without overwriting (or only counts, when dry). Never follows symlinks; skips
 * node_modules/.git/.next and every absolute path in `exclude`. Returns { copied, skipped, errors }.
 */
export function copyTreeNoOverwrite(src, dst, { dry = false, exclude = new Set(), skipTopNames = new Set(), stats = { copied: 0, skipped: 0, errors: [] }, top = true } = {}) {
  let entries
  try { entries = readdirSync(src, { withFileTypes: true }) } catch (e) { if (e.code !== 'ENOENT') stats.errors.push(`${src}: ${e.code || e.message}`); return stats }
  for (const e of entries) {
    const s = join(src, e.name), d = join(dst, e.name)
    if (top && skipTopNames.has(e.name)) continue
    try {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || exclude.has(real(s))) continue
        copyTreeNoOverwrite(s, d, { dry, exclude, stats, top: false })
      } else if (e.isFile()) {
        if (existsSync(d)) { stats.skipped++; continue }
        if (!dry) {
          mkdirSync(dirname(d), { recursive: true })
          copyFileSync(s, d, constants.COPYFILE_EXCL)
          const st = lstatSync(s)
          utimesSync(d, st.atime, st.mtime)
        }
        stats.copied++
      }
    } catch (err) { stats.errors.push(`${s}: ${err.code || err.message}`) }
  }
  return stats
}

// ── Rows ──

/**
 * Copies the chosen workspace's rows from `old` into `tgt` (already in a transaction). Returns per-table
 * { copied, skipped } plus notes. `rewritePath` maps an absolute path in the old folder to the new folder.
 */
export function copyRows(old, tgt, ws, { rewritePath = (p) => p } = {}) {
  const res = {}
  const notes = []
  const stat = (t) => (res[t] ??= { copied: 0, skipped: 0 })
  const tgtCols = {}
  const colsOf = (t) => (tgtCols[t] ??= cols(tgt, t))
  // Rows of `t` that belong to the workspace (all of them for a table from before workspaces, only when ws = default).
  const src = (t, extra = '', ...a) => {
    if (!tableExists(old, t)) return []
    if (hasCol(old, t, 'workspace_id')) return old.prepare(`SELECT * FROM ${t} WHERE workspace_id = ? ${extra}`).all(ws, ...a)
    return ws === 'default' ? old.prepare(`SELECT * FROM ${t} WHERE 1 ${extra}`).all(...a) : []
  }
  const insert = (t, row, { orIgnore = true, drop = [] } = {}) => {
    const keep = Object.keys(row).filter((c) => colsOf(t).includes(c) && !drop.includes(c))
    if (colsOf(t).includes('workspace_id')) { row.workspace_id = 'default'; if (!keep.includes('workspace_id')) keep.push('workspace_id') }
    const sql = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${t} (${keep.join(', ')}) VALUES (${keep.map(() => '?').join(', ')})`
    return Number(tgt.prepare(sql).run(...keep.map((c) => row[c] ?? null)).changes) > 0
  }
  // A parent row in the target is "ours" when we just inserted it or it is the same row from an earlier run.
  const sameRow = (t, id, created) => !!tgt.prepare(`SELECT 1 FROM ${t} WHERE id = ? AND created_at IS ? AND workspace_id = 'default'`).get(id, created)

  // tasks
  for (const r of src('tasks')) {
    if (r.output_dir) r.output_dir = rewritePath(r.output_dir)
    insert('tasks', r) ? stat('tasks').copied++ : stat('tasks').skipped++
  }
  const oldTasks = new Map(src('tasks').map((r) => [r.id, r.created_at]))
  // outputs (autoincrement: natural key (task_id, path))
  for (const r of src('outputs')) {
    if (r.path) r.path = rewritePath(r.path)
    if (r.bucket) r.bucket = bucketOf('default')
    const s = stat('outputs')
    if (r.task_id && !(oldTasks.has(r.task_id) && sameRow('tasks', r.task_id, oldTasks.get(r.task_id)))) { s.skipped++; continue }
    if (tgt.prepare('SELECT 1 FROM outputs WHERE task_id IS ? AND path = ?').get(r.task_id ?? null, r.path)) { s.skipped++; continue }
    insert('outputs', r, { orIgnore: false, drop: ['id'] }); s.copied++
  }

  // teams (+ members). A team id already in the target is skipped with its members.
  const hadActive = !!tgt.prepare("SELECT 1 FROM teams WHERE workspace_id = 'default' AND active = 1").get()
  const insertedTeams = []
  for (const r of src('teams', 'ORDER BY created_at, id')) {
    const s = stat('teams')
    if (tgt.prepare('SELECT 1 FROM teams WHERE id = ?').get(r.id)) {
      s.skipped++
      if (!sameRow('teams', r.id, r.created_at)) notes.push(`El equipo «${r.name}» (${r.id}) ya existe en este Back Office con otro contenido: no lo copié.`)
      continue
    }
    insert('teams', { ...r, active: 0 }); s.copied++
    insertedTeams.push(r)
    if (tableExists(old, 'team_members')) {
      for (const m of old.prepare('SELECT * FROM team_members WHERE team_id = ?').all(r.id)) insert('team_members', m) ? stat('team_members').copied++ : stat('team_members').skipped++
    }
  }
  // Exactly one active team: the target's if it had one, else the old active one, else the oldest.
  if (!hadActive) {
    const oldActive = insertedTeams.find((t) => t.active)
    const pick = oldActive?.id ?? tgt.prepare("SELECT id FROM teams WHERE workspace_id = 'default' ORDER BY created_at, id LIMIT 1").get()?.id
    if (pick) tgt.prepare("UPDATE teams SET active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE workspace_id = 'default'").run(pick)
  }

  // leads, WhatsApp
  for (const t of ['leads', 'wa_messages', 'wa_drafts']) for (const r of src(t)) insert(t, r) ? stat(t).copied++ : stat(t).skipped++

  // artifacts (+ versions, comments). At most one home per workspace: an old home goes in as a normal artifact if the target has one.
  const targetHome = () => !!tgt.prepare("SELECT 1 FROM artifacts WHERE workspace_id = 'default' AND is_home = 1").get()
  for (const r of src('artifacts')) {
    const s = stat('artifacts')
    if (r.is_home && targetHome() && !sameRow('artifacts', r.id, r.created_at)) { r.is_home = 0; notes.push(`«${r.title}» era el inicio del proyecto viejo; aquí ya hay uno, así que quedó como artefacto normal.`) }
    if (insert('artifacts', r)) s.copied++
    else s.skipped++
    if (!sameRow('artifacts', r.id, r.created_at)) continue // an id clash with another artifact: its children stay out
    if (tableExists(old, 'artifact_versions')) {
      for (const v of old.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY n').all(r.id)) {
        const exists = tgt.prepare('SELECT 1 FROM artifact_versions WHERE artifact_id = ? AND n = ?').get(r.id, v.n)
        if (exists) stat('artifact_versions').skipped++
        else { insert('artifact_versions', v, { orIgnore: false, drop: ['id'] }); stat('artifact_versions').copied++ }
      }
    }
    if (tableExists(old, 'artifact_comments')) {
      for (const c of old.prepare('SELECT * FROM artifact_comments WHERE artifact_id = ? ORDER BY id').all(r.id)) {
        const exists = tgt.prepare('SELECT 1 FROM artifact_comments WHERE artifact_id = ? AND created_at = ? AND body = ?').get(r.id, c.created_at, c.body)
        if (exists) stat('artifact_comments').skipped++
        else { insert('artifact_comments', c, { orIgnore: false, drop: ['id'] }); stat('artifact_comments').copied++ }
      }
    }
  }

  // issue_reports (autoincrement: natural key (created_at, kind, title))
  for (const r of src('issue_reports')) {
    if (tgt.prepare('SELECT 1 FROM issue_reports WHERE created_at = ? AND kind = ? AND title = ?').get(r.created_at, r.kind, r.title)) stat('issue_reports').skipped++
    else { insert('issue_reports', r, { orIgnore: false, drop: ['id'] }); stat('issue_reports').copied++ }
  }

  // The Assistant (coo): the old workspace's row, else the old default row. Only empty fields of the target row are filled.
  if (tableExists(old, 'workspace_agents')) {
    const o = old.prepare("SELECT * FROM workspace_agents WHERE workspace_id = ? AND agent_id = 'coo'").get(ws)
      ?? old.prepare("SELECT * FROM workspace_agents WHERE workspace_id = 'default' AND agent_id = 'coo'").get()
    const s = stat('workspace_agents')
    if (o) {
      const t = tgt.prepare("SELECT * FROM workspace_agents WHERE workspace_id = 'default' AND agent_id = 'coo'").get()
      if (!t) { insert('workspace_agents', { ...o }); s.copied++ }
      else {
        const fill = ['display_name', 'avatar', 'context', 'session_ref'].filter((c) => c in o && colsOf('workspace_agents').includes(c) && (t[c] == null || t[c] === '') && o[c] != null && o[c] !== '')
        if (fill.length) {
          tgt.prepare(`UPDATE workspace_agents SET ${fill.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE workspace_id = 'default' AND agent_id = 'coo'`).run(...fill.map((c) => o[c]), Math.max(Number(t.updated_at) || 0, Number(o.updated_at) || 0))
          s.copied++
        } else s.skipped++
      }
    }
    // Any other per-workspace agent row (none today besides coo)
    for (const r of old.prepare("SELECT * FROM workspace_agents WHERE workspace_id = ? AND agent_id != 'coo'").all(ws)) insert('workspace_agents', r) ? s.copied++ : s.skipped++
  }

  // Profile (one row per install): only empty target fields.
  if (tableExists(old, 'user_profile')) {
    const o = old.prepare('SELECT * FROM user_profile WHERE id = 1').get()
    const t = tgt.prepare('SELECT * FROM user_profile WHERE id = 1').get()
    const s = stat('user_profile')
    if (o && t) {
      const fill = Object.keys(o).filter((c) => !['id', 'updated_at'].includes(c) && colsOf('user_profile').includes(c) && !t[c] && o[c])
      if (fill.length) {
        tgt.prepare(`UPDATE user_profile SET ${fill.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = 1`).run(...fill.map((c) => o[c]), Math.max(Number(t.updated_at) || 0, Number(o.updated_at) || 0))
        s.copied++
      } else s.skipped++
    }
  }
  if (tableExists(old, 'profile_insights')) {
    for (const r of old.prepare('SELECT * FROM profile_insights ORDER BY id').all()) {
      if (tgt.prepare('SELECT 1 FROM profile_insights WHERE text = ? AND category = ? AND created_at = ?').get(r.text, r.category, r.created_at)) stat('profile_insights').skipped++
      else { insert('profile_insights', r, { orIgnore: false, drop: ['id'] }); stat('profile_insights').copied++ }
    }
  }
  return { tables: res, notes }
}

// ── The whole import ──

/**
 * Plans (yes = false) or runs the import. Returns a result object; throws ImportError with a message for the person.
 * list = true (or several workspaces and none chosen) returns { mode: 'list', workspaces }.
 */
export async function runImport({ from, dir = REPO, workspace, list = false, yes = false, env = process.env, home = homedir(), running = serverRunning } = {}) {
  if (!from) throw new ImportError('Falta --from <carpeta de la instalación vieja>.')
  const tp = targetPaths(dir, env)
  const oldDbFile = findOldDb(from, home)
  if (!oldDbFile) throw new ImportError(`No encontré la base de datos vieja en ${resolve(from)} (busqué data/backoffice.db, data/agentos.db y ~/.agentos).`)
  const { dbFileIn, openDb } = await import('../plugins/backoffice/server/src/db.mjs')
  const tgtDbFile = dbFileIn(tp.data)
  if (real(oldDbFile) === real(tgtDbFile)) throw new ImportError('La instalación vieja es esta misma: no hay nada que importar.')
  const store = join(dirname(oldDbFile), 'store')

  // A read-only connection to a WAL database leaves -wal/-shm files behind, so when the old database has no -wal (no server
  // using it, all data in the main file) a private copy is read instead and the old folder gets no new files at all.
  let snap = null, oldOpen = oldDbFile
  if (!existsSync(`${oldDbFile}-wal`)) {
    snap = mkdtempSync(join(tmpdir(), 'backoffice-import-old-'))
    oldOpen = join(snap, 'old.db')
    copyFileSync(oldDbFile, oldOpen)
  }
  const old = new DatabaseSync(oldOpen, { readOnly: !snap })
  try {
    const all = listWorkspaces(old, store)
    const live = all.filter((w) => !w.archived)
    const base = { from: { dir: resolve(from), db: oldDbFile, store }, target: { dir: tp.dir, data: tp.data, db: tgtDbFile, root: tp.defaultRoot } }
    if (list || (!workspace && live.length > 1)) return { mode: 'list', ...base, workspaces: all, needsChoice: !workspace && live.length > 1 }
    const ws = workspace ?? (live[0] ?? all[0])?.id
    const w = all.find((x) => x.id === ws)
    if (!w) throw new ImportError(`No existe el workspace «${ws}» en la instalación vieja. Usa --list para ver los que hay.`)

    if (yes && (await running(tp.data, env))) throw new ImportError('El servidor de este Back Office está corriendo. Detenlo primero (./bin/backoffice stop) y vuelve a correr esto.')

    // The old workspace's folder on disk (skipping other workspaces' folders inside it and this install's own folders).
    const oldRoot = w.root && existsSync(w.root) && lstatSync(w.root).isDirectory() ? resolve(w.root) : null
    const exclude = new Set([tp.data, tp.root, join(tp.dir, 'backups')].map(real))
    for (const o of all) if (o.id !== ws && o.root) exclude.add(real(o.root))
    const skipTopNames = new Set(ws === 'default' ? ['workspaces'] : []) // old layout: ~/AgentOS/workspaces/<id> are other companies
    const rootSame = oldRoot && real(oldRoot) === real(tp.defaultRoot)
    const rewritePath = (p) => (oldRoot && !rootSame && typeof p === 'string' && pathInside(p, oldRoot) ? join(tp.defaultRoot, relative(oldRoot, p)) : p)

    // Back up before writing. The plan runs the same code on a throwaway copy of the target database.
    let backupPath = null
    if (yes && (existsSync(tp.data) || existsSync(tp.root))) {
      const { backup } = await import('./backup-backoffice.mjs')
      backupPath = (await backup({ dir: tp.dir, data: tp.data, workspaces: tp.root })).path
    }
    process.env.BACKOFFICE_HOME = tp.data // openDb's first migration names the default folder from these
    process.env.BACKOFFICE_ROOT = tp.root
    let tmp = null, dbPath = tgtDbFile
    if (!yes) {
      tmp = mkdtempSync(join(tmpdir(), 'backoffice-import-plan-'))
      dbPath = join(tmp, 'plan.db')
      if (existsSync(tgtDbFile)) { const { backupDb } = await import('./backup-backoffice.mjs'); await backupDb(tgtDbFile, dbPath) }
    }
    let rows, renamed = null
    const tgt = openDb(dbPath)
    try {
      tgt.exec('BEGIN')
      try {
        rows = copyRows(old, tgt, ws, { rewritePath })
        const cur = tgt.prepare("SELECT name FROM workspaces WHERE id = 'default'").get()?.name
        if (cur === 'Back Office' && !FACTORY_NAMES.has(w.name)) {
          tgt.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = 'default'").run(w.name, Date.now())
          renamed = { from: cur, to: w.name }
        }
        tgt.exec(yes ? 'COMMIT' : 'ROLLBACK')
      } catch (e) { tgt.exec('ROLLBACK'); throw e }
    } finally {
      tgt.close()
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    }

    // Files (after the database, so a failed copy leaves the rows to point at what is there; rerun fills the rest).
    const dry = !yes
    const tdStore = join(tp.data, 'store')
    const files = {
      store: copyTreeNoOverwrite(join(store, bucketOf(ws)), join(tdStore, bucketOf('default')), { dry }),
      root: oldRoot && !rootSame ? copyTreeNoOverwrite(oldRoot, tp.defaultRoot, { dry, exclude, skipTopNames }) : { copied: 0, skipped: 0, errors: [] },
    }
    copyTreeNoOverwrite(join(store, '.meta', bucketOf(ws)), join(tdStore, '.meta', bucketOf('default')), { dry }) // sidecars (content type, sha256)
    const notes = [...rows.notes]
    if (!oldRoot) notes.push(w.root ? `La carpeta del proyecto viejo (${w.root}) no existe: no copié archivos de disco.` : 'El proyecto viejo no tiene carpeta en disco.')
    return { mode: yes ? 'import' : 'plan', ...base, workspace: { id: w.id, name: w.name, root: oldRoot }, tables: rows.tables, files, renamed, backup: backupPath, notes }
  } finally {
    old.close()
    if (snap) rmSync(snap, { recursive: true, force: true })
  }
}

// ── CLI ──

const LABELS = {
  tasks: 'tareas', outputs: 'entregables', teams: 'equipos', team_members: 'agentes en equipos', leads: 'leads', wa_messages: 'mensajes de WhatsApp',
  wa_drafts: 'borradores de WhatsApp', artifacts: 'artefactos', artifact_versions: 'versiones de artefactos', artifact_comments: 'comentarios de artefactos',
  issue_reports: 'reportes de la plataforma', workspace_agents: 'Assistant', user_profile: 'perfil', profile_insights: 'notas del perfil',
}

function human(r) {
  const say = (s = '') => console.log(s)
  if (r.mode === 'list') {
    say(`Proyectos en la instalación vieja (${r.from.db}):`)
    for (const w of r.workspaces) {
      const c = w.counts
      say(`  · ${w.id}  «${w.name}»${w.archived ? ' (archivado)' : ''}: ${c.tasks} tareas, ${c.leads} leads, ${c.artifacts} artefactos, ${c.teams} equipos, ${c.files} archivos`)
    }
    say()
    say(r.needsChoice ? 'Hay varios. ¿Cuál es la empresa de este Back Office? Córrelo otra vez con --workspace <id>.' : 'Para ver el plan: --workspace <id> (y --yes para hacerlo).')
    return
  }
  say(`${r.mode === 'plan' ? 'Plan para importar' : 'Importé'} «${r.workspace.name}» (${r.workspace.id}) de ${r.from.dir} a este Back Office:`)
  const rows = Object.entries(r.tables).filter(([, s]) => s.copied || s.skipped)
  if (!rows.length) say('  · No hay datos en ese proyecto.')
  for (const [t, s] of rows) say(`  · ${LABELS[t] || t}: ${s.copied}${s.skipped ? ` (ya estaban u omitidos: ${s.skipped})` : ''}`)
  say(`  · archivos del almacenamiento: ${r.files.store.copied}${r.files.store.skipped ? ` (ya estaban: ${r.files.store.skipped})` : ''}`)
  say(`  · archivos de la carpeta del proyecto → ${r.target.root}: ${r.files.root.copied}${r.files.root.skipped ? ` (ya estaban: ${r.files.root.skipped})` : ''}`)
  if (r.renamed) say(`  · el proyecto ${r.mode === 'plan' ? 'se llamará' : 'ahora se llama'} «${r.renamed.to}» (antes «${r.renamed.from}»)`)
  for (const n of r.notes) say(`  ! ${n}`)
  const errs = [...r.files.store.errors, ...r.files.root.errors]
  if (errs.length) say(`  !! ${errs.length} archivos no se pudieron copiar (el primero: ${errs[0]})`)
  say()
  if (r.mode === 'plan') say(`No cambié nada. Para hacerlo: node scripts/import-agentos.mjs --from "${r.from.dir}" --workspace ${r.workspace.id} --yes`)
  else {
    if (r.backup) say(`Respaldo previo de este Back Office: ${r.backup}`)
    say('Listo. La instalación vieja quedó intacta. Arranca con ./bin/backoffice start y revisa que todo esté.')
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = process.argv.slice(2)
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  const json = a.includes('--json')
  try {
    const r = await runImport({ from: opt('--from'), dir: opt('--dir') || REPO, workspace: opt('--workspace'), list: a.includes('--list'), yes: a.includes('--yes') })
    if (json) console.log(JSON.stringify(r, null, 2))
    else human(r)
  } catch (e) {
    if (json) console.log(JSON.stringify({ error: e.message }, null, 2))
    console.error(e instanceof ImportError ? e.message : `No pude importar: ${e.stack || e.message}`)
    process.exit(1)
  }
}
