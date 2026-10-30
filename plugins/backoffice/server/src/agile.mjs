// Agile planning per workspace: epics → stories → tasks, and sprints (time boxes that hold stories and tasks).
// Same rule as tasks: agents plan and move work forward; only the person closes it. Agents never set an epic/story
// `done` or `cancelled` and never complete a sprint (they move it to `review` with a report). Deleting is person-only
// and only unlinks children (stories/tasks are never deleted with their epic/story/sprint).
import { randomUUID } from 'node:crypto'
import { AppError } from './store.mjs'

export const EPIC_STATUSES = ['planning', 'active', 'done', 'cancelled']
export const STORY_STATUSES = ['backlog', 'todo', 'doing', 'review', 'done', 'cancelled']
export const SPRINT_STATUSES = ['planning', 'active', 'review', 'completed']
const AGENT = { epics: ['planning', 'active'], stories: ['backlog', 'todo', 'doing', 'review'], sprints: ['planning', 'active', 'review'] }
const ALL = { epics: EPIC_STATUSES, stories: STORY_STATUSES, sprints: SPRINT_STATUSES }
const CLOSED = { epics: ['done', 'cancelled'], stories: ['done', 'cancelled'], sprints: ['completed'] }
const DEFAULT_STATUS = { epics: 'planning', stories: 'backlog', sprints: 'planning' }
const PREFIX = { epics: 'E', stories: 'S', sprints: 'SP' }
const NOUN = { epics: 'la épica', stories: 'la historia', sprints: 'el sprint' }
const TASK_STATUSES = ['backlog', 'todo', 'doing', 'blocked', 'review', 'done', 'cancelled']
const isOpenTask = (s) => s !== 'done' && s !== 'cancelled'

export function createAgile({ db, store }) {
  const now = () => Date.now()
  const emit = (type, data) => store.bus.emit('change', { type, data, workspace_id: data.workspace_id })
  const bad = (m) => new AppError('bad_request', m)
  const humanOnly = (m) => new AppError('human_only', m, 403)

  const rowIn = (kind, id, ws) => {
    const r = typeof id === 'string' ? db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id) : null
    if (!r || (ws && r.workspace_id !== ws)) throw new AppError('not_found', `No existe ${NOUN[kind]} ${id}`, 404)
    return r
  }
  const text = (p, k, max, required = false) => {
    if (!(k in p) && !required) return undefined
    const v = p[k]
    if (v === null || v === undefined) { if (required) throw bad(`${k} es obligatorio`); return null }
    if (typeof v !== 'string') throw bad(`${k} debe ser texto`)
    const s = v.trim()
    if (required && !s) throw bad(`${k} es obligatorio`)
    if (s.length > max) throw bad(`${k} admite hasta ${max} caracteres`)
    return s || null
  }
  const date = (p, k) => {
    if (!(k in p)) return undefined
    const v = p[k]
    if (v === null || v === '') return null
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${k} debe ser YYYY-MM-DD o null`)
    return v
  }
  // A link to another entity of the same workspace (null unlinks). A completed sprint takes no new work.
  const link = (p, k, kind, ws) => {
    if (!(k in p)) return undefined
    const v = p[k]
    if (v === null || v === '') return null
    const r = typeof v === 'string' ? db.prepare(`SELECT workspace_id, status FROM ${kind} WHERE id = ?`).get(v) : null
    if (!r || r.workspace_id !== ws) throw new AppError('bad_link', `No existe ${NOUN[kind]} ${v} en este proyecto`, 400)
    if (kind === 'sprints' && r.status === 'completed') throw new AppError('sprint_completed', `El sprint ${v} ya está completado; usa otro`, 409)
    return v
  }

  // Validates/normalizes only the fields present in `p`.
  function fields(kind, p, ws, creating) {
    const o = {}
    const set = (k, v) => { if (v !== undefined) o[k] = v }
    if (kind === 'sprints') {
      set('name', text(p, 'name', 120, creating || 'name' in p))
      set('goal', text(p, 'goal', 2000))
      set('start_date', date(p, 'start_date'))
      set('end_date', date(p, 'end_date'))
      set('report', text(p, 'report', 20000))
    } else {
      set('title', text(p, 'title', 200, creating || 'title' in p))
      set('description', text(p, 'description', 20000))
      set('owner_agent', text(p, 'owner_agent', 60))
    }
    if (kind === 'stories') {
      set('epic_id', link(p, 'epic_id', 'epics', ws))
      set('sprint_id', link(p, 'sprint_id', 'sprints', ws))
      if ('points' in p) {
        if (p.points === null) o.points = null
        else if (!Number.isInteger(p.points) || p.points < 0 || p.points > 100) throw bad('points debe ser un entero de 0 a 100 o null')
        else o.points = p.points
      }
    }
    if ('status' in p) {
      if (!ALL[kind].includes(p.status)) throw new AppError('bad_status', `Estado inválido: ${p.status}. Usa: ${ALL[kind].join(', ')}`)
      o.status = p.status
    }
    return o
  }

  // Agents move work forward; closing (done / cancelled / completed) and reopening something closed is the person's.
  function checkStatus(kind, cur, next, human) {
    if (next === undefined || next === cur?.status) return
    if (kind === 'sprints' && next === 'completed') throw new AppError('use_complete', 'Un sprint se completa sólo con «Completar sprint» en la web (POST /api/human/sprints/:id/complete).', 409)
    if (human) return
    if (cur && CLOSED[kind].includes(cur.status)) throw humanOnly(`${NOUN[kind]} ${cur.id} está ${cur.status}; sólo la persona la reabre.`)
    if (!AGENT[kind].includes(next)) throw humanOnly(`Sólo la persona marca ${NOUN[kind]} como ${next}. Los agentes usan: ${AGENT[kind].join(', ')}.`)
  }
  function checkSprint(id, ws, next, human) {
    if (next.status === 'active') {
      const other = db.prepare("SELECT id, name FROM sprints WHERE workspace_id = ? AND status = 'active' AND id != ?").get(ws, id ?? '')
      if (other) throw new AppError('sprint_active_exists', `Ya hay un sprint activo: «${other.name}» (${other.id}). Pásalo a review o complétalo antes.`, 409)
    }
    if (!human && next.status === 'review' && !(next.report ?? '').trim()) throw bad('Para pasar un sprint a review escribe su report (qué se logró, qué quedó pendiente).')
    if (next.start_date && next.end_date && next.end_date < next.start_date) throw bad('end_date no puede ser antes de start_date')
  }

  // ---------- views (counts computed on read: a workspace has tens of these, not thousands) ----------
  const countBy = (rows, key = 'status') => rows.reduce((c, r) => ((c[r[key]] = (c[r[key]] ?? 0) + 1), c), {})
  const taskProgress = (rows) => {
    const by_status = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0]))
    for (const r of rows) by_status[r.status] = (by_status[r.status] ?? 0) + 1
    const total = rows.length - by_status.cancelled
    return { total, done: by_status.done, percent: total ? Math.round((by_status.done / total) * 100) : 0, by_status }
  }
  const points = (stories) => ({
    points_total: stories.filter((s) => s.status !== 'cancelled').reduce((n, s) => n + (s.points ?? 0), 0),
    points_done: stories.filter((s) => s.status === 'done').reduce((n, s) => n + (s.points ?? 0), 0),
  })
  const epicView = (e) => {
    const stories = db.prepare('SELECT status, points FROM stories WHERE epic_id = ?').all(e.id)
    const tasks = db.prepare('SELECT t.status FROM tasks t JOIN stories s ON s.id = t.story_id WHERE s.epic_id = ?').all(e.id)
    return { ...e, stories: { total: stories.length, by_status: countBy(stories), ...points(stories) }, tasks: taskProgress(tasks) }
  }
  const storyView = (s) => ({ ...s, tasks: taskProgress(db.prepare('SELECT status FROM tasks WHERE story_id = ?').all(s.id)) })
  const sprintView = (sp) => {
    const stories = db.prepare('SELECT status, points FROM stories WHERE sprint_id = ?').all(sp.id)
    return { ...sp, progress: { tasks: taskProgress(db.prepare('SELECT status FROM tasks WHERE sprint_id = ?').all(sp.id)), stories: { total: stories.length, by_status: countBy(stories), ...points(stories) } } }
  }
  const VIEW = { epics: epicView, stories: storyView, sprints: sprintView }
  const EVENT = { epics: 'epic', stories: 'story', sprints: 'sprint' }
  const emitRow = (kind, id) => { const r = db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id); if (r) emit(EVENT[kind], VIEW[kind](r)); return r }
  const emitTasks = (ids) => { for (const id of ids) { const t = store.getTask(id); if (t) emit('task', t) } }

  const ORDER = {
    epics: "ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, created_at",
    stories: 'ORDER BY created_at',
    sprints: "ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'review' THEN 1 WHEN 'planning' THEN 2 ELSE 3 END, COALESCE(start_date, '9999'), created_at",
  }
  function list(kind, ws, filter = {}) {
    let rows = db.prepare(`SELECT * FROM ${kind} WHERE workspace_id = ? ${ORDER[kind]}`).all(ws)
    for (const k of ['status', 'epic_id', 'sprint_id']) {
      const v = filter[k]
      if (v === undefined || v === null || v === '') continue
      rows = rows.filter((r) => (v === 'none' ? r[k] == null : r[k] === v))
    }
    return rows.map(VIEW[kind])
  }
  const get = (kind, id, ws) => {
    const r = VIEW[kind](rowIn(kind, id, ws))
    if (kind === 'epics') return { ...r, items: list('stories', r.workspace_id, { epic_id: r.id }) }
    if (kind === 'stories' || kind === 'sprints') {
      const col = kind === 'stories' ? 'story_id' : 'sprint_id'
      const tasks = db.prepare(`SELECT id, title, status, agent, story_id, sprint_id FROM tasks WHERE ${col} = ? ORDER BY updated_at DESC`).all(r.id)
      return kind === 'sprints' ? { ...r, stories_list: list('stories', r.workspace_id, { sprint_id: r.id }), tasks_list: tasks } : { ...r, tasks_list: tasks }
    }
    return r
  }

  const COLS = {
    epics: ['title', 'description', 'status', 'owner_agent'],
    stories: ['epic_id', 'title', 'description', 'status', 'points', 'owner_agent', 'sprint_id'],
    sprints: ['name', 'goal', 'start_date', 'end_date', 'status', 'report'],
  }
  function create(kind, body = {}, ws = store.DEFAULT_WS, human = false) {
    store.needWorkspace(ws)
    const f = fields(kind, body ?? {}, ws, true)
    const row = { ...f, status: f.status ?? DEFAULT_STATUS[kind] }
    checkStatus(kind, null, row.status, human)
    if (kind === 'sprints') checkSprint(null, ws, row, human)
    if (kind !== 'sprints' && !('owner_agent' in f) && typeof body.agent === 'string') row.owner_agent = body.agent.slice(0, 60) || null
    const id = `${PREFIX[kind]}-${randomUUID().slice(0, 8)}`
    const ts = now()
    const cols = COLS[kind]
    db.prepare(`INSERT INTO ${kind} (id, workspace_id, ${cols.join(', ')}, created_at, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`)
      .run(id, ws, ...cols.map((c) => row[c] ?? null), ts, ts)
    emitRow(kind, id)
    if (kind === 'stories' && row.epic_id) emitRow('epics', row.epic_id)
    return get(kind, id, ws)
  }
  function update(kind, id, patch = {}, ws = null, human = false) {
    const cur = rowIn(kind, id, ws)
    const f = fields(kind, patch ?? {}, cur.workspace_id, false)
    if (!Object.keys(f).length) throw bad(`Nada que cambiar: manda alguno de ${COLS[kind].join(', ')}`)
    checkStatus(kind, cur, f.status, human)
    if (!human && CLOSED[kind].includes(cur.status)) throw humanOnly(`${NOUN[kind]} ${cur.id} está ${cur.status}; sólo la persona la cambia.`)
    const next = { ...cur, ...f }
    if (kind === 'sprints') checkSprint(cur.id, cur.workspace_id, { ...next, status: f.status }, human)
    const cols = Object.keys(f)
    db.prepare(`UPDATE ${kind} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => f[c]), now(), id)
    emitRow(kind, id)
    if (kind === 'stories') for (const e of new Set([cur.epic_id, next.epic_id].filter(Boolean))) emitRow('epics', e)
    return get(kind, id, null)
  }
  // Person only. Unlinks children; never deletes stories or tasks.
  function remove(kind, id, ws = null) {
    const cur = rowIn(kind, id, ws)
    const taskIds = []
    store.inTx(() => {
      if (kind === 'epics') db.prepare('UPDATE stories SET epic_id = NULL WHERE epic_id = ?').run(id)
      if (kind === 'stories') {
        taskIds.push(...db.prepare('SELECT id FROM tasks WHERE story_id = ?').all(id).map((r) => r.id))
        db.prepare('UPDATE tasks SET story_id = NULL WHERE story_id = ?').run(id)
      }
      if (kind === 'sprints') {
        taskIds.push(...db.prepare('SELECT id FROM tasks WHERE sprint_id = ?').all(id).map((r) => r.id))
        db.prepare('UPDATE tasks SET sprint_id = NULL WHERE sprint_id = ?').run(id)
        db.prepare('UPDATE stories SET sprint_id = NULL WHERE sprint_id = ?').run(id)
      }
      db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id)
    })
    emit(`${EVENT[kind]}_deleted`, { id, workspace_id: cur.workspace_id })
    if (kind === 'epics') for (const s of db.prepare('SELECT id FROM stories WHERE workspace_id = ? AND epic_id IS NULL').all(cur.workspace_id)) emitRow('stories', s.id)
    if (kind === 'stories' && cur.epic_id) emitRow('epics', cur.epic_id)
    emitTasks(taskIds)
    return { ok: true, id }
  }

  // Person only: closes the sprint. Unfinished tasks and stories (not done/cancelled) roll over to `rollover_to`
  // (another sprint that is not completed) or, without it, back to the backlog (sprint_id = NULL; status unchanged).
  function complete(id, ws = null, { rollover_to = null, report } = {}) {
    const sp = rowIn('sprints', id, ws)
    if (!['active', 'review'].includes(sp.status)) throw new AppError('not_completable', `Sólo se completa un sprint activo o en review (este está ${sp.status})`, 409)
    const target = rollover_to && rollover_to !== 'backlog' ? link({ rollover_to }, 'rollover_to', 'sprints', sp.workspace_id) : null
    if (target === id) throw bad('rollover_to debe ser otro sprint')
    const rep = report === undefined ? undefined : text({ report }, 'report', 20000)
    const ts = now()
    const tasks = db.prepare('SELECT id, status FROM tasks WHERE sprint_id = ?').all(id).filter((t) => isOpenTask(t.status)).map((t) => t.id)
    const stories = db.prepare('SELECT id, status FROM stories WHERE sprint_id = ?').all(id).filter((s) => isOpenTask(s.status)).map((s) => s.id)
    store.inTx(() => {
      for (const t of tasks) db.prepare('UPDATE tasks SET sprint_id = ?, updated_at = ? WHERE id = ?').run(target, ts, t)
      for (const s of stories) db.prepare('UPDATE stories SET sprint_id = ?, updated_at = ? WHERE id = ?').run(target, ts, s)
      db.prepare(`UPDATE sprints SET status = 'completed', completed_at = ?, ${rep !== undefined ? 'report = ?, ' : ''}updated_at = ? WHERE id = ?`).run(...[ts, ...(rep !== undefined ? [rep] : []), ts, id])
    })
    emitRow('sprints', id)
    if (target) emitRow('sprints', target)
    for (const s of stories) emitRow('stories', s)
    emitTasks(tasks)
    return { sprint: get('sprints', id, null), rollover_to: target, moved_tasks: tasks.length, moved_stories: stories.length }
  }

  // For /api/overview: the active sprint (or the one waiting in review) with its progress, plus totals.
  function summary(ws) {
    const sprints = list('sprints', ws)
    const pick = sprints.find((s) => s.status === 'active') ?? null
    const brief = (s) => s && { id: s.id, name: s.name, goal: s.goal, start_date: s.start_date, end_date: s.end_date, status: s.status, progress: s.progress }
    const epics = db.prepare('SELECT status FROM epics WHERE workspace_id = ?').all(ws)
    const stories = db.prepare('SELECT status FROM stories WHERE workspace_id = ?').all(ws)
    return {
      active_sprint: brief(pick),
      sprints_in_review: sprints.filter((s) => s.status === 'review').map(brief),
      sprints_planned: sprints.filter((s) => s.status === 'planning').map((s) => ({ id: s.id, name: s.name, start_date: s.start_date, end_date: s.end_date })),
      epics: countBy(epics),
      stories: countBy(stories),
      rule: 'Agents plan (epics, stories, sprints) and move work forward; only the person approves done, cancels, and completes a sprint.',
    }
  }

  return {
    list, get, create, update, remove, complete, summary,
    snapshot: (ws) => ({ epics: list('epics', ws), stories: list('stories', ws), sprints: list('sprints', ws) }),
  }
}
