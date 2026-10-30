import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve, sep, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { stateFromEvent, projectName } from './status.mjs'
import { loadRoster } from './roster.mjs'
import { pathInside, workspaceDir } from './paths.mjs'

export const DEFAULT_WS = 'default'
export const slugify = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
export const bucketOf = (wsId) => `ws-${wsId}`
// Se adjunta al contexto de los agentes (SessionStart/SubagentStart, backoffice_team_context) y a backoffice_overview.
export const FILES_NOTE =
  'Files: your files live in Back Office storage for this workspace (not on the person\'s disk). Use backoffice_file_read/write/list/delete/move with workspace-relative paths like `marketing/<client>/facts.md`. Never ask the person for disk paths or to open files; deliver with backoffice_task_deliver `files`. Use the local disk only when you must run a shell/build (code projects), then deliver the folder.'
export const AGENT_STATUSES = ['backlog', 'todo', 'doing', 'blocked', 'review'] // 'done' y 'cancelled' sólo los pone una persona
export const TASK_STATUSES = [...AGENT_STATUSES, 'done', 'cancelled']
const CLOSED_TASK = ['done', 'cancelled']
const taskCounts = () => Object.fromEntries(TASK_STATUSES.map((s) => [s, 0]))
const KEEP_EVENTS = 5000
export const PROFILE_FIELDS = ['preferred_name', 'about', 'personal_goals', 'professional_goals', 'current_focus', 'work_style']
export const INSIGHT_CATEGORIES = ['preference', 'goal', 'context', 'communication', 'other']
export const INSIGHT_SOURCES = ['assistant', 'person']
const PROFILE_MAX = 4000
const NAME_MAX = 120
const INSIGHT_MAX = 500
const KEEP_INSIGHTS = 200
// Rechazo básico de datos sensibles (tarjetas, contraseñas, llaves). No es exhaustivo: la regla real está en las instrucciones del agente.
const SENSITIVE = [/\b(?:\d[ -]?){13,19}\b/, /\b(?:password|passwd|contrase[ñn]a|cvv|clabe|token|api[_ -]?key|secret)\b\s*(?:is|es|:|=)/i, /\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9_-]{16,}/]

export class AppError extends Error {
  constructor(code, message, http = 400) {
    super(message)
    this.code = code
    this.http = http
  }
}

export function createStore(db, { roster: rosterOpt = null } = {}) {
  const roster = rosterOpt ?? loadRoster() // global (no depende del workspace); nunca lanza
  const bus = new EventEmitter()
  bus.setMaxListeners(100)
  const now = () => Date.now()
  // Un Back Office = una empresa: si el instalador guardó su nombre (BACKOFFICE_COMPANY) y el proyecto sigue con el nombre
  // de fábrica, toma el de la empresa (la etiqueta de arriba a la izquierda en la web).
  const company = String(process.env.BACKOFFICE_COMPANY ?? '').trim().slice(0, 80)
  if (company) db.prepare("UPDATE workspaces SET name = ? WHERE id = 'default' AND name IN ('Back Office', 'AgentOS', 'Default')").run(company)

  const q = {
    getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    insSession: db.prepare(
      `INSERT INTO sessions (id, cwd, project, agent, status, tool, detail, started_at, last_event_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updSession: db.prepare(
      `UPDATE sessions SET cwd = COALESCE(?, cwd), project = COALESCE(?, project), agent = COALESCE(?, agent),
         status = ?, tool = ?, detail = ?, subagents = ?, last_event_at = ?, ended_at = ?, workspace_id = COALESCE(?, workspace_id) WHERE id = ?`,
    ),
    insEvent: db.prepare('INSERT INTO events (ts, session_id, event, tool, payload, workspace_id) VALUES (?, ?, ?, ?, ?, ?)'),
    trimEvents: db.prepare('DELETE FROM events WHERE id <= (SELECT MAX(id) - ? FROM events)'),
    sessions: db.prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY last_event_at DESC'),
    getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    insTask: db.prepare(
      `INSERT INTO tasks (id, title, description, status, agent, session_id, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?)`,
    ),
    updTask: db.prepare(
      `UPDATE tasks SET title = ?, description = ?, status = ?, agent = ?, session_id = ?, output_dir = ?, updated_at = ? WHERE id = ?`,
    ),
    tasks: db.prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC'),
    outputsOf: db.prepare('SELECT * FROM outputs WHERE task_id = ? ORDER BY id'),
    insOutput: db.prepare(
      'INSERT INTO outputs (task_id, session_id, path, kind, title, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    outputs: db.prepare('SELECT * FROM outputs WHERE workspace_id = ? ORDER BY id DESC LIMIT ?'),
    recent: db.prepare('SELECT * FROM events WHERE workspace_id = ? ORDER BY id DESC LIMIT ?'),
    childrenOf: db.prepare("SELECT id FROM sessions WHERE id LIKE ? AND status != 'offline'"),
  }

  const emit = (type, data, workspace_id = data?.workspace_id ?? null) => bus.emit('change', { type, data, workspace_id })

  // ---------- workspaces ----------
  const getWorkspaceRow = (id) => db.prepare('SELECT * FROM workspaces WHERE id = ? AND archived_at IS NULL').get(String(id ?? ''))
  const listWorkspaceRows = () => db.prepare('SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY (id = ?) DESC, created_at, id').all(DEFAULT_WS)
  const norm = (p) => resolve(p)
  // Raíz más larga que sea prefijo del cwd (los workspaces viven dentro de ~/AgentOS, la raíz de `default`).
  function workspaceForCwd(cwd) {
    if (!cwd || typeof cwd !== 'string') return DEFAULT_WS
    const c = norm(cwd)
    let best = null
    for (const w of listWorkspaceRows()) {
      if (!w.root) continue
      const root = norm(w.root)
      const inside = pathInside(c, root)
      if (inside && (!best || root.length > best.len)) best = { id: w.id, len: root.length }
    }
    return best?.id ?? DEFAULT_WS
  }
  // Prioridad: id explícito (BACKOFFICE_WORKSPACE) si existe; si no, el cwd; si no, default. Nunca lanza.
  const resolveWorkspace = ({ explicit = null, cwd = null } = {}) => (explicit && getWorkspaceRow(explicit) ? String(explicit) : workspaceForCwd(cwd))
  function needWorkspace(id = DEFAULT_WS) {
    const w = getWorkspaceRow(id)
    if (!w) throw new AppError('workspace_not_found', `No existe el workspace ${id}`, 404)
    return w
  }
  const wsCounts = (id) => ({
    tasks: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?").get(id).n,
    tasks_open: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND status NOT IN ('done', 'cancelled')").get(id).n,
    teams: db.prepare('SELECT COUNT(*) AS n FROM teams WHERE workspace_id = ?').get(id).n,
    outputs: db.prepare('SELECT COUNT(*) AS n FROM outputs WHERE workspace_id = ?').get(id).n,
    sessions_active: db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ? AND status != 'offline'").get(id).n,
  })
  const wsView = (w) => ({ id: w.id, name: w.name, root: w.root, bucket: bucketOf(w.id), created_at: w.created_at, updated_at: w.updated_at, counts: wsCounts(w.id) })
  const listWorkspaces = () => listWorkspaceRows().map(wsView)
  const getWorkspace = (id) => { const w = getWorkspaceRow(id); return w ? wsView(w) : null }
  const emitWorkspaces = () => bus.emit('change', { type: 'workspaces', data: listWorkspaces(), workspace_id: null })

  function createWorkspace({ name, id = null } = {}) {
    const nm = String(name ?? '').trim()
    if (!nm) throw new AppError('bad_request', 'El workspace necesita un nombre')
    if (nm.length > 60) throw new AppError('bad_request', 'El nombre pasa de 60 caracteres')
    let wid = slugify(id ?? nm)
    if (wid.length < 1) throw new AppError('bad_request', 'No se pudo generar un id válido a partir del nombre')
    const exists = (x) => db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(x)
    if (id !== null && id !== undefined && id !== '') {
      if (exists(wid) && !db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND archived_at IS NOT NULL').get(wid)) throw new AppError('workspace_exists', `Ya existe el workspace ${wid}`, 409)
    } else {
      const baseId = wid
      for (let i = 2; exists(wid); i++) wid = `${baseId.slice(0, 36)}-${i}`
    }
    // Los nuevos van en <proyecto>/workspaces/<id> (BACKOFFICE_ROOT/<id>); en la estructura vieja, ~/AgentOS/workspaces/<id>.
    const root = workspaceDir(wid)
    mkdirSync(root, { recursive: true })
    const ts = now()
    if (exists(wid)) db.prepare('UPDATE workspaces SET name = ?, root = ?, archived_at = NULL, updated_at = ? WHERE id = ?').run(nm, root, ts, wid) // revive uno archivado
    else db.prepare('INSERT INTO workspaces (id, name, root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(wid, nm, root, ts, ts)
    emitWorkspaces()
    return getWorkspace(wid)
  }
  function updateWorkspace(id, patch = {}) {
    const w = needWorkspace(id)
    const name = patch.name !== undefined ? String(patch.name).trim() : w.name
    if (!name || name.length > 60) throw new AppError('bad_request', 'Nombre inválido (1 a 60 caracteres)')
    let root = w.root
    if (patch.root !== undefined) {
      if (typeof patch.root !== 'string' || !isAbsolute(patch.root)) throw new AppError('bad_path', 'root debe ser una ruta absoluta')
      root = norm(patch.root)
    }
    db.prepare('UPDATE workspaces SET name = ?, root = ?, updated_at = ? WHERE id = ?').run(name, root, now(), id)
    emitWorkspaces()
    return getWorkspace(id)
  }
  // "Eliminar" = archivar la fila. No borra tareas, archivos en disco ni objetos del bucket.
  function deleteWorkspace(id, { force = false } = {}) {
    if (id === DEFAULT_WS) throw new AppError('forbidden', 'El workspace default no se puede eliminar', 403)
    needWorkspace(id)
    const c = wsCounts(id)
    if (!force && (c.tasks || c.teams || c.outputs)) throw new AppError('not_empty', `El workspace tiene ${c.tasks} tareas, ${c.teams} equipos y ${c.outputs} entregables; usa ?force=1 para archivarlo`, 409)
    db.prepare('UPDATE workspaces SET archived_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id)
    emitWorkspaces()
    return { ok: true, archived: true, id, files_untouched: true, message: 'Workspace archivado. Sus filas siguen en la base de datos y no se borró ningún archivo en disco ni objeto del almacenamiento.' }
  }
  const rootsAllowed = () => listWorkspaceRows().map((w) => w.root).filter(Boolean)

  // Guarda el estado de una sesión (o de un subagente, que vive como sesión hija «<sesión>/<agent_id>»).
  function upsertSession(id, { cwd = null, agent = null, st = null, delta = 0, ts, ws = null }) {
    const prev = q.getSession.get(id)
    if (!prev) q.insSession.run(id, cwd, projectName(cwd), agent, st?.status ?? 'idle', st?.tool ?? null, st?.detail ?? null, ts, ts, ws ?? DEFAULT_WS)
    const cur = prev ?? q.getSession.get(id)
    q.updSession.run(
      cwd,
      projectName(cwd),
      agent,
      st?.status ?? cur.status,
      st && 'tool' in st ? st.tool : cur.tool,
      st?.detail ?? cur.detail,
      Math.max(0, cur.subagents + delta),
      ts,
      st?.status === 'offline' ? ts : st ? null : cur.ended_at,
      ws,
      id,
    )
    const session = q.getSession.get(id)
    emit('session', session)
    return session
  }

  // `explicit` = BACKOFFICE_WORKSPACE (payload.backoffice_workspace, payload.env o cabecera). Sin cwd ni id, se conserva el de la sesión.
  function sessionWorkspace(p, sid) {
    const explicit = p.backoffice_workspace ?? p.env?.BACKOFFICE_WORKSPACE ?? p.env?.AGENTOS_WORKSPACE ?? p.workspace ?? null
    if (explicit || p.cwd) return resolveWorkspace({ explicit, cwd: p.cwd ?? null })
    return (sid && (q.getSession.get(sid) ?? q.getSession.get(String(sid).split('/')[0]))?.workspace_id) || DEFAULT_WS
  }

  // With the plugin installed at user scope the hooks report EVERY Claude Code session on the machine. Only track the
  // ones inside a project (cwd under a workspace root), with BACKOFFICE_WORKSPACE set, using a roster agent, or already known.
  const rosterIds = new Set(roster.plugins.flatMap((p) => p.agents.map((a) => a.id)))
  const cwdInProject = (cwd) => typeof cwd === 'string' && cwd !== '' && listWorkspaceRows().some((w) => w.root && pathInside(norm(cwd), norm(w.root)))
  // Every installed company plugin's hooks fire in every Claude session: a session run by another company's plugin
  // (`backoffice-<other>:ceo`) belongs to that company's server, never to this one.
  function foreignPlugin(agentType) {
    const own = process.env.BACKOFFICE_COMPANY_SLUG ? `backoffice-${process.env.BACKOFFICE_COMPANY_SLUG}`.toLowerCase() : null
    const parts = String(agentType ?? '').toLowerCase().split(':')
    return parts.length > 1 && /^backoffice-/.test(parts[0]) && parts[0] !== own
  }

  function tracksSession(p, sid) {
    if (p.agent_type && foreignPlugin(p.agent_type)) return false
    const explicit = p.backoffice_workspace ?? p.env?.BACKOFFICE_WORKSPACE ?? p.env?.AGENTOS_WORKSPACE ?? p.workspace ?? null
    if (explicit && getWorkspaceRow(explicit)) return true
    if (p.agent_type && rosterIds.has(agentKey(p.agent_type))) return true
    if (cwdInProject(p.cwd)) return true
    return !!(sid && q.getSession.get(String(sid).split('/')[0]))
  }

  function recordEvent(event, p = {}) {
    const ts = now()
    const sid = p.session_id ?? null
    if (!tracksSession(p, sid)) return null
    const ws = sessionWorkspace(p, sid)
    q.insEvent.run(ts, sid, event, p.tool_name ?? null, JSON.stringify(p), ws)
    if (Math.random() < 0.02) q.trimEvents.run(KEEP_EVENTS)
    if (!sid) return null
    const cwd = p.cwd ?? null

    // Eventos de un subagente: traen agent_id y el session_id del padre. El subagente se enciende en su
    // propio escritorio y el padre conserva su identidad (sólo cuenta cuántos subagentes tiene).
    if (p.agent_id) {
      const child = `${sid}/${p.agent_id}`
      const agent = p.agent_type ? agentKey(p.agent_type) : null
      if (event === 'SubagentStart' || event === 'SubagentStop') {
        upsertSession(sid, { cwd, delta: event === 'SubagentStart' ? 1 : -1, ts, ws })
        const st = event === 'SubagentStart' ? { status: 'working', tool: null, detail: 'Trabajando en un encargo' } : { status: 'offline', tool: null, detail: 'Encargo entregado' }
        return upsertSession(child, { cwd, agent, st, ts, ws })
      }
      return upsertSession(child, { cwd, agent, st: stateFromEvent(event, p), ts, ws })
    }

    const session = upsertSession(sid, { cwd, agent: p.agent_type ? agentKey(p.agent_type) : null, st: stateFromEvent(event, p), ts, ws })
    if (event === 'SessionEnd') {
      // Al cerrar la sesión, sus subagentes también quedan fuera de línea.
      for (const c of q.childrenOf.all(`${sid}/%`)) upsertSession(c.id, { st: { status: 'offline', tool: null, detail: 'Sesión cerrada' }, ts, ws })
    }
    return session
  }

  // Check-in explícito de un agente (MCP): no depende de los hooks de Claude.
  function checkin({ agent, status = 'working', detail = null }, ws = DEFAULT_WS) {
    if (!agent) throw new AppError('bad_request', 'Falta el nombre del agente')
    if (!['working', 'waiting', 'idle', 'error'].includes(status)) throw new AppError('bad_status', `Estado inválido: ${status}`)
    needWorkspace(ws)
    const sid = ws === DEFAULT_WS ? `mcp:${agent}` : `mcp:${ws}:${agent}`
    const ts = now()
    const prev = q.getSession.get(sid)
    if (!prev) q.insSession.run(sid, null, null, agent, status, null, detail, ts, ts, ws)
    const cur = prev ?? q.getSession.get(sid)
    q.updSession.run(null, null, agent, status, null, detail, cur.subagents, ts, null, null, sid)
    q.insEvent.run(ts, sid, 'Checkin', null, JSON.stringify({ agent, status, detail }), ws)
    const session = q.getSession.get(sid)
    emit('session', session)
    return session
  }

  // Self-reported check-in sessions (`mcp:<agent>`) have no end event: if the agent stops reporting they show as offline.
  const CHECKIN_TTL_MS = 30 * 60 * 1000
  function listSessions(ws = DEFAULT_WS) {
    const now = Date.now()
    return q.sessions.all(ws).map((s) => (s.id.startsWith('mcp:') && s.status !== 'offline' && now - s.last_event_at > CHECKIN_TTL_MS ? { ...s, status: 'offline' } : s))
  }

  // ---------- tareas y entregables ----------
  const outView = (o) => {
    let files = null
    if (o.files) { try { files = JSON.parse(o.files) } catch {} }
    // Entregable virtual (de archivos del almacenamiento): `path` guardado como '' y expuesto como null.
    const virtual = o.kind !== 'link' && !o.path
    const stored = !!(o.storage_key || files?.files?.length)
    return { ...o, path: o.path || null, virtual, files, stored, exists: o.kind === 'link' ? null : virtual ? stored : existsSync(o.path) }
  }
  const withOutputs = (t) => {
    if (!t) return t
    const outputs = q.outputsOf.all(t.id).map(outView)
    return { ...t, output_dir_exists: t.output_dir ? existsSync(t.output_dir) : null, outputs }
  }

  const ALL_STATUSES = TASK_STATUSES
  // story_id / sprint_id: null unlinks; otherwise a story/sprint of the same workspace (a completed sprint takes no new work).
  function taskLinks(p, ws) {
    const o = {}
    for (const [k, table, label] of [['story_id', 'stories', 'la historia'], ['sprint_id', 'sprints', 'el sprint']]) {
      if (!(k in p) || p[k] === undefined) continue
      const v = p[k]
      if (v === null || v === '') { o[k] = null; continue }
      const r = typeof v === 'string' ? db.prepare(`SELECT workspace_id, status, ${k === 'story_id' ? 'sprint_id' : 'NULL AS sprint_id'} FROM ${table} WHERE id = ?`).get(v) : null
      if (!r || r.workspace_id !== ws) throw new AppError('bad_link', `No existe ${label} ${v} en este proyecto`, 400)
      if (table === 'sprints' && r.status === 'completed') throw new AppError('sprint_completed', `El sprint ${v} ya está completado; usa otro`, 409)
      o[k] = v
      if (k === 'story_id') o._story_sprint = r.sprint_id
    }
    return o
  }
  const writeLinks = (id, l) => {
    for (const k of ['story_id', 'sprint_id']) if (k in l) db.prepare(`UPDATE tasks SET ${k} = ? WHERE id = ?`).run(l[k], id)
  }
  // `human`: la persona (web) puede crear la tarea directo en cualquier columna; los agentes sólo en backlog o todo.
  function createTask({ title, description = null, agent = null, session_id = null, status = 'todo', ...rest }, ws = DEFAULT_WS, human = false) {
    needWorkspace(ws)
    if (!title || !String(title).trim()) throw new AppError('bad_request', 'La tarea necesita un título')
    if (human) {
      if (String(title).trim().length > 200) throw new AppError('bad_request', 'El título admite hasta 200 caracteres')
      if (!ALL_STATUSES.includes(status)) throw new AppError('bad_status', `Estado inválido: ${status}`)
    } else status = status === 'backlog' ? 'backlog' : 'todo'
    const links = taskLinks(rest, ws)
    // A task created inside a story lands in that story's sprint unless it says otherwise.
    if (links.story_id && !('sprint_id' in links) && links._story_sprint) links.sprint_id = links._story_sprint
    delete links._story_sprint
    const id = `T-${randomUUID().slice(0, 8)}`
    const ts = now()
    q.insTask.run(id, String(title).trim(), description, agent, session_id, ts, ts, ws)
    if (status !== 'todo') db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
    writeLinks(id, links)
    const t = withOutputs(q.getTask.get(id))
    emit('task', t)
    return t
  }

  // La persona mueve una tarea a cualquier columna (incluida done, que los agentes no pueden).
  function setTaskStatus(id, status, ws = null) {
    const t = taskIn(id, ws)
    if (!ALL_STATUSES.includes(status)) throw new AppError('bad_status', `Estado inválido: ${status}`)
    q.updTask.run(t.title, t.description, status, t.agent, t.session_id, t.output_dir, now(), id)
    // A cancel proposal stays as the reason when the person cancels (or keeps it in review); any other move drops it.
    if (t.cancel_proposal && status !== 'cancelled' && status !== 'review') db.prepare('UPDATE tasks SET cancel_proposal = NULL WHERE id = ?').run(id)
    const out = withOutputs(q.getTask.get(id))
    emit('task', out)
    return out
  }

  // La persona (web, PATCH /api/human/tasks/:id): estado y/o historia/sprint.
  function humanUpdateTask(id, body = {}, ws = null) {
    const t = taskIn(id, ws)
    const links = taskLinks(body ?? {}, t.workspace_id)
    delete links._story_sprint
    if (body?.status === undefined && !Object.keys(links).length) throw new AppError('bad_request', 'Manda status, story_id o sprint_id')
    if (body?.status !== undefined) setTaskStatus(id, body.status, ws)
    if (Object.keys(links).length) {
      writeLinks(id, links)
      db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now(), id)
    }
    const out = withOutputs(q.getTask.get(id))
    emit('task', out)
    return out
  }

  // Borra la tarea y sus registros de entregables; no toca archivos guardados (Archivos) ni en disco.
  function deleteTask(id, ws = null) {
    const t = taskIn(id, ws)
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM outputs WHERE task_id = ?').run(id)
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    emit('task_deleted', { id, workspace_id: t.workspace_id })
    return { ok: true, id }
  }

  // Mover de proyecto, paso 1: valida y devuelve lo que hay que copiar. Paso 2 (applyTaskMove) mueve las filas.
  function planTaskMove(id, to, ws = null) {
    const t = taskIn(id, ws)
    if (typeof to !== 'string' || !to || !getWorkspaceRow(to)) throw new AppError('bad_target', 'El proyecto destino no existe o está archivado', 400)
    if (to === t.workspace_id) throw new AppError('bad_target', 'La tarea ya está en ese proyecto', 400)
    return { task: t, from: t.workspace_id, to, outputs: q.outputsOf.all(id) }
  }
  // Mueve la fila de la tarea y sus entregables (workspace y bucket) en una transacción y avisa a ambos tableros.
  function applyTaskMove(id, to) {
    const t = q.getTask.get(id)
    if (!t) throw new AppError('not_found', `No existe la tarea ${id}`, 404)
    const from = t.workspace_id
    db.exec('BEGIN')
    try {
      db.prepare('UPDATE tasks SET workspace_id = ?, updated_at = ? WHERE id = ?').run(to, now(), id)
      db.prepare('UPDATE outputs SET workspace_id = ?, bucket = CASE WHEN bucket IS NULL THEN NULL ELSE ? END WHERE task_id = ?').run(to, bucketOf(to), id)
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    const out = withOutputs(q.getTask.get(id))
    emit('task_deleted', { id, workspace_id: from })
    emit('task', out)
    emitWorkspaces()
    return out
  }

  const needAbs = (p, what) => {
    if (!p || typeof p !== 'string' || !isAbsolute(p)) throw new AppError('bad_path', `${what} debe ser una ruta absoluta`)
  }

  // `ws` (opcional): si viene, la tarea debe pertenecer a ese workspace (aislamiento); sin él se acepta cualquiera.
  const taskIn = (id, ws) => {
    const t = q.getTask.get(id)
    if (!t || (ws && t.workspace_id !== ws)) throw new AppError('not_found', `No existe la tarea ${id}`, 404)
    return t
  }

  function addOutput(taskId, { path, kind = 'file', title = null, session_id = null }, ws = null) {
    const t = taskIn(taskId, ws)
    if (kind !== 'link') needAbs(path, 'El entregable')
    const ins = q.insOutput.run(taskId, session_id ?? t.session_id, path, kind, title, now(), t.workspace_id)
    q.updTask.run(t.title, t.description, t.status, t.agent, t.session_id, t.output_dir, now(), t.id)
    const out = withOutputs(q.getTask.get(taskId))
    emit('task', out)
    return Object.defineProperty(out, 'new_output_id', { value: Number(ins.lastInsertRowid), enumerable: false })
  }

  // Entregable que vive en el almacenamiento (sin ruta en disco). Devuelve el id; la clave se guarda con setOutputStorage.
  function addVirtualOutput(taskId, { kind = 'file', title = null, session_id = null }, ws = null) {
    const t = taskIn(taskId, ws)
    const ins = q.insOutput.run(taskId, session_id ?? t.session_id, '', kind, title, now(), t.workspace_id)
    q.updTask.run(t.title, t.description, t.status, t.agent, t.session_id, t.output_dir, now(), t.id)
    return Number(ins.lastInsertRowid)
  }

  // Un agente puede mover una tarea hasta "review". Pasarla a "done" es de una persona (approveTask); cancelarla también:
  // el agente sólo lo PROPONE con `propose_cancel` (el motivo), que la deja en review para que la persona decida.
  function updateTask(id, patch = {}, ws = null) {
    const t = taskIn(id, ws)
    const proposal = patch.propose_cancel === undefined || patch.propose_cancel === null ? null : String(patch.propose_cancel).trim()
    if (proposal !== null) {
      if (!proposal || proposal.length > 1000) throw new AppError('bad_request', 'propose_cancel necesita el motivo (1 a 1000 caracteres)')
      if (patch.status && patch.status !== 'review') throw new AppError('bad_request', 'Proponer cancelar deja la tarea en review; no mandes otro status')
      patch = { ...patch, status: 'review' }
    }
    if (patch.status === 'cancelled')
      throw new AppError('human_only', 'Sólo la persona cancela una tarea. Para proponerlo usa propose_cancel con el motivo (queda en review).', 403)
    if (t.status === 'cancelled' && patch.status && patch.status !== 'cancelled')
      throw new AppError('human_only', 'La tarea está cancelada; sólo la persona la reabre.', 403)
    const links = taskLinks(patch, t.workspace_id)
    delete links._story_sprint
    const next = {
      title: patch.title ?? t.title,
      description: patch.description ?? t.description,
      status: patch.status ?? t.status,
      agent: patch.agent ?? t.agent,
      session_id: patch.session_id ?? t.session_id,
      output_dir: patch.output_dir ?? t.output_dir,
    }
    if (patch.status && patch.status === 'done')
      throw new AppError('human_only', 'Sólo una persona puede marcar una tarea como done (usa review)', 403)
    if (patch.status && !AGENT_STATUSES.includes(patch.status))
      throw new AppError('bad_status', `Estado inválido: ${patch.status}`)
    if (patch.output_dir !== undefined && patch.output_dir !== null) needAbs(patch.output_dir, 'output_dir')
    const cancelProposal = proposal ?? (next.status === 'review' ? t.cancel_proposal : null)
    if (next.status === 'review' && !cancelProposal && !next.output_dir && q.outputsOf.all(id).length === 0)
      throw new AppError('needs_output', 'Para pasar a review indica output_dir o registra al menos un entregable (o propose_cancel con el motivo)', 422)
    q.updTask.run(next.title, next.description, next.status, next.agent, next.session_id, next.output_dir, now(), id)
    db.prepare('UPDATE tasks SET cancel_proposal = ? WHERE id = ?').run(cancelProposal, id)
    writeLinks(id, links)
    const out = withOutputs(q.getTask.get(id))
    emit('task', out)
    return out
  }

  function approveTask(id, by = 'humano', ws = null) {
    const t = taskIn(id, ws)
    if (t.status !== 'review') throw new AppError('not_in_review', 'Sólo se aprueba lo que está en review', 409)
    q.updTask.run(t.title, t.description, 'done', t.agent, t.session_id, t.output_dir, now(), id)
    const out = { ...withOutputs(q.getTask.get(id)), approved_by: by }
    emit('task', out)
    return out
  }

  // Sólo se pueden abrir rutas que un agente registró como entregable o carpeta de salida.
  const isKnownPath = (p) =>
    typeof p === 'string' &&
    (db.prepare('SELECT 1 FROM outputs WHERE path = ? LIMIT 1').get(p) !== undefined ||
      db.prepare('SELECT 1 FROM tasks WHERE output_dir = ? LIMIT 1').get(p) !== undefined)


  // ── Equipos: una selección de agentes del roster, cada uno con su contexto ──
  const MAX_CONTEXT = 8000
  const agentKey = (v) => String(v ?? '').toLowerCase().split(':').pop().trim() // "backoffice:cmo" → "cmo"
  const cleanMembers = (members) => {
    if (!Array.isArray(members)) throw new AppError('bad_request', 'members debe ser una lista')
    const seen = new Set()
    return members.map((m, i) => {
      const agent_id = agentKey(m?.agent_id)
      if (!agent_id) throw new AppError('bad_request', 'Cada miembro necesita agent_id')
      if (seen.has(agent_id)) throw new AppError('bad_request', `Agente repetido: ${agent_id}`)
      seen.add(agent_id)
      const context = String(m.context ?? '')
      if (context.length > MAX_CONTEXT) throw new AppError('too_large', `El contexto de ${agent_id} pasa de ${MAX_CONTEXT} caracteres`, 413)
      const display_name = String(m.display_name ?? '').trim()
      if (display_name.length > 40) throw new AppError('bad_request', `El nombre de ${agent_id} pasa de 40 caracteres`)
      const avatar = m.avatar === null || m.avatar === undefined ? null : Number(m.avatar)
      if (avatar !== null && !(Number.isInteger(avatar) && avatar >= 0 && avatar <= 20)) throw new AppError('bad_request', `Avatar inválido para ${agent_id}: debe ser un entero de 0 a 20`)
      const session_ref = String(m.session_ref ?? '').trim() || null
      if (session_ref && session_ref.length > 300) throw new AppError('bad_request', `La conversación de ${agent_id} pasa de 300 caracteres`)
      return { agent_id, display_name, avatar, context, session_ref, position: i }
    })
  }
  // «Activo» ya no existe: todos los equipos de la empresa están disponibles a la vez (la columna queda por compatibilidad).
  const omitActive = ({ active, ...t }) => t
  const withMembers = (t) =>
    t && { ...omitActive(t), members: db.prepare('SELECT agent_id, display_name, avatar, context, session_ref FROM team_members WHERE team_id = ? ORDER BY position').all(t.id) }
  const listTeams = (ws = DEFAULT_WS) => db.prepare('SELECT * FROM teams WHERE workspace_id = ? ORDER BY created_at').all(ws).map(withMembers)
  // Con `ws`, un equipo de otro workspace no existe.
  const getTeam = (id, ws = null) => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id)
    return t && (!ws || t.workspace_id === ws) ? withMembers(t) : null
  }
  const emitTeams = (ws = DEFAULT_WS) => bus.emit('change', { type: 'teams', data: listTeams(ws), workspace_id: ws })
  const writeMembers = (id, members) => {
    db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id)
    const ins = db.prepare('INSERT INTO team_members (team_id, agent_id, display_name, avatar, context, position, session_ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const m of members) ins.run(id, m.agent_id, m.display_name, m.avatar, m.context, m.position, m.session_ref)
  }
  const inTx = (fn) => {
    db.exec('BEGIN')
    try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  function createTeam({ name, members = [] }, ws = DEFAULT_WS) {
    needWorkspace(ws)
    if (!name || !String(name).trim()) throw new AppError('bad_request', 'El equipo necesita un nombre')
    const list = cleanMembers(members)
    const id = `team-${randomUUID().slice(0, 8)}`
    const ts = now()
    inTx(() => {
      db.prepare('INSERT INTO teams (id, name, active, created_at, updated_at, workspace_id) VALUES (?, ?, 0, ?, ?, ?)').run(id, String(name).trim(), ts, ts, ws)
      writeMembers(id, list)
    })
    emitTeams(ws)
    return getTeam(id)
  }
  function updateTeam(id, patch, ws = null) {
    const t = getTeam(id, ws)
    if (!t) throw new AppError('not_found', 'No existe ese equipo', 404)
    const name = patch.name !== undefined ? String(patch.name).trim() : t.name
    if (!name) throw new AppError('bad_request', 'El equipo necesita un nombre')
    const list = patch.members !== undefined ? cleanMembers(patch.members) : null
    inTx(() => {
      db.prepare('UPDATE teams SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id)
      if (list) writeMembers(id, list)
    })
    emitTeams(t.workspace_id)
    return getTeam(id)
  }
  function deleteTeam(id, ws = null) {
    const t = getTeam(id, ws)
    if (!t) throw new AppError('not_found', 'No existe ese equipo', 404)
    inTx(() => {
      db.prepare('DELETE FROM teams WHERE id = ?').run(id)
    })
    emitTeams(t.workspace_id)
  }
  // Compatibilidad: antes había un equipo «activo». Ya no: todos están disponibles; responde el equipo sin cambiar nada.
  function activateTeam(id, ws = null) {
    const t = getTeam(id, ws)
    if (!t) throw new AppError('not_found', 'No existe ese equipo', 404)
    return t
  }

  // ── Agentes del sistema (Assistant, id `coo`): siempre presentes, con nombre, avatar, contexto y sesión propios ──
  // Es UNA sola Assistant para todos los proyectos: su configuración vive en la fila del workspace `default` y se
  // ignora el workspace pedido (lo que sí cambia por proyecto es lo que ve: equipos, tareas, archivos).
  const SYSTEM_IDS = ['coo']
  const SYSTEM_WS = DEFAULT_WS
  const getSystemAgent = (id, _ws) =>
    db.prepare('SELECT agent_id, display_name, avatar, context, session_ref FROM workspace_agents WHERE workspace_id = ? AND agent_id = ?').get(SYSTEM_WS, id) ?? { agent_id: id, display_name: '', avatar: null, context: '', session_ref: null }
  const listSystemAgents = () => Object.fromEntries(SYSTEM_IDS.map((id) => [id, getSystemAgent(id)]))
  function updateSystemAgent(id, patch, _ws) {
    if (!SYSTEM_IDS.includes(id)) throw new AppError('not_found', 'No existe ese agente del sistema', 404)
    const cur = getSystemAgent(id)
    const [m] = cleanMembers([{ agent_id: id, display_name: patch.display_name ?? cur.display_name, avatar: patch.avatar === undefined ? cur.avatar : patch.avatar, context: patch.context ?? cur.context, session_ref: patch.session_ref === undefined ? cur.session_ref : patch.session_ref }])
    db.prepare(`INSERT INTO workspace_agents (workspace_id, agent_id, display_name, avatar, context, session_ref, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, agent_id) DO UPDATE SET display_name = excluded.display_name, avatar = excluded.avatar, context = excluded.context, session_ref = excluded.session_ref, updated_at = excluded.updated_at`).run(SYSTEM_WS, id, m.display_name, m.avatar, m.context, m.session_ref, now())
    // workspace_id null = se avisa a todas las pestañas, estén en el proyecto que estén
    bus.emit('change', { type: 'system', data: listSystemAgents(), workspace_id: null })
    return getSystemAgent(id)
  }

  // ── Roster global (todos los agentes instalados) + campos del workspace ──
  const clip = (s, n) => (String(s ?? '').length <= n ? String(s ?? '') : String(s).slice(0, n - 1).trimEnd() + '…')
  // in_team / working_now / open_tasks salen del workspace; el catálogo en sí es global. El COO siempre está presente.
  function rosterState(ws) {
    // Una empresa usa varios equipos a la vez (marketing, ventas, finanzas…): in_team = está en alguno de sus equipos.
    const inTeam = new Set(listTeams(ws).flatMap((t) => t.members.map((m) => m.agent_id)))
    const working = new Set(listSessions(ws).filter((s) => s.status === 'working').map((s) => agentKey(s.agent)))
    const open = {}
    for (const t of listTasks(ws)) if (t.status !== 'done' && t.agent) open[agentKey(t.agent)] = (open[agentKey(t.agent)] ?? 0) + 1
    return (id) => ({ in_team: id === 'coo' || inTeam.has(id), working_now: working.has(id), open_tasks: open[id] ?? 0 })
  }
  function getRoster({ plugin = null, agent = null } = {}, ws = DEFAULT_WS) {
    needWorkspace(ws)
    const st = rosterState(ws)
    const full = (p) => ({ id: p.id, description: p.description, agents: p.agents.map((a) => ({ ...a, ...st(a.id) })), skills: p.skills })
    const ids = `Equipos: ${roster.plugins.map((p) => p.id).join(', ')}`
    if (agent) {
      const id = agentKey(agent)
      for (const p of roster.plugins) {
        const a = p.agents.find((x) => x.id === id)
        if (a) return { plugin: p.id, plugin_description: p.description, agent: { ...a, ...st(a.id) }, skills: p.skills }
      }
      throw new AppError('unknown_agent', `No existe el agente «${agent}» en el roster. Agentes: ${roster.plugins.flatMap((p) => p.agents.map((a) => a.id)).join(', ')}`, 404)
    }
    if (plugin) {
      const p = roster.plugins.find((x) => x.id === String(plugin).trim().toLowerCase())
      if (!p) throw new AppError('unknown_plugin', `No existe el equipo «${plugin}» en el roster. ${ids}`, 404)
      return full(p)
    }
    return { generated_at: roster.generated_at, source: roster.source, plugins: roster.plugins.map(full) }
  }
  // Versión compacta para backoffice_overview: descripciones ≤160 caracteres.
  function rosterOverview(ws) {
    const st = rosterState(ws)
    const plugins = roster.plugins.map((p) => ({ id: p.id, description: clip(p.description, 160), agents: p.agents.map((a) => ({ id: a.id, description: clip(a.description, 160), model: a.model, ...st(a.id) })), skills_count: p.skills.length }))
    const agents = plugins.flatMap((p) => p.agents)
    return { plugins, totals: { plugins: plugins.length, agents: agents.length, skills: roster.plugins.reduce((n, p) => n + p.skills.length, 0) }, not_in_team: agents.filter((a) => !a.in_team).map((a) => a.id) }
  }

  const STATUS_WEIGHT = { waiting: 4, working: 3, error: 2, idle: 1, offline: 0 }
  // Foto del momento para el COO: equipos, qué hace cada agente, tareas por estado y lo que espera a la persona.
  function overview(ws = DEFAULT_WS) {
    const wsRow = needWorkspace(ws)
    const sessions = listSessions(ws).filter((s) => s.status !== 'offline')
    const tasks = listTasks(ws)
    const bestFor = (agent) =>
      sessions.filter((s) => agentKey(s.agent) === agent).sort((a, b) => STATUS_WEIGHT[b.status] - STATUS_WEIGHT[a.status] || b.last_event_at - a.last_event_at)[0]
    const teams = listTeams(ws).map((t) => ({
      id: t.id,
      name: t.name,
      members: t.members.map((m) => {
        const s = bestFor(m.agent_id)
        return {
          agent_id: m.agent_id,
          name: m.display_name || m.agent_id,
          status: s?.status ?? 'offline',
          detail: s?.detail ?? null,
          open_tasks: tasks.filter((x) => agentKey(x.agent) === m.agent_id && !CLOSED_TASK.includes(x.status)).map((x) => ({ id: x.id, title: x.title, status: x.status })),
        }
      }),
    }))
    const counts = taskCounts()
    for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
    const known = new Set(listTeams(ws).flatMap((t) => t.members.map((m) => m.agent_id)))
    const coo = getSystemAgent('coo', ws)
    return {
      now: now(),
      workspace: { id: wsRow.id, name: wsRow.name },
      coo: { display_name: coo.display_name || 'Assistant' },
      teams,
      tasks: counts,
      leads: leadCounts(ws),
      needs_you: tasks.filter((t) => t.status === 'review' || t.status === 'blocked').map((t) => ({ task_id: t.id, title: t.title, agent: t.agent, status: t.status })),
      roster: rosterOverview(ws),
      files_hint: FILES_NOTE,
      loose_sessions: sessions.filter((s) => !s.agent || (!known.has(agentKey(s.agent)) && agentKey(s.agent) !== 'coo')).map((s) => ({ id: s.id, project: s.project, status: s.status, detail: s.detail })),
    }
  }

  // ── Ajustes y eventos de archivos ──
  const getSetting = (key) => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    if (!r) return null
    try { return JSON.parse(r.value) } catch { return null }
  }
  const setSetting = (key, value) => {
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(value), now())
  }
  const allWorkspaceIds = () => db.prepare('SELECT id FROM workspaces ORDER BY id').all().map((r) => r.id)
  // Evento `files` (SSE, por workspace): la web refresca sus listados.
  const emitFiles = (ws, data = {}) => bus.emit('change', { type: 'files', data: { workspace_id: ws, ...data }, workspace_id: ws })

  // ---------- perfil de la persona (global, una fila) ----------
  const insightView = (r) => ({ id: r.id, text: r.text, category: r.category, source: r.source, created_at: r.created_at })
  const getProfile = (insightLimit = 50) => {
    const r = db.prepare('SELECT * FROM user_profile WHERE id = 1').get()
    const profile = { updated_at: r.updated_at || null }
    for (const f of PROFILE_FIELDS) profile[f] = r[f]
    const lim = Math.min(Math.max(Number(insightLimit) || 50, 1), KEEP_INSIGHTS)
    return { profile, insights: db.prepare('SELECT * FROM profile_insights ORDER BY id DESC LIMIT ?').all(lim).map(insightView) }
  }
  const emitProfile = () => bus.emit('change', { type: 'profile', data: getProfile(), workspace_id: null })
  function updateProfile(patch = {}) {
    const sets = []
    const vals = []
    for (const f of PROFILE_FIELDS) {
      if (patch?.[f] === undefined) continue
      if (typeof patch[f] !== 'string') throw new AppError('bad_request', `${f} must be text`)
      const v = patch[f].trim()
      const max = f === 'preferred_name' ? NAME_MAX : PROFILE_MAX
      if (v.length > max) throw new AppError('too_long', `${f} is too long (max ${max} characters)`)
      if (v && SENSITIVE.some((re) => re.test(v))) throw new AppError('sensitive', `${f} looks like it contains sensitive data (password, card number or key); do not store it`)
      sets.push(`${f} = ?`)
      vals.push(v)
    }
    if (!sets.length) throw new AppError('bad_request', `Send at least one of: ${PROFILE_FIELDS.join(', ')}`)
    db.prepare(`UPDATE user_profile SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`).run(...vals, now())
    emitProfile()
    return getProfile()
  }
  function addInsight({ text, category = 'other', source = 'assistant' } = {}) {
    const t = typeof text === 'string' ? text.trim() : ''
    if (!t) throw new AppError('bad_request', 'text is required')
    if (t.length > INSIGHT_MAX) throw new AppError('too_long', `text is too long (max ${INSIGHT_MAX} characters)`)
    if (!INSIGHT_CATEGORIES.includes(category)) throw new AppError('bad_request', `category must be one of: ${INSIGHT_CATEGORIES.join(', ')}`)
    if (!INSIGHT_SOURCES.includes(source)) throw new AppError('bad_request', `source must be one of: ${INSIGHT_SOURCES.join(', ')}`)
    if (SENSITIVE.some((re) => re.test(t))) throw new AppError('sensitive', 'This looks like sensitive data (password, card number or key); do not store it')
    const r = db.prepare('INSERT INTO profile_insights (text, category, source, created_at) VALUES (?, ?, ?, ?)').run(t, category, source, now())
    db.prepare('DELETE FROM profile_insights WHERE id <= (SELECT MAX(id) - ? FROM profile_insights)').run(KEEP_INSIGHTS)
    emitProfile()
    return insightView(db.prepare('SELECT * FROM profile_insights WHERE id = ?').get(Number(r.lastInsertRowid)))
  }
  function deleteInsight(id) {
    const r = db.prepare('DELETE FROM profile_insights WHERE id = ?').run(Number(id))
    if (!r.changes) throw new AppError('not_found', 'Insight not found', 404)
    emitProfile()
  }

  // Resumen por proyecto (workspace no archivado): equipos, tareas abiertas/en revisión/bloqueadas y agentes esperando a la persona.
  function projectsSummary() {
    return listWorkspaceRows().map((w) => {
      const tasks = listTasks(w.id)
      const c = taskCounts()
      for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1
      const teams = listTeams(w.id)
      const waiting = listSessions(w.id).filter((s) => s.status === 'waiting').map((s) => agentKey(s.agent)).filter(Boolean)
      return {
        id: w.id,
        name: w.name,
        root: w.root,
        teams: teams.map((t) => ({ id: t.id, name: t.name, members: t.members.map((m) => (m.display_name ? `${m.display_name} (${m.agent_id})` : m.agent_id)) })),
        leads: leadCounts(w.id),
        tasks: { open: tasks.length - c.done - c.cancelled, review: c.review, blocked: c.blocked, doing: c.doing, todo: c.todo, backlog: c.backlog },
        agents_waiting: [...new Set(waiting)],
      }
    })
  }

  // El COO recibe contexto siempre (tenga o no equipos): quién es, TODOS los proyectos y lo que la persona le escribió.
  // `ws` sólo sirve para decirle en qué carpeta/proyecto se abrió esta sesión; no limita lo que ve.
  const COO_PROJECTS_MAX = 12
  function cooContext(ws = DEFAULT_WS) {
    const wsRow = needWorkspace(ws)
    const me = getSystemAgent('coo', ws)
    const lines = ['## Contexto de Back Office · Assistant', `Eres Assistant, la recepcionista de Back Office (id interno coo)${me.display_name ? `, y la persona te llama ${me.display_name}` : ''}: el puente entre todo el roster, los equipos y la persona. Eres una sola Assistant para todos los proyectos de la persona: ves y administras todos. Empieza con backoffice_projects y luego backoffice_overview del proyecto relevante; para trabajar en otro proyecto pasa su id en el argumento \`workspace\` de las herramientas.`]
    const projects = projectsSummary()
    lines.push('', `Proyectos (${projects.length}); estás abierta en la carpeta de «${wsRow.name}» (${wsRow.id}), pero no te limita a ese proyecto:`)
    const row = (p) => {
      const tm = p.teams.length ? p.teams.map((t) => `«${t.name}» (${clip(t.members.join(', ') || 'sin agentes', 160)})`).join(', ') : 'ninguno todavía (se arman en la pestaña Equipos)'
      const wait = p.agents_waiting.length ? `; esperan a la persona: ${p.agents_waiting.join(', ')}` : ''
      return `- «${p.name}» (${p.id})${p.id === wsRow.id ? ' ← carpeta actual' : ''}: equipos ${tm}; tareas abiertas ${p.tasks.open}, en revisión ${p.tasks.review}, bloqueadas ${p.tasks.blocked}${wait}`
    }
    const needs = (p) => p.tasks.review + p.tasks.blocked + p.agents_waiting.length
    const sorted = [...projects].sort((a, b) => (b.id === wsRow.id) - (a.id === wsRow.id) || needs(b) - needs(a))
    for (const p of sorted.slice(0, COO_PROJECTS_MAX)) lines.push(clip(row(p), 400))
    if (sorted.length > COO_PROJECTS_MAX) {
      const rest = sorted.slice(COO_PROJECTS_MAX)
      lines.push(`- y ${rest.length} proyectos más (${rest.map((p) => p.id).join(', ')}): detalle con backoffice_projects.`)
    }
    if (me.context.trim()) lines.push('', 'Contexto que la persona definió para ti:', me.context.trim())
    const { profile: pf } = getProfile(1)
    if (pf.preferred_name || pf.current_focus) lines.push(`Perfil de la persona:${pf.preferred_name ? ` le dices ${pf.preferred_name}.` : ''}${pf.current_focus ? ` Enfoque actual: ${clip(pf.current_focus, 160)}` : ''} (detalle con backoffice_profile_read).`)
    const ro = rosterOverview(ws)
    lines.push('', `Roster instalado (plugin backoffice): ${ro.totals.agents} agentes en ${ro.totals.plugins} equipos (${ro.totals.skills} skills). Hay agentes que todavía no están en ningún equipo y también puedes recomendarlos.`,
      'Antes de recomendar a alguien consulta backoffice_overview.roster o backoffice_roster {plugin?, agent?} y lee su descripción; nunca recomiendes un agente sin haberla leído.')
    for (const p of ro.plugins) lines.push(`- ${p.id} (${p.agents.length} agentes: ${p.agents.map((a) => a.id).join(', ')}): ${clip(p.description, 110)}`)
    lines.push('', FILES_NOTE)
    return lines.join('\n')
  }

  // Texto que se adjunta a la conversación de un agente: contexto de su equipo + el suyo. null si no hay nada que adjuntar.
  function contextFor(agent, ws = DEFAULT_WS) {
    const key = agentKey(agent)
    if (key === 'coo') return cooContext(ws)
    const wsRow = needWorkspace(ws)
    // Todos los equipos trabajan a la vez: el agente recibe el contexto de SU equipo (el más antiguo si está en varios).
    const team = listTeams(ws).find((t) => t.members.some((m) => m.agent_id === key))
    const me = team?.members.find((m) => m.agent_id === key)
    if (!team || !me) return null
    const label = (m) => (m.display_name ? `${m.display_name} (${m.agent_id})` : m.agent_id)
    const mates = team.members.filter((m) => m.agent_id !== key).map(label)
    const lines = [`## Contexto de Back Office · equipo «${team.name}»`, `Workspace: «${wsRow.name}» (${wsRow.id}).`, `Eres «${key}»${me.display_name ? `, y en este equipo te llaman ${me.display_name}` : ''}.${mates.length ? ` Tus compañeros: ${mates.join(', ')}.` : ''}`]
    if (me.context.trim()) lines.push('', 'Contexto que la persona definió para ti:', me.context.trim())
    if (!(me.context.trim() || me.display_name || mates.length)) return null
    lines.push('', FILES_NOTE)
    return lines.join('\n')
  }

  // ---------- leads (prospectos) ----------
  const LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']
  const LEAD_SOURCES = ['whatsapp', 'instagram', 'facebook', 'meta_form', 'email', 'web', 'referral', 'other']
  const bad = (m) => new AppError('bad_request', m)
  const leadIn = (id, ws) => {
    const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
    if (!l || (ws && l.workspace_id !== ws)) throw new AppError('not_found', `No existe el lead ${id}`, 404)
    return l
  }
  const strOrNull = (v, max, label) => {
    if (v === null || v === undefined) return null
    if (typeof v !== 'string') throw bad(`${label} debe ser texto`)
    if (v.length > max) throw bad(`${label} admite hasta ${max} caracteres`)
    return v.trim() === '' ? null : v
  }
  // Valida/normaliza sólo los campos presentes en `p`.
  function leadFields(p) {
    const o = {}
    if ('name' in p) {
      const n = typeof p.name === 'string' ? p.name.trim() : ''
      if (!n || n.length > 120) throw bad('name es obligatorio (1 a 120 caracteres)')
      o.name = n
    }
    if ('company' in p) o.company = strOrNull(p.company, 120, 'company')
    if ('contact' in p) o.contact = strOrNull(p.contact, 200, 'contact')
    if ('interest' in p) o.interest = strOrNull(p.interest, 300, 'interest')
    if ('notes' in p) o.notes = strOrNull(p.notes, 20000, 'notes')
    if ('lost_reason' in p) o.lost_reason = strOrNull(p.lost_reason, 500, 'lost_reason')
    if ('files' in p) o.files = strOrNull(p.files, 300, 'files')
    if ('source' in p) {
      if (!LEAD_SOURCES.includes(p.source)) throw bad(`source inválido; usa: ${LEAD_SOURCES.join(', ')}`)
      o.source = p.source
    }
    if ('stage' in p) {
      if (!LEAD_STAGES.includes(p.stage)) throw bad(`stage inválido; usa: ${LEAD_STAGES.join(', ')}`)
      o.stage = p.stage
    }
    if ('score' in p) {
      if (p.score === null) o.score = null
      else if (!Number.isInteger(p.score) || p.score < 0 || p.score > 100) throw bad('score debe ser un entero de 0 a 100 o null')
      else o.score = p.score
    }
    if ('next_contact_at' in p) {
      if (p.next_contact_at === null || p.next_contact_at === '') o.next_contact_at = null
      else if (typeof p.next_contact_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.next_contact_at) || Number.isNaN(Date.parse(p.next_contact_at))) throw bad('next_contact_at debe ser YYYY-MM-DD o null')
      else o.next_contact_at = p.next_contact_at
    }
    if ('value' in p) {
      if (p.value === null) o.value = null
      else if (typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0) throw bad('value debe ser un número >= 0 o null')
      else o.value = p.value
    }
    if ('position' in p) {
      if (typeof p.position !== 'number' || !Number.isFinite(p.position)) throw bad('position debe ser un número')
      o.position = p.position
    }
    return o
  }
  function createLead(body = {}, ws = DEFAULT_WS, human = false) {
    needWorkspace(ws)
    const f = leadFields(body)
    if (!f.name) throw bad('name es obligatorio (1 a 120 caracteres)')
    if (f.stage === 'won' && !human) throw bad('Only the person marks a lead as won (they do it in the web).')
    if (f.stage === 'lost' && !(f.lost_reason || f.notes)) throw bad('A lead can only be marked lost with a reason (lost_reason or notes).')
    const ts = now()
    const minPos = db.prepare('SELECT MIN(position) AS m FROM leads WHERE workspace_id = ? AND stage = ?').get(ws, f.stage ?? 'new').m
    const row = { source: 'other', stage: 'new', ...f, position: f.position ?? (minPos ?? 0) - 1 }
    const id = `L-${randomUUID().slice(0, 8)}`
    db.prepare(`INSERT INTO leads (id, workspace_id, name, company, contact, source, interest, stage, score, next_contact_at, value, notes, lost_reason, files, agent, position, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, ws, row.name, row.company ?? null, row.contact ?? null, row.source, row.interest ?? null, row.stage, row.score ?? null, row.next_contact_at ?? null,
      row.value ?? null, row.notes ?? null, row.lost_reason ?? null, row.files ?? null, human ? 'humano' : (typeof body.agent === 'string' ? body.agent.slice(0, 60) : null), row.position, ts, ts)
    const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
    emit('lead', l)
    return l
  }
  function updateLead(id, patch = {}, ws = null, human = false) {
    const cur = leadIn(id, ws)
    const f = leadFields(patch)
    if (f.stage === 'won' && !human && cur.stage !== 'won') throw bad('Only the person marks a lead as won (they do it in the web).')
    if (!human && cur.stage === 'won' && f.stage && f.stage !== 'won') throw bad('Only the person can move a won lead out of won.')
    const next = { ...cur, ...f }
    if (f.stage === 'lost' && cur.stage !== 'lost' && !((next.lost_reason ?? '').trim() || ('notes' in f && (f.notes ?? '').trim()))) throw bad('A lead can only be marked lost with a reason (lost_reason or notes).')
    if (f.stage && f.stage !== cur.stage && !('position' in f)) {
      next.position = (db.prepare('SELECT MIN(position) AS m FROM leads WHERE workspace_id = ? AND stage = ?').get(cur.workspace_id, f.stage).m ?? 0) - 1
    }
    next.agent = human ? 'humano' : (typeof patch.agent === 'string' ? patch.agent.slice(0, 60) : cur.agent)
    db.prepare(`UPDATE leads SET name=?, company=?, contact=?, source=?, interest=?, stage=?, score=?, next_contact_at=?, value=?, notes=?, lost_reason=?, files=?, agent=?, position=?, updated_at=? WHERE id=?`).run(
      next.name, next.company, next.contact, next.source, next.interest, next.stage, next.score, next.next_contact_at, next.value, next.notes, next.lost_reason, next.files, next.agent, next.position, now(), id)
    const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
    emit('lead', l)
    return l
  }
  function deleteLead(id, ws = null) {
    const l = leadIn(id, ws)
    db.prepare('DELETE FROM leads WHERE id = ?').run(id)
    emit('lead_deleted', { id, workspace_id: l.workspace_id })
    return { ok: true, id }
  }
  function listLeads(ws = DEFAULT_WS, { stage, query } = {}) {
    let rows = db.prepare('SELECT * FROM leads WHERE workspace_id = ? ORDER BY position ASC, created_at DESC').all(ws)
    if (stage) rows = rows.filter((l) => l.stage === stage)
    const q = String(query ?? '').trim().toLowerCase()
    if (q) rows = rows.filter((l) => [l.name, l.company, l.contact, l.interest, l.notes].some((v) => (v ?? '').toLowerCase().includes(q)))
    return rows
  }
  const leadCounts = (ws) => {
    const c = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0]))
    for (const r of db.prepare('SELECT stage, COUNT(*) AS n FROM leads WHERE workspace_id = ? GROUP BY stage').all(ws)) c[r.stage] = r.n
    return c
  }

  const listTasks = (ws = DEFAULT_WS) => q.tasks.all(ws).map(withOutputs)
  const listOutputs = (ws = DEFAULT_WS, limit = 100) => q.outputs.all(ws, limit).map(outView)
  const recentEvents = (limit = 100, ws = DEFAULT_WS) => q.recent.all(ws, limit).map((e) => ({ ...e, payload: undefined }))

  // ---------- almacenamiento de objetos ----------
  const getOutput = (id) => {
    const o = db.prepare('SELECT * FROM outputs WHERE id = ?').get(Number(id))
    return o ? outView(o) : null
  }
  const rawOutput = (id) => db.prepare('SELECT * FROM outputs WHERE id = ?').get(Number(id))
  // Guarda el resultado de una subida (o su error) y avisa a la web.
  function setOutputStorage(id, f) {
    const o = rawOutput(id)
    if (!o) return null
    db.prepare(`UPDATE outputs SET bucket = ?, storage_key = ?, size = ?, content_type = ?, sha256 = ?, uploaded_at = ?, storage_error = ?, files = ? WHERE id = ?`).run(
      f.bucket ?? null, f.storage_key ?? null, f.size ?? null, f.content_type ?? null, f.sha256 ?? null, f.uploaded_at ?? null, f.storage_error ?? null, f.files ? JSON.stringify(f.files) : null, o.id)
    const t = q.getTask.get(o.task_id)
    if (t) emit('task', withOutputs(t))
    return getOutput(o.id)
  }
  // ¿Otro entregable de la misma tarea ya usa esta clave/prefijo? (para evitar choques de nombres)
  const keyTaken = (taskId, outputId, key) =>
    db.prepare('SELECT id, storage_key, files FROM outputs WHERE task_id = ? AND id != ?').all(taskId, outputId).some((o) => o.storage_key === key || (o.files ?? '').includes(`"key":${JSON.stringify(key)}`))
  // Conversaciones ya ligadas (session_ref) en todos los proyectos: id → [{ project, team, agent }]. La de Assistant cuenta también.
  function sessionLinks() {
    const out = {}
    const add = (ref, info) => { const k = String(ref ?? '').trim(); if (k) (out[k] ??= []).push(info) }
    const rows = db.prepare(`SELECT tm.session_ref AS ref, tm.agent_id AS agent, t.name AS team, w.id AS wid, w.name AS project
      FROM team_members tm JOIN teams t ON t.id = tm.team_id LEFT JOIN workspaces w ON w.id = t.workspace_id
      WHERE tm.session_ref IS NOT NULL AND tm.session_ref <> '' AND (w.archived_at IS NULL)`).all()
    for (const r of rows) add(r.ref, { project: r.project ?? r.wid, workspace: r.wid, team: r.team, agent: r.agent })
    const coo = getSystemAgent('coo')
    if (coo?.session_ref) add(coo.session_ref, { project: null, workspace: null, team: null, agent: 'coo' })
    return out
  }

  return { bus, db, DEFAULT_WS, inTx, humanUpdateTask, sessionLinks, getProfile, updateProfile, addInsight, deleteInsight, getSetting, setSetting, allWorkspaceIds, emitFiles, addVirtualOutput, listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, needWorkspace, resolveWorkspace, workspaceForCwd, rootsAllowed, getOutput, setOutputStorage, keyTaken, getSystemAgent, listSystemAgents, updateSystemAgent, overview, projectsSummary, getRoster, listTeams, getTeam, createTeam, updateTeam, deleteTeam, activateTeam, contextFor, recordEvent, checkin, isKnownPath, listSessions, createTask, createLead, updateLead, deleteLead, listLeads, setTaskStatus, deleteTask, planTaskMove, applyTaskMove, updateTask, approveTask, addOutput, listTasks, listOutputs, recentEvents, getTask: (id, ws = null) => { const t = q.getTask.get(id); return t && (!ws || t.workspace_id === ws) ? withOutputs(t) : undefined } }
}
