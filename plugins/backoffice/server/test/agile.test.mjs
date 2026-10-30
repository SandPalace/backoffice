import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb, MIGRATIONS } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'

const WEB = { origin: 'http://localhost:4781' } // what the browser sends
const KEY = 'agile-key'

async function boot() {
  const app = createApp({ db: openDb(':memory:'), port: 0, mcpKey: KEY })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    const t = await r.text()
    return { status: r.status, body: t ? JSON.parse(t) : null }
  }
  const tool = async (name, args = {}) => {
    const r = await (await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, 'x-backoffice-agent': 'ceo' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()
    return { isError: !!r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) }
  }
  return { app, call, tool }
}

test('migration: agile tables, task columns and the one-active-sprint index exist; reopening is idempotent', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'bo-agile-')), 'x.db')
  openDb(file).close()
  const db = openDb(file) // second open runs nothing new
  const cols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name)
  for (const c of ['story_id', 'sprint_id', 'cancel_proposal']) assert.ok(cols.includes(c), c)
  for (const t of ['epics', 'stories', 'sprints']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n, MIGRATIONS.length)
  const ts = Date.now()
  db.prepare("INSERT INTO sprints (id, name, status, created_at, updated_at) VALUES ('a', 'A', 'active', ?, ?)").run(ts, ts)
  assert.throws(() => db.prepare("INSERT INTO sprints (id, name, status, created_at, updated_at) VALUES ('b', 'B', 'active', ?, ?)").run(ts, ts), /UNIQUE/)
  db.close()
  assert.ok(new DatabaseSync(file))
})

test('task statuses: agents use backlog..review, never done or cancelled; they propose cancelling; the person cancels', async () => {
  const { app, call } = await boot()
  try {
    const t = (await call('POST', '/api/tasks', { title: 'Idea', status: 'backlog' })).body
    assert.equal(t.status, 'backlog')
    assert.equal((await call('POST', '/api/tasks', { title: 'X', status: 'doing' })).body.status, 'todo') // agents create only in backlog/todo
    assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { status: 'doing' })).body.status, 'doing')
    for (const s of ['done', 'cancelled']) {
      const r = await call('PATCH', `/api/tasks/${t.id}`, { status: s })
      assert.equal(r.status, 403, s)
      assert.equal(r.body.error, 'human_only')
    }
    // propose cancel = review without deliverables, with the reason
    const p = await call('PATCH', `/api/tasks/${t.id}`, { propose_cancel: 'Ya no aplica: el cliente canceló' })
    assert.equal(p.status, 200)
    assert.equal(p.body.status, 'review')
    assert.match(p.body.cancel_proposal, /cliente/)
    assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { propose_cancel: 'x', status: 'doing' })).status, 400)
    // the person cancels; agents cannot reopen it
    const c = await call('PATCH', `/api/human/tasks/${t.id}`, { status: 'cancelled' })
    assert.equal(c.body.status, 'cancelled')
    assert.match(c.body.cancel_proposal, /cliente/) // kept as the reason
    assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { status: 'todo' })).status, 403)
    const o = (await call('GET', '/api/overview')).body
    assert.equal(o.tasks.cancelled, 1)
    assert.equal(o.tasks.backlog, 0)
    assert.equal(o.tasks.todo, 1)
    // a normal review still needs a deliverable
    const t2 = (await call('POST', '/api/tasks', { title: 'Y' })).body
    assert.equal((await call('PATCH', `/api/tasks/${t2.id}`, { status: 'review' })).status, 422)
  } finally { await app.close() }
})

test('epics and stories CRUD with the person-only rules; tasks link to stories and inherit the sprint', async () => {
  const { app, call } = await boot()
  try {
    const e = (await call('POST', '/api/epics', { title: 'Tienda en línea', agent: 'ceo' })).body
    assert.match(e.id, /^E-/)
    assert.equal(e.status, 'planning')
    assert.equal(e.owner_agent, 'ceo')
    assert.equal((await call('POST', '/api/epics', { title: 'X', status: 'done' })).status, 403)
    assert.equal((await call('POST', '/api/epics', {})).status, 400)
    assert.equal((await call('PATCH', `/api/epics/${e.id}`, { status: 'active' })).body.status, 'active')
    assert.equal((await call('PATCH', `/api/epics/${e.id}`, { status: 'done' })).status, 403)

    const sp = (await call('POST', '/api/sprints', { name: 'Sprint 1', goal: 'Catálogo listo', start_date: '2026-11-02', end_date: '2026-11-13' })).body
    const s = (await call('POST', '/api/stories', { title: 'Como cliente veo el catálogo', epic_id: e.id, sprint_id: sp.id, points: 3 })).body
    assert.equal(s.status, 'backlog')
    assert.equal((await call('POST', '/api/stories', { title: 'x', epic_id: 'E-nope' })).status, 400)
    assert.equal((await call('POST', '/api/stories', { title: 'x', points: 1.5 })).status, 400)
    assert.equal((await call('PATCH', `/api/stories/${s.id}`, { status: 'done' })).status, 403)
    assert.equal((await call('PATCH', `/api/stories/${s.id}`, { status: 'review' })).body.status, 'review')

    const t = (await call('POST', '/api/tasks', { title: 'Subir fotos', story_id: s.id })).body
    assert.equal(t.story_id, s.id)
    assert.equal(t.sprint_id, sp.id, 'inherits the story sprint')
    assert.equal((await call('POST', '/api/tasks', { title: 'x', sprint_id: 'SP-nope' })).status, 400)
    const ep = (await call('GET', `/api/epics/${e.id}`)).body
    assert.equal(ep.stories.total, 1)
    assert.equal(ep.stories.points_total, 3)
    assert.equal(ep.tasks.total, 1)
    assert.equal(ep.items[0].id, s.id)
    assert.equal((await call('GET', `/api/tasks?story_id=${s.id}`)).body.length, 1)
    assert.equal((await call('GET', '/api/stories?epic_id=none')).body.length, 0)

    // person: browser-only writes on /api/human/*
    assert.equal((await call('PATCH', `/api/human/stories/${s.id}`, { status: 'done' })).status, 403, 'no Origin = not the person')
    assert.equal((await call('PATCH', `/api/human/stories/${s.id}`, { status: 'done' }, WEB)).body.status, 'done')
    assert.equal((await call('PATCH', `/api/stories/${s.id}`, { title: 'cambio' })).status, 403, 'a closed story is the person\'s')
    assert.equal((await call('PATCH', `/api/human/epics/${e.id}`, { status: 'done' }, WEB)).body.status, 'done')
    // delete (person) unlinks, never deletes children
    assert.equal((await call('DELETE', `/api/epics/${e.id}`)).status, 404)
    assert.equal((await call('DELETE', `/api/human/epics/${e.id}`, undefined, WEB)).status, 200)
    assert.equal((await call('GET', `/api/stories/${s.id}`)).body.epic_id, null)
    assert.equal((await call('DELETE', `/api/human/stories/${s.id}`, undefined, WEB)).status, 200)
    assert.equal((await call('GET', `/api/tasks/${t.id}`)).body.story_id, null)
    // the person relinks a task from the web
    const re = await call('PATCH', `/api/human/tasks/${t.id}`, { sprint_id: null })
    assert.equal(re.body.sprint_id, null)
  } finally { await app.close() }
})

test('sprints: one active per workspace, review needs a report, complete is person-only and rolls work over', async () => {
  const { app, call } = await boot()
  const events = []
  app.store.bus.on('change', (e) => events.push(e.type))
  try {
    const s1 = (await call('POST', '/api/sprints', { name: 'Sprint 1', status: 'active' })).body
    assert.equal(s1.status, 'active')
    const s2 = (await call('POST', '/api/sprints', { name: 'Sprint 2' })).body
    const dup = await call('PATCH', `/api/sprints/${s2.id}`, { status: 'active' })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error, 'sprint_active_exists')
    assert.equal((await call('POST', '/api/sprints', { name: 'X', start_date: '2026-11-10', end_date: '2026-11-01' })).status, 400)
    assert.equal((await call('POST', '/api/sprints', { name: 'X', start_date: '2026-13-40' })).status, 400)
    assert.equal((await call('PATCH', `/api/sprints/${s1.id}`, { status: 'completed' })).status, 409) // never through PATCH

    const done = (await call('POST', '/api/human/tasks', { title: 'hecha', status: 'done' })).body
    const open = (await call('POST', '/api/tasks', { title: 'abierta', sprint_id: s1.id })).body
    const gone = (await call('POST', '/api/human/tasks', { title: 'cancelada', status: 'cancelled' })).body
    for (const t of [done, gone]) await call('PATCH', `/api/human/tasks/${t.id}`, { sprint_id: s1.id })
    const st = (await call('POST', '/api/stories', { title: 'h', sprint_id: s1.id })).body

    const ov = (await call('GET', '/api/overview')).body.agile
    assert.equal(ov.active_sprint.id, s1.id)
    assert.equal(ov.active_sprint.progress.tasks.total, 2) // cancelled does not count
    assert.equal(ov.active_sprint.progress.tasks.percent, 50)

    assert.equal((await call('PATCH', `/api/sprints/${s1.id}`, { status: 'review' })).status, 400, 'review needs a report')
    assert.equal((await call('PATCH', `/api/sprints/${s1.id}`, { status: 'review', report: 'Se hizo 1 de 2' })).body.status, 'review')

    // complete: not for agents (no route without /human, no Origin = 403)
    assert.equal((await call('POST', `/api/sprints/${s1.id}/complete`, {})).status, 404)
    const noweb = await call('POST', `/api/human/sprints/${s1.id}/complete`, { rollover_to: s2.id })
    assert.equal(noweb.status, 403)
    assert.equal(noweb.body.error, 'human_only')
    assert.equal((await call('POST', `/api/human/sprints/${s1.id}/complete`, { rollover_to: 'SP-nope' }, WEB)).status, 400)
    const c = await call('POST', `/api/human/sprints/${s1.id}/complete`, { rollover_to: s2.id }, WEB)
    assert.equal(c.status, 200)
    assert.equal(c.body.sprint.status, 'completed')
    assert.equal(c.body.moved_tasks, 1)
    assert.equal(c.body.moved_stories, 1)
    assert.equal((await call('GET', `/api/tasks/${open.id}`)).body.sprint_id, s2.id)
    assert.equal((await call('GET', `/api/tasks/${done.id}`)).body.sprint_id, s1.id, 'finished work stays in its sprint')
    assert.equal((await call('GET', `/api/stories/${st.id}`)).body.sprint_id, s2.id)
    assert.equal((await call('POST', `/api/human/sprints/${s1.id}/complete`, {}, WEB)).status, 409, 'already completed')
    assert.equal((await call('POST', '/api/tasks', { title: 'x', sprint_id: s1.id })).status, 409, 'completed sprint takes no new work')
    assert.equal((await call('PATCH', `/api/sprints/${s1.id}`, { name: 'y' })).status, 403)

    // now s2 can be active; completing it without rollover sends unfinished work back to the backlog pool
    await call('PATCH', `/api/sprints/${s2.id}`, { status: 'active' })
    const c2 = (await call('POST', `/api/human/sprints/${s2.id}/complete`, {}, WEB)).body
    assert.equal(c2.rollover_to, null)
    assert.equal((await call('GET', `/api/tasks/${open.id}`)).body.sprint_id, null)
    assert.equal((await call('GET', `/api/tasks/${open.id}`)).body.status, 'todo')
    for (const ev of ['sprint', 'story', 'task']) assert.ok(events.includes(ev), ev)
  } finally { await app.close() }
})

test('agile is workspace-scoped and in the SSE snapshot', async () => {
  const { app, call } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Otro' })
    const e = (await call('POST', '/api/epics?workspace=otro', { title: 'Ajena' })).body
    assert.equal((await call('GET', '/api/epics')).body.length, 0)
    assert.equal((await call('GET', `/api/epics/${e.id}?workspace=default`)).status, 404)
    assert.equal((await call('POST', '/api/stories', { title: 'x', epic_id: e.id })).status, 400, 'cannot link across workspaces')
    const ctl = new AbortController()
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/api/stream?workspace=otro`, { signal: ctl.signal })
    const reader = r.body.getReader()
    let buf = ''
    while (!buf.includes('\n\n')) buf += new TextDecoder().decode((await reader.read()).value)
    ctl.abort()
    const snap = JSON.parse(buf.split('\n').find((l) => l.startsWith('data: ')).slice(6))
    assert.equal(snap.epics.length, 1)
    assert.deepEqual(snap.sprints, [])
    assert.deepEqual(snap.stories, [])
  } finally { await app.close() }
})

test('MCP: agile tools plan epics → stories → sprint → tasks; no tool closes anything', async () => {
  const { app, tool } = await boot()
  try {
    const e = await tool('backoffice_epic_create', { title: 'Lanzamiento' })
    assert.equal(e.isError, false, e.data)
    assert.equal(e.data.owner_agent, 'ceo', 'owner defaults to the calling agent')
    const sp = await tool('backoffice_sprint_create', { name: 'Sprint 1', goal: 'MVP', start_date: '2026-11-02', end_date: '2026-11-13', status: 'active' })
    const s = await tool('backoffice_story_create', { title: 'Landing', epic_id: e.data.id, sprint_id: sp.data.id, points: 5, description: 'Como dueño quiero...\n- [ ] criterio' })
    assert.equal(s.isError, false, s.data)
    const t = await tool('backoffice_task_create', { title: 'Copy de la landing', story_id: s.data.id, status: 'backlog' })
    assert.equal(t.data.sprint_id, sp.data.id)
    assert.equal(t.data.status, 'backlog')
    assert.equal((await tool('backoffice_task_list', { sprint_id: sp.data.id })).data.length, 1)
    assert.equal((await tool('backoffice_task_list', { sprint_id: 'none' })).data.length, 0)
    assert.equal((await tool('backoffice_story_list', { epic_id: e.data.id })).data[0].tasks.total, 1)
    assert.equal((await tool('backoffice_sprint_list', {})).data[0].progress.tasks.total, 1)
    assert.equal((await tool('backoffice_epic_list', { status: 'planning' })).data.length, 1)
    const up = await tool('backoffice_story_update', { id: s.data.id, status: 'doing', points: 8 })
    assert.equal(up.data.points, 8)
    const nope = await tool('backoffice_story_update', { id: s.data.id, status: 'done' })
    assert.equal(nope.isError, true)
    assert.match(nope.data, /persona/)
    assert.equal((await tool('backoffice_epic_update', { id: e.data.id, status: 'cancelled' })).isError, true)
    assert.equal((await tool('backoffice_sprint_update', { id: sp.data.id, status: 'completed' })).isError, true)
    const rv = await tool('backoffice_sprint_update', { id: sp.data.id, status: 'review', report: 'Landing lista, falta copy' })
    assert.equal(rv.data.status, 'review')
    const pc = await tool('backoffice_task_update', { id: t.data.id, propose_cancel: 'Duplicada' })
    assert.equal(pc.data.status, 'review')
    assert.equal((await tool('backoffice_task_update', { id: t.data.id, status: 'cancelled' })).isError, true)
    const ov = await tool('backoffice_overview', {})
    assert.equal(ov.data.agile.sprints_in_review[0].id, sp.data.id)
  } finally { await app.close() }
})
