// Canvas: tablero de artefactos que los agentes publican para que la persona los revise (html, markdown, imagen, pdf,
// csv/texto). Cada artefacto vive en un alcance (workspace, team o agent) y tiene versiones, estado y comentarios.
// Los agentes crean, agregan versiones, comentan y piden revisión (draft → in_review); sólo la persona aprueba o pide
// cambios (decide). Nada se sobrescribe: cada versión es un objeto nuevo en canvas/<scope_type>/<scope_id>/<id>/v<n>.<ext>.
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { AppError, bucketOf } from './store.mjs'
import { reporterOf } from './issues.mjs'
import { contentTypeOf } from './outputs-storage.mjs'
import { DEFAULT_LIMITS } from './files.mjs'

export const CANVAS = 'canvas/'
export const SCOPES = ['workspace', 'team', 'agent']
export const ARTIFACT_STATUSES = ['draft', 'in_review', 'approved', 'changes_requested']
export const DECISIONS = ['approved', 'changes_requested'] // sólo la persona
const HUMAN = 'humano'
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/
const bad = (m, code = 'bad_request') => new AppError(code, m, 400)
// Id del agente que llama; «humano» está reservado para la persona.
const agentOf = (v) => {
  const id = reporterOf(v)
  if (id === HUMAN) throw new AppError('human_only', 'Only the person writes as «humano»; use your own agent id', 403)
  return id
}
const text = (v, max, label, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${label} is required`); return null }
  if (typeof v !== 'string') throw bad(`${label} must be text`)
  const t = v.trim()
  if (required && !t) throw bad(`${label} is required`)
  if (t.length > max) throw bad(`${label} is too long (max ${max} characters)`)
  return t || null
}

// Tipo de vista del artefacto, igual que el visor de la web (lib/files.ts previewKind). null = no se puede revisar en el canvas.
const MD = new Set(['.md', '.markdown'])
export function kindOf(contentType, name = '') {
  const t = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  const ext = extname(String(name)).toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t === 'text/html' || t === 'application/xhtml+xml') return 'html'
  if (t === 'application/pdf') return 'pdf'
  if (t === 'text/markdown' || MD.has(ext)) return 'markdown'
  if (t === 'text/csv' || t === 'text/tab-separated-values' || ext === '.csv' || ext === '.tsv') return 'csv'
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml') return 'text'
  return null
}
const EXT = { html: '.html', markdown: '.md', pdf: '.pdf', csv: '.csv', text: '.txt' }
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif' }
const extFor = (name, kind, type) => {
  const e = extname(String(name ?? '')).toLowerCase()
  if (/^\.[a-z0-9]{1,10}$/.test(e)) return e
  return kind === 'image' ? IMG_EXT[String(type).split(';')[0].trim().toLowerCase()] ?? '.img' : EXT[kind]
}

export function createCanvas({ db, store, blobs, files, limits = DEFAULT_LIMITS }) {
  const now = () => Date.now()
  const emit = (a) => store.bus.emit('change', { type: 'canvas', data: a, workspace_id: a.workspace_id })

  const LIST_SQL = `SELECT a.*, v.content_type, v.size, v.created_at AS version_at,
      (SELECT COUNT(*) FROM artifact_comments c WHERE c.artifact_id = a.id) AS comments,
      (SELECT COUNT(*) FROM artifact_comments c WHERE c.artifact_id = a.id AND c.author = '${HUMAN}' AND c.read_by_agent = 0) AS unread_human
    FROM artifacts a LEFT JOIN artifact_versions v ON v.artifact_id = a.id AND v.n = a.current_version`
  // Lo pendiente de un agente: artefactos suyos (autor o alcance agent) con cambios pedidos o comentarios de la persona sin leer.
  const MINE = `(a.author_agent = ? OR (a.scope_type = 'agent' AND a.scope_id = ?))`
  const PENDING = `(a.status = 'changes_requested' OR EXISTS (SELECT 1 FROM artifact_comments c WHERE c.artifact_id = a.id AND c.author = '${HUMAN}' AND c.read_by_agent = 0))`
  const listRow = (id) => db.prepare(`${LIST_SQL} WHERE a.id = ?`).get(id)
  const artifactIn = (id, ws) => {
    const a = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(String(id ?? ''))
    if (!a || a.workspace_id !== ws) throw new AppError('not_found', `No existe el artefacto ${id}`, 404)
    return a
  }
  const rawUrl = (a, n) => `/api/workspaces/${a.workspace_id}/canvas/${a.id}/v/${n}`
  const homeRow = (ws) => db.prepare('SELECT * FROM artifacts WHERE workspace_id = ? AND is_home = 1').get(ws)

  // scope_id por defecto: workspace = el workspace; agent = el agente que llama; team = el equipo del workspace que lo
  // incluye (el más antiguo si son varios) o, si no está en ninguno, el plugin del roster al que pertenece.
  function resolveScope(scopeType, scopeId, agent, ws) {
    if (!SCOPES.includes(scopeType)) throw bad(`scope_type must be one of: ${SCOPES.join(', ')}`)
    const sid = scopeId === undefined || scopeId === null || scopeId === '' ? null : String(scopeId).trim().toLowerCase()
    if (scopeType === 'workspace') {
      if (sid && sid !== ws) throw bad(`The scope_id of a workspace scope is the workspace id (${ws}); omit it`)
      return ws
    }
    if (scopeType === 'agent') {
      const id = reporterOf(sid ?? agent)
      if (!id) throw bad('scope_id (an agent id) is required')
      store.getRoster({ agent: id }, ws) // agente desconocido = 404 con la lista
      return id
    }
    if (sid) {
      if (!ID_RE.test(sid)) throw bad('Invalid team id')
      if (store.getTeam(sid, ws) || store.getRoster({}, ws).plugins.some((p) => p.id === sid)) return sid
      throw new AppError('not_found', `No existe el equipo ${sid} en este workspace`, 404)
    }
    const t = store.listTeams(ws).find((x) => x.members.some((m) => m.agent_id === agent))
    return t ? t.id : store.getRoster({ agent }, ws).plugin
  }

  // Contenido de la versión nueva: archivo del almacenamiento (`path`; se copia, así que editar el archivo después no cambia
  // lo revisado) o en línea {name, content|content_base64, content_type?}. null = no vino contenido.
  async function source(b, ws, input) {
    const hasInline = input.content !== undefined || input.content_base64 !== undefined
    if (input.path !== undefined && input.path !== null && input.path !== '') {
      if (hasInline) throw bad('Send path or inline content, not both')
      const rel = files.normalizeRel(ws, input.path)
      const key = files.keyOfRel(rel)
      const h = await blobs.head(b, key)
      if (!h) throw new AppError('not_found', `No such file in workspace storage: ${rel}`, 404)
      if (h.size > limits.maxFileBytes) throw new AppError('too_large', `File is larger than the ${limits.maxFileBytes} byte limit`, 413)
      const name = rel.split('/').pop()
      return { name, type: h.contentType || contentTypeOf(name), size: h.size, copyFrom: key }
    }
    if (!hasInline) return null
    if (input.content !== undefined && input.content_base64 !== undefined) throw bad('Send content or content_base64, not both')
    const name = text(input.name, 240, 'name', { required: true })
    if (name.includes('/') || name.includes('\\') || /[\x00-\x1f\x7f]/.test(name)) throw bad(`Invalid file name: ${name}`)
    if (typeof (input.content_base64 ?? input.content) !== 'string') throw bad('content (utf-8 text) or content_base64 must be a string')
    const buf = typeof input.content_base64 === 'string' ? Buffer.from(input.content_base64, 'base64') : Buffer.from(input.content, 'utf8')
    if (buf.length > limits.maxFileBytes) throw new AppError('too_large', `${name} is larger than the file limit`, 413)
    const known = contentTypeOf(name)
    const type = text(input.content_type, 120, 'content_type') || (typeof input.content === 'string' && known === 'application/octet-stream' ? 'text/plain; charset=utf-8' : known)
    return { name, type, size: buf.length, buf }
  }

  // Agentes (MCP): artefacto nuevo, o versión nueva con `artifact_id`. El estado queda in_review (o draft con request_review:false);
  // approved / changes_requested no se pueden poner desde aquí. Con `home: true` (cualquier agente; normalmente el encargado del proyecto) es el inicio del proyecto: uno por
  // workspace, alcance workspace, siempre draft (página viva, no se revisa); si ya existe se le agrega una versión.
  async function publish(input = {}, ws) {
    store.needWorkspace(ws)
    const agent = agentOf(input.agent)
    if (!agent) throw bad('agent is required: your own agent id (e.g. cmo)')
    const note = text(input.note, 1000, 'note')
    const description = text(input.description, 2000, 'description')
    const home = input.home === true || input.home === 'true'
    let a = input.artifact_id ? artifactIn(input.artifact_id, ws) : home ? homeRow(ws) ?? null : null
    if (home && a && !a.is_home) throw bad('artifact_id is not the home of this project; omit it with home: true')
    const isHome = home || !!a?.is_home
    if (isHome && input.scope_type && input.scope_type !== 'workspace') throw bad('The project home always lives in the workspace scope')
    const status = isHome || input.request_review === false ? 'draft' : 'in_review'
    const title = text(input.title, 200, 'title', { required: !a && !isHome }) ?? (isHome && !a ? 'Inicio del proyecto' : null)
    let taskId = a?.task_id ?? null
    if (input.task_id) {
      if (!store.getTask(String(input.task_id), ws)) throw new AppError('not_found', `No existe la tarea ${input.task_id} en este workspace`, 404)
      taskId = String(input.task_id)
    }
    const b = bucketOf(ws)
    const src = await source(b, ws, input)
    if (!src) {
      // Sin contenido sólo se puede pedir revisión de un borrador existente.
      if (!a || isHome) throw bad('Send path (a workspace file) or {name, content|content_base64}')
      if (status !== 'in_review' || a.status !== 'draft') throw bad('Without new content you can only move a draft to in_review (request_review: true)')
      db.prepare('UPDATE artifacts SET status = ?, updated_at = ? WHERE id = ?').run('in_review', now(), a.id)
      const out = listRow(a.id)
      emit(out)
      return { ...out, note: 'Pedido de revisión enviado: la persona lo ve en la pestaña Boards.' }
    }
    const kind = kindOf(src.type, src.name)
    if (!kind) throw bad(`Unsupported content type for the canvas: ${src.type}. Publish html, markdown, image, pdf, csv or text; deliver other files with backoffice_task_deliver.`, 'unsupported_kind')
    if (a && !isHome && (input.scope_type || input.scope_id)) throw bad('A new version keeps the scope of the artifact; omit scope_type/scope_id with artifact_id')
    const scopeType = a?.scope_type ?? (isHome ? 'workspace' : input.scope_type ?? 'agent')
    const scopeId = a?.scope_id ?? resolveScope(scopeType, input.scope_id, agent, ws)
    const id = a?.id ?? `A-${randomUUID().slice(0, 8)}`
    const n = (a?.current_version ?? 0) + 1
    const key = `${CANVAS}${scopeType}/${scopeId}/${id}/v${n}${extFor(src.name, kind, src.type)}`
    if (await blobs.head(b, key)) throw new AppError('conflict', 'That version already exists; retry', 409)
    const r = src.copyFrom ? await blobs.copy(b, src.copyFrom, key) : await blobs.put(b, key, src.buf, src.type)
    const ts = now()
    db.exec('BEGIN')
    try {
      if (a) db.prepare('UPDATE artifacts SET title = ?, description = ?, kind = ?, status = ?, task_id = ?, current_version = ?, updated_at = ? WHERE id = ?').run(title ?? a.title, description ?? a.description, kind, status, taskId, n, ts, id)
      else db.prepare('INSERT INTO artifacts (id, workspace_id, scope_type, scope_id, title, description, kind, status, author_agent, task_id, current_version, created_at, updated_at, is_home) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, ws, scopeType, scopeId, title, description, kind, status, agent, taskId, n, ts, ts, isHome ? 1 : 0)
      db.prepare('INSERT INTO artifact_versions (artifact_id, n, storage_key, content_type, size, note, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, n, key, src.type, r.size ?? src.size, note, agent, ts)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      await blobs.delete(b, key).catch(() => {}) // la fila no quedó: tampoco el objeto
      if (isHome && /UNIQUE/i.test(String(e?.message))) throw new AppError('conflict', 'The project home was just created by another call; publish again with home: true to add a version', 409)
      throw e
    }
    a = listRow(id)
    emit(a)
    if (isHome) return { ...a, version: n, url: rawUrl(a, n), note: 'Inicio del proyecto actualizado: la persona lo ve en la pestaña Inicio (sin revisión; puede comentarlo).' }
    return { ...a, version: n, url: rawUrl(a, n), note: status === 'in_review' ? 'Publicado en Boards: la persona lo revisa ahí (aprueba o pide cambios). Entrega la tarea como siempre.' : 'Guardado como borrador en Boards.' }
  }

  function list(ws, { scope_type, scope_id, status, needs_action, agent } = {}) {
    store.needWorkspace(ws)
    const where = ['a.workspace_id = ?']
    const args = [ws]
    if (scope_type) { if (!SCOPES.includes(scope_type)) throw bad(`scope_type must be one of: ${SCOPES.join(', ')}`); where.push('a.scope_type = ?'); args.push(scope_type) }
    if (scope_id) { where.push('a.scope_id = ?'); args.push(scope_type === 'agent' ? reporterOf(scope_id) : String(scope_id).toLowerCase()) }
    if (status) { if (!ARTIFACT_STATUSES.includes(status)) throw bad(`status must be one of: ${ARTIFACT_STATUSES.join(', ')}`); where.push('a.status = ?'); args.push(status) }
    if (needs_action === true || needs_action === 'true' || needs_action === '1') {
      const me = reporterOf(agent)
      if (!me) throw bad('needs_action needs agent (your own agent id)')
      where.push(MINE, PENDING)
      args.push(me, me)
    }
    return db.prepare(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC LIMIT 500`).all(...args)
  }

  // Cuántos artefactos esperan acción del agente (para checkin / team_context). Barato: un COUNT.
  const pendingFor = (agent, ws) => {
    const me = reporterOf(agent)
    if (!me) return 0
    return db.prepare(`SELECT COUNT(*) AS n FROM artifacts a WHERE a.workspace_id = ? AND ${MINE} AND ${PENDING}`).get(ws, me, me).n
  }

  // Detalle: versiones, comentarios y la tarea ligada. Con `agent` (MCP), si es el suyo, marca leídos los comentarios de la persona.
  function get(id, ws, { agent = null } = {}) {
    let a = artifactIn(id, ws)
    const me = reporterOf(agent)
    if (me && (a.author_agent === me || (a.scope_type === 'agent' && a.scope_id === me))) {
      const r = db.prepare(`UPDATE artifact_comments SET read_by_agent = 1 WHERE artifact_id = ? AND author = '${HUMAN}' AND read_by_agent = 0`).run(a.id)
      if (r.changes) emit(listRow(a.id))
    }
    a = listRow(a.id)
    const versions = db.prepare('SELECT n, content_type, size, note, author, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY n').all(a.id).map((v) => ({ ...v, url: rawUrl(a, v.n) }))
    const comments = db.prepare('SELECT id, version_n, author, body, decision, read_by_agent, created_at FROM artifact_comments WHERE artifact_id = ? ORDER BY id').all(a.id)
    const t = a.task_id ? store.getTask(a.task_id, ws) : null
    return { ...a, versions, comments, task: t ? { id: t.id, title: t.title, status: t.status } : null }
  }

  // `human`: la persona (web) comenta como «humano»; un agente comenta con su id.
  function comment(id, ws, { body, agent } = {}, human = false) {
    const a = artifactIn(id, ws)
    const msg = text(body, 4000, 'body', { required: true })
    const author = human ? HUMAN : agentOf(agent)
    if (!author) throw bad('agent is required: your own agent id')
    const ts = now()
    db.prepare('INSERT INTO artifact_comments (artifact_id, version_n, author, body, decision, read_by_agent, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(a.id, a.current_version, author, msg, human ? 0 : 1, ts)
    db.prepare('UPDATE artifacts SET updated_at = ? WHERE id = ?').run(ts, a.id)
    emit(listRow(a.id))
    return get(a.id, ws)
  }

  // Sólo la persona: aprueba o pide cambios (con comentario obligatorio). No toca la tarea ligada: esa se aprueba aparte.
  function decide(id, ws, { decision, comment: note } = {}) {
    const a = artifactIn(id, ws)
    if (a.is_home) throw bad('El inicio del proyecto no se aprueba: es una página viva. Comenta qué cambiar y Assistant publica una versión nueva.', 'home_no_review')
    if (!DECISIONS.includes(decision)) throw bad(`decision must be one of: ${DECISIONS.join(', ')}`)
    const msg = text(note, 4000, 'comment') ?? ''
    if (decision === 'changes_requested' && !msg) throw bad('Para pedir cambios escribe qué hay que cambiar')
    const ts = now()
    db.exec('BEGIN')
    try {
      db.prepare('INSERT INTO artifact_comments (artifact_id, version_n, author, body, decision, read_by_agent, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(a.id, a.current_version, HUMAN, msg, decision, ts)
      db.prepare('UPDATE artifacts SET status = ?, updated_at = ? WHERE id = ?').run(decision, ts, a.id)
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    emit(listRow(a.id))
    return get(a.id, ws)
  }

  // Versión para servir su contenido. La clave sale de la base, nunca de la URL.
  function version(id, ws, n) {
    const a = artifactIn(id, ws)
    const v = db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? AND n = ?').get(a.id, Number(n))
    if (!v) throw new AppError('not_found', 'No existe esa versión', 404)
    const base = a.title.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().slice(0, 80) || a.id
    return { bucket: bucketOf(ws), key: v.storage_key, contentType: v.content_type, name: `${base} v${v.n}${extname(v.storage_key)}` }
  }

  // Inicio del proyecto para la web: el artefacto home con su versión actual, o null si Assistant aún no lo arma.
  function home(ws) {
    store.needWorkspace(ws)
    const h = homeRow(ws)
    if (!h) return null
    const a = listRow(h.id)
    const v = db.prepare('SELECT note, author FROM artifact_versions WHERE artifact_id = ? AND n = ?').get(a.id, a.current_version)
    return { ...a, url: rawUrl(a, a.current_version), version_note: v?.note ?? null, version_author: v?.author ?? null }
  }

  return { publish, list, get, comment, decide, version, pendingFor, home }
}
