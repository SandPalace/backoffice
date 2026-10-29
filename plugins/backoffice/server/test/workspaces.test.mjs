import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// La raíz del workspace `default` va a una carpeta temporal ANTES de abrir cualquier base (nunca ~/AgentOS).
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-root-')))
process.env.BACKOFFICE_ROOT = ROOT
const { openDb, MIGRATIONS } = await import('../src/db.mjs')
const { createApp } = await import('../src/server.mjs')
const { createStore } = await import('../src/store.mjs')

async function boot(opts = {}) {
  const app = createApp({ db: openDb(':memory:'), port: 0, extraRoots: [], ...opts })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null }
  }
  const raw = (path, headers = {}) => fetch(base + path, { headers })
  return { app, base, call, raw }
}

test('migración: una base con el esquema viejo queda toda en el workspace default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backoffice-mig-'))
  const file = join(dir, 'old.db')
  const old = new DatabaseSync(file)
  old.exec('CREATE TABLE _migrations (n INTEGER PRIMARY KEY)')
  MIGRATIONS.slice(0, 5).forEach((sql, n) => { old.exec(sql); old.prepare('INSERT INTO _migrations (n) VALUES (?)').run(n) }) // esquema anterior a workspaces
  old.exec(`INSERT INTO sessions (id, cwd, project, agent, started_at, last_event_at) VALUES ('s1', '/x/proj', 'proj', 'cmo', 1, 1);
    INSERT INTO events (ts, session_id, event) VALUES (1, 's1', 'SessionStart');
    INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('T-old', 'Tarea vieja', 1, 1);
    INSERT INTO outputs (task_id, path, kind, created_at) VALUES ('T-old', '/tmp/a.md', 'file', 1);
    INSERT INTO teams (id, name, active, created_at, updated_at) VALUES ('team-old', 'Marketing', 1, 1, 1);
    INSERT INTO team_members (team_id, agent_id, context, position) VALUES ('team-old', 'cmo', 'ctx del cmo', 0);
    UPDATE system_agents SET display_name = 'Rafa', avatar = 7, context = 'contexto del COO' WHERE agent_id = 'coo';`)
  old.close()

  const db = openDb(file)
  const ws = db.prepare('SELECT * FROM workspaces').all()
  assert.equal(ws.length, 1)
  assert.equal(ws[0].id, 'default')
  assert.equal(ws[0].name, 'Back Office') // el proyecto por defecto se llama Back Office (antes AgentOS)
  assert.equal(ws[0].root, join(ROOT, 'default'))
  for (const t of ['sessions', 'tasks', 'outputs', 'teams', 'events']) {
    const rows = db.prepare(`SELECT workspace_id FROM ${t}`).all()
    assert.ok(rows.length >= 1, t)
    assert.ok(rows.every((r) => r.workspace_id === 'default'), t)
  }
  const store = createStore(db)
  assert.equal(store.listTasks()[0].id, 'T-old')
  assert.equal(store.listTasks()[0].outputs[0].path, '/tmp/a.md')
  assert.equal(store.listTeams()[0].active, true)
  assert.equal(store.listTeams()[0].members[0].context, 'ctx del cmo')
  assert.equal(store.getSystemAgent('coo').context, 'contexto del COO')
  assert.equal(store.getSystemAgent('coo').display_name, 'Rafa')
  assert.equal(store.listSessions()[0].id, 's1')
  db.close()

  // idempotente: abrir de nuevo no duplica ni cambia nada
  const again = openDb(file)
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM workspaces').get().n, 1)
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM workspace_agents').get().n, 1)
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1)
  again.close()
})

test('workspaces: crear, renombrar, archivar (no borra archivos) y slug de id', async () => {
  const { app, call } = await boot()
  try {
    const list = await call('GET', '/api/workspaces')
    assert.deepEqual(list.body.map((w) => w.id), ['default'])
    const w = await call('POST', '/api/workspaces', { name: 'Cliente Ñandú & Co.' })
    assert.equal(w.status, 201)
    assert.equal(w.body.id, 'cliente-nandu-co')
    assert.equal(w.body.bucket, 'ws-cliente-nandu-co')
    assert.equal(w.body.root, join(ROOT, 'cliente-nandu-co'))
    assert.ok(existsSync(w.body.root))
    assert.equal((await call('POST', '/api/workspaces', { name: 'otro', id: 'cliente-nandu-co' })).status, 409)
    assert.equal((await call('POST', '/api/workspaces', { name: '   ' })).status, 400)
    assert.equal((await call('POST', '/api/workspaces', { name: 'Cliente Ñandú & Co.' })).body.id, 'cliente-nandu-co-2')
    const p = await call('PATCH', '/api/workspaces/cliente-nandu-co', { name: 'Ñandú' })
    assert.equal(p.body.name, 'Ñandú')
    assert.equal((await call('PATCH', '/api/workspaces/nope', { name: 'x' })).status, 404)

    assert.equal((await call('DELETE', '/api/workspaces/default?force=1')).status, 403)
    await call('POST', '/api/tasks', { title: 'algo' }, { 'x-backoffice-workspace': 'cliente-nandu-co' })
    assert.equal((await call('DELETE', '/api/workspaces/cliente-nandu-co')).status, 409) // no vacío
    const del = await call('DELETE', '/api/workspaces/cliente-nandu-co?force=1')
    assert.equal(del.status, 200)
    assert.equal(del.body.files_untouched, true)
    assert.match(del.body.message, /no se borró ningún archivo/)
    assert.ok(existsSync(w.body.root)) // la carpeta sigue en disco
    assert.equal((await call('GET', '/api/tasks', null, { 'x-backoffice-workspace': 'cliente-nandu-co' })).status, 404)
    assert.equal((await call('DELETE', '/api/workspaces/cliente-nandu-co-2')).status, 200) // vacío: sin force
  } finally { await app.close() }
})

test('aislamiento: tareas, equipos, COO, overview y contexto por workspace', async () => {
  const { app, call } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Acme', id: 'acme' })
    const A = { 'x-backoffice-workspace': 'acme' }
    // tareas
    const td = (await call('POST', '/api/tasks', { title: 'Tarea default' })).body
    const ta = (await call('POST', '/api/tasks', { title: 'Tarea acme' }, A)).body
    assert.deepEqual((await call('GET', '/api/tasks')).body.map((t) => t.id), [td.id])
    assert.deepEqual((await call('GET', '/api/tasks?workspace=acme')).body.map((t) => t.id), [ta.id])
    assert.equal((await call('GET', `/api/tasks/${ta.id}`, null, { 'x-backoffice-workspace': 'default' })).status, 404)
    assert.equal((await call('PATCH', `/api/tasks/${ta.id}`, { status: 'doing' }, { 'x-backoffice-workspace': 'default' })).status, 404)
    assert.equal((await call('PATCH', `/api/tasks/${ta.id}`, { status: 'doing' }, A)).body.status, 'doing')
    assert.equal((await call('POST', `/api/tasks/${ta.id}/outputs`, { path: join(ROOT, 'x.md') }, { 'x-backoffice-workspace': 'default' })).status, 404)
    // equipos: el activo es por workspace
    const t1 = (await call('POST', '/api/teams', { name: 'Ventas', members: [{ agent_id: 'lead-qualifier' }] })).body
    const t2 = (await call('POST', '/api/teams', { name: 'Marketing', members: [{ agent_id: 'cmo', context: 'ctx acme' }] }, A)).body
    assert.equal(t1.active, true)
    assert.equal(t2.active, true) // primer equipo de su workspace
    const t3 = (await call('POST', '/api/teams', { name: 'Otro', members: [{ agent_id: 'analyst' }] }, A)).body
    await call('POST', `/api/teams/${t3.id}/activate`, null, A)
    assert.equal((await call('GET', '/api/teams')).body[0].active, true) // default intacto
    assert.deepEqual((await call('GET', '/api/teams', null, A)).body.map((t) => [t.name, t.active]), [['Marketing', false], ['Otro', true]])
    assert.equal((await call('POST', `/api/teams/${t2.id}/activate`, null, { 'x-backoffice-workspace': 'default' })).status, 404)
    // Assistant (coo) es UNA para todos los proyectos: nombre y contexto se comparten; lo que ve sí es del workspace
    await call('PATCH', '/api/system/coo', { display_name: 'Rafa', context: 'contexto global' })
    assert.equal((await call('GET', '/api/system', null, A)).body.coo.display_name, 'Rafa')
    assert.equal((await call('GET', '/api/system')).body.coo.display_name, 'Rafa')
    await call('PATCH', '/api/system/coo', { display_name: 'Sofía' }, A)
    assert.equal((await call('GET', '/api/system')).body.coo.display_name, 'Sofía', 'editarla desde otro proyecto cambia la misma Assistant')
    const cA = (await call('GET', '/api/context?agent=coo', null, A)).body
    assert.match(cA.context, /abierta en la carpeta de «Acme» \(acme\)/)
    assert.doesNotMatch(cA.context, /Sólo ves/)
    assert.match(cA.context, /te llama Sofía/)
    assert.match(cA.context, /contexto global/)
    assert.match(cA.context, /«Back Office» \(default\).*Ventas/, 'Assistant ve todos los proyectos')
    assert.match(cA.context, /«Acme» \(acme\) ← carpeta actual/)
    assert.match(cA.context, /«Otro» \(activo/)
    assert.equal(cA.workspace.name, 'Acme')
    const cD = (await call('GET', '/api/context?agent=coo')).body
    assert.match(cD.context, /abierta en la carpeta de «Back Office»/)
    assert.match(cD.context, /«Acme» \(acme\)/)
    const pr = (await call('GET', '/api/projects')).body
    assert.deepEqual(pr.map((p) => p.id), ['default', 'acme'])
    assert.equal(pr.find((p) => p.id === 'acme').active_team, 'Otro')
    assert.match(cD.context, /contexto global/)
    await call('POST', `/api/teams/${t2.id}/activate`, null, A)
    assert.match((await call('GET', '/api/context?agent=cmo', null, A)).body.context, /Workspace: «Acme»/)
    assert.equal((await call('GET', '/api/context?agent=cmo')).body.context, null) // cmo sólo está en acme
    // sesiones y check-ins
    await call('POST', '/api/checkin', { agent: 'cmo', status: 'working' }, A)
    await call('POST', '/api/checkin', { agent: 'cmo', status: 'idle' })
    assert.equal((await call('GET', '/api/sessions', null, A)).body[0].id, 'mcp:acme:cmo')
    assert.equal((await call('GET', '/api/sessions')).body[0].id, 'mcp:cmo')
    // overview
    const oA = (await call('GET', '/api/overview', null, A)).body
    assert.equal(oA.workspace.name, 'Acme')
    assert.equal(oA.tasks.doing, 1)
    assert.equal(oA.tasks.todo, 0)
    assert.deepEqual(oA.teams.map((t) => t.name), ['Marketing', 'Otro'])
    assert.equal(oA.coo.display_name, 'Sofía')
    const oD = (await call('GET', '/api/overview')).body
    assert.equal(oD.workspace.id, 'default')
    assert.equal(oD.tasks.todo, 1)
    assert.deepEqual(oD.teams.map((t) => t.name), ['Ventas'])
    // la tarea de otro workspace no aparece en overview.needs_you
    await call('PATCH', `/api/tasks/${ta.id}`, { status: 'blocked' }, A)
    assert.equal((await call('GET', '/api/overview')).body.needs_you.length, 0)
    assert.equal((await call('GET', '/api/overview?workspace=nope')).status, 404)
    // borrar equipo activo: el reemplazo es del mismo workspace
    await call('DELETE', `/api/teams/${t3.id}`, null, A)
    assert.equal((await call('GET', '/api/teams', null, A)).body[0].active, true)
  } finally { await app.close() }
})

test('sesión → workspace: por cwd con raíces anidadas y por BACKOFFICE_WORKSPACE', async () => {
  const { app, call } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Acme', id: 'acme' }) // ROOT/workspaces/acme
    await call('POST', '/api/workspaces', { name: 'Acme Sub', id: 'acme-sub' })
    const nested = join(ROOT, 'acme', 'sub')
    await call('PATCH', '/api/workspaces/acme-sub', { root: nested }) // raíz anidada dentro de otra
    const ws = (cwd, extra = {}, id = 's') => call('POST', '/hooks/SessionStart', { session_id: id, cwd, ...extra }).then(async () => (await call('GET', '/api/sessions?workspace=*')).status)
    const where = async (id) => (await call('GET', `/api/workspaces/resolve?cwd=${encodeURIComponent(id)}`)).body.workspace
    assert.equal(await where(join(ROOT, 'acme', 'campana', 'x')), 'acme')
    assert.equal(await where(join(nested, 'deep')), 'acme-sub') // gana la raíz más larga
    assert.equal(await where(nested), 'acme-sub')
    assert.equal(await where(join(ROOT, 'acme-otro')), 'default') // no es prefijo de ruta (acme vs acme-otro)
    assert.equal(await where(join(ROOT, 'otra')), 'default')
    assert.equal(await where('/Users/x/inmobiliaria'), 'default')
    assert.equal(await where(''), 'default')

    await call('POST', '/hooks/SessionStart', { session_id: 'a', cwd: join(ROOT, 'acme', 'p') })
    await call('POST', '/hooks/SessionStart', { session_id: 'b', cwd: join(nested, 'q') })
    await call('POST', '/hooks/SessionStart', { session_id: 'c', cwd: '/Users/x/otro' })
    await call('POST', '/hooks/SessionStart', { session_id: 'd', cwd: '/Users/x/otro', env: { BACKOFFICE_WORKSPACE: 'acme' } }) // explícito gana
    await call('POST', '/hooks/SessionStart', { session_id: 'e', cwd: join(nested, 'q') }, { 'x-backoffice-workspace': 'nope' }) // desconocido: cae al cwd
    await call('POST', '/hooks/SubagentStart', { session_id: 'a', agent_id: 'z1', agent_type: 'cmo' }) // sin cwd: hereda de la sesión
    const ids = async (w) => (await call('GET', `/api/sessions?workspace=${w}`)).body.map((s) => s.id).sort()
    assert.deepEqual(await ids('acme'), ['a', 'a/z1', 'd'])
    assert.deepEqual(await ids('acme-sub'), ['b', 'e'])
    assert.deepEqual(await ids('default'), ['c'])
    // el hook de SessionStart devuelve el contexto del workspace de la sesión
    await call('POST', '/api/teams', { name: 'M', members: [{ agent_id: 'cmo', context: 'solo acme' }] }, { 'x-backoffice-workspace': 'acme' })
    const h = await call('POST', '/hooks/SessionStart', { session_id: 'f', cwd: join(ROOT, 'acme'), agent_type: 'backoffice:cmo' })
    assert.match(h.body.hookSpecificOutput.additionalContext, /solo acme/)
    const h2 = await call('POST', '/hooks/SessionStart', { session_id: 'g', cwd: '/Users/x/otro', agent_type: 'backoffice:cmo' })
    assert.equal(h2.body, null) // en default no hay contexto para cmo
  } finally { await app.close() }
})

test('SSE: sólo llegan los datos del workspace pedido', async () => {
  const { app, base, call } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Acme', id: 'acme' })
    const res = await fetch(`${base}/api/stream?workspace=acme`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    const read = async (until) => { while (!buf.includes(until)) buf += dec.decode((await reader.read()).value) }
    await read('event: snapshot')
    assert.match(buf, /"workspace":\{"id":"acme","name":"Acme"\}/)
    await call('POST', '/api/tasks', { title: 'SECRETO-DEFAULT' }) // otro workspace
    await call('POST', '/api/tasks', { title: 'tarea-acme' }, { 'x-backoffice-workspace': 'acme' })
    await read('tarea-acme')
    assert.doesNotMatch(buf, /SECRETO-DEFAULT/)
    assert.match(buf, /"workspace_id":"acme"/)
    await reader.cancel()
  } finally { await app.close() }
})

const sha = (b) => createHash('sha256').update(b).digest('hex')
const mkWs = async (call, id) => (await call('POST', '/api/workspaces', { name: id, id })).body

test('entrega → copia al almacenamiento del workspace → GET /api/files (archivo y carpeta)', async () => {
  const { app, call, raw } = await boot()
  try {
    const w = await mkWs(call, 'acme')
    const A = { 'x-backoffice-workspace': 'acme' }
    const file = join(w.root, 'informe final.md')
    writeFileSync(file, '# Informe ñ')
    const dir = join(w.root, 'sitio')
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    mkdirSync(join(dir, 'css'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<h1>hola</h1>')
    writeFileSync(join(dir, 'css', 'a b.css'), 'body{}')
    writeFileSync(join(dir, 'node_modules', 'x', 'big.js'), 'no subir')

    const t = (await call('POST', '/api/tasks', { title: 'Entrega' }, A)).body
    const r1 = await call('POST', `/api/tasks/${t.id}/outputs`, { path: file, kind: 'markdown' }, A)
    assert.equal(r1.status, 201)
    const o1 = r1.body.outputs[0]
    assert.equal(o1.bucket, 'ws-acme')
    assert.equal(o1.storage_key, `outputs/${t.id}/informe final.md`)
    assert.equal(o1.sha256, sha('# Informe ñ'))
    assert.equal(o1.size, Buffer.byteLength('# Informe ñ'))
    assert.equal(o1.content_type, 'text/markdown; charset=utf-8')
    assert.ok(o1.uploaded_at && !o1.storage_error && o1.stored)
    assert.equal((await app.blobs.head('ws-acme', o1.storage_key)).size, Buffer.byteLength('# Informe ñ'))

    const g = await raw(`/api/files/${o1.id}`, A)
    assert.equal(g.status, 200)
    assert.equal(g.headers.get('content-type'), 'text/markdown; charset=utf-8')
    assert.match(g.headers.get('content-disposition'), /^inline; filename="informe final.md"/)
    assert.equal(await g.text(), '# Informe ñ')
    const dl = await raw(`/api/files/${o1.id}?download=1`)
    assert.match(dl.headers.get('content-disposition'), /^attachment; /)
    await dl.arrayBuffer()
    assert.equal((await raw(`/api/files/${o1.id}`, { 'x-backoffice-workspace': 'default' })).status, 404) // otro workspace

    // carpeta
    const r2 = await call('POST', `/api/tasks/${t.id}/outputs`, { path: dir, kind: 'folder' }, A)
    const o2 = r2.body.outputs[1]
    assert.equal(o2.storage_key, `outputs/${t.id}/sitio/`)
    assert.deepEqual(o2.files.files.map((f) => f.rel), ['css/a b.css', 'index.html'])
    assert.ok(o2.files.skipped.some((s) => s.rel === 'node_modules/' && s.reason === 'ignored_dir'))
    assert.ok(await app.blobs.head('ws-acme', `outputs/${t.id}/sitio/css/a b.css`))
    assert.ok(!(await app.blobs.list('ws-acme', '', { max: 100 })).objects.some((o) => o.key.includes('node_modules')))
    const list = (await call('GET', `/api/outputs/${o2.id}/files`)).body
    assert.equal(list.kind, 'folder')
    assert.deepEqual(list.files.map((f) => f.rel), ['css/a b.css', 'index.html'])
    assert.equal(list.files[1].content_type, 'text/html; charset=utf-8')
    const f = await raw(`/api/files/${o2.id}?file=${encodeURIComponent('css/a b.css')}`)
    assert.equal(await f.text(), 'body{}')
    const html = await raw(`/api/files/${o2.id}?file=index.html`)
    assert.match(html.headers.get('content-security-policy'), /sandbox/)
    assert.equal(html.headers.get('x-content-type-options'), 'nosniff')
    await html.arrayBuffer()
    assert.equal((await raw(`/api/files/${o2.id}`)).status, 400) // carpeta sin ?file=

    // listado del bucket del workspace
    const top = (await call('GET', '/api/workspaces/acme/files')).body
    assert.equal(top.bucket, 'ws-acme')
    assert.deepEqual(top.folders.map((x) => x.prefix), ['outputs/'])
    const sub = (await call('GET', `/api/workspaces/acme/files?prefix=${encodeURIComponent(`outputs/${t.id}/`)}`)).body
    assert.deepEqual(sub.files.map((x) => x.name), ['informe final.md'])
    assert.deepEqual(sub.folders.map((x) => x.name), ['sitio'])
    assert.equal((await call('GET', '/api/workspaces/acme/files?prefix=../x')).status, 400)
    assert.equal((await call('GET', '/api/workspaces/acme/files?prefix=%2Fabs')).status, 400)
    const obj = await raw(`/api/workspaces/acme/object?key=${encodeURIComponent(o1.storage_key)}`)
    assert.equal(await obj.text(), '# Informe ñ')
    assert.equal((await raw(`/api/workspaces/acme/object?key=${encodeURIComponent('../x')}`)).status, 400)
    // el workspace default no recibió nada
    assert.equal((await app.blobs.list('ws-default', '', { max: 100 })).objects.length, 0)
  } finally { await app.close() }
})

test('almacenamiento interno: estado, entrega por ruta copiada y archivo inexistente', async () => {
  const { app, call, raw } = await boot()
  try {
    const st = (await call('GET', '/api/storage/status')).body
    assert.equal(st.backend, 'local')
    assert.deepEqual(st.usage, { files: 0, bytes: 0 })
    assert.equal(st.limits.max_file_bytes, 50 * 1024 * 1024)
    assert.ok(st.root)
    for (const gone of ['/api/storage/start', '/api/storage/backend', '/api/storage/migrate', '/api/storage/backfill']) assert.equal((await call('POST', gone, {})).status, 404, gone)
    const file = join(ROOT, 'degradado.md')
    writeFileSync(file, 'local')
    const t = (await call('POST', '/api/tasks', { title: 'x' })).body
    const r = await call('POST', `/api/tasks/${t.id}/outputs`, { path: file })
    assert.equal(r.status, 201)
    const o = r.body.outputs[0]
    assert.equal(o.storage_key, `outputs/${t.id}/degradado.md`) // copiado al almacenamiento local
    assert.equal(o.stored, true)
    assert.equal(o.storage_error, null)
    assert.equal(await (await raw(`/api/files/${o.id}`)).text(), 'local')
    assert.deepEqual((await call('GET', '/api/storage/status')).body.usage, { files: 1, bytes: 5 })
    const listed = await call('GET', '/api/workspaces/default/files') // ya no hay 503
    assert.equal(listed.status, 200)
    assert.deepEqual(listed.body.folders.map((f) => f.prefix), ['outputs/'])
    // archivo que no existe en disco ni en el almacenamiento
    const gone = await call('POST', `/api/tasks/${t.id}/outputs`, { path: join(ROOT, 'no-existe.md') })
    assert.equal(gone.status, 201)
    assert.equal((await raw(`/api/files/${gone.body.outputs[1].id}`)).status, 404)
  } finally { await app.close() }
})

test('seguridad de archivos: .. rechazado, fuera de las raíces y enlaces simbólicos', async () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-out-')))
  writeFileSync(join(outside, 'secreto.txt'), 'SECRETO')
  const { app, call, raw } = await boot()
  try {
    const t = (await call('POST', '/api/tasks', { title: 'x' })).body
    const add = async (path, kind = 'file') => (await call('POST', `/api/tasks/${t.id}/outputs`, { path, kind })).body.outputs.at(-1)
    // archivo registrado fuera de cualquier raíz: no se sirve
    const o1 = await add(join(outside, 'secreto.txt'))
    assert.equal((await raw(`/api/files/${o1.id}`)).status, 403)
    // carpeta dentro de la raíz con un enlace simbólico que escapa
    const dir = join(ROOT, 'carpeta-link')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ok.txt'), 'ok')
    symlinkSync(join(outside, 'secreto.txt'), join(dir, 'escape.txt'))
    const o2 = await add(dir, 'folder')
    assert.equal(await (await raw(`/api/files/${o2.id}?file=ok.txt`)).text(), 'ok')
    assert.equal((await raw(`/api/files/${o2.id}?file=escape.txt`)).status, 403)
    const listed = (await call('GET', `/api/outputs/${o2.id}/files`)).body
    assert.deepEqual(listed.files.map((f) => f.rel), ['ok.txt']) // el enlace no se lista
    // traversal y rutas absolutas en ?file=
    for (const bad of ['../secreto.txt', 'a/../../x', '/etc/passwd', '%2e%2e/x', 'a//b', '..']) {
      const r = await raw(`/api/files/${o2.id}?file=${bad.startsWith('%') ? bad : encodeURIComponent(bad)}`)
      assert.equal(r.status, 400, bad)
      await r.arrayBuffer()
    }
    // entregable que es un enlace simbólico a un archivo fuera de la raíz
    symlinkSync(join(outside, 'secreto.txt'), join(ROOT, 'atajo.txt'))
    const o3 = await add(join(ROOT, 'atajo.txt'))
    assert.equal((await raw(`/api/files/${o3.id}`)).status, 403)
    assert.equal((await raw('/api/files/99999')).status, 404)
    assert.equal((await raw('/api/files/abc')).status, 404)
  } finally { await app.close() }
})

test('MCP: el agente sólo ve su workspace (por cwd o BACKOFFICE_WORKSPACE)', async () => {
  const { app, call } = await boot()
  const w = await mkWs(call, 'acme')
  const port = app.server.address().port
  const client = (cwd, env = {}) => {
    const child = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname], { cwd, env: { ...process.env, BACKOFFICE_PORT: String(port), ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
    let buf = ''
    const waiters = new Map()
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(msg.id)?.(msg) }
    })
    let n = 0
    const tool = (name, args) => new Promise((resolve) => {
      const id = ++n
      waiters.set(id, (r) => resolve({ isError: !!r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) }))
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    })
    return { tool, stop: () => child.kill() }
  }
  const inAcme = client(w.root)
  const inDefault = client(ROOT)
  const viaEnv = client(tmpdir(), { BACKOFFICE_WORKSPACE: 'acme' })
  try {
    const ta = (await inAcme.tool('backoffice_task_create', { title: 'de acme' })).data
    const td = (await inDefault.tool('backoffice_task_create', { title: 'de default' })).data
    assert.deepEqual((await inAcme.tool('backoffice_task_list', {})).data.map((t) => t.id), [ta.id])
    assert.deepEqual((await inDefault.tool('backoffice_task_list', {})).data.map((t) => t.id), [td.id])
    assert.deepEqual((await viaEnv.tool('backoffice_task_list', {})).data.map((t) => t.id), [ta.id])
    const cross = await inDefault.tool('backoffice_task_update', { id: ta.id, status: 'doing' })
    assert.equal(cross.isError, true) // no existe desde el workspace default
    // el argumento workspace apunta a otro proyecto aunque el cwd sea otro; sin él, nada cambia
    assert.deepEqual((await inDefault.tool('backoffice_task_list', { workspace: 'acme' })).data.map((t) => t.id), [ta.id])
    assert.equal((await inDefault.tool('backoffice_task_update', { id: ta.id, status: 'doing', workspace: 'acme' })).data.status, 'doing')
    const mk = (await inDefault.tool('backoffice_task_create', { title: 'cruzada', workspace: 'acme' })).data
    assert.equal(mk.workspace_id, 'acme')
    assert.equal((await inDefault.tool('backoffice_overview', { workspace: 'acme' })).data.workspace.id, 'acme')
    const allp = (await inDefault.tool('backoffice_projects', {})).data
    assert.deepEqual(allp.map((p) => p.id).sort(), ['acme', 'default'])
    assert.equal((await inAcme.tool('backoffice_overview', { workspace: 'all' })).data.projects.length, 2)
    const badws = await inDefault.tool('backoffice_task_list', { workspace: 'nope' })
    assert.equal(badws.isError, true)
    assert.match(badws.data, /acme.*default|default.*acme/)
    assert.deepEqual((await inDefault.tool('backoffice_task_list', {})).data.map((t) => t.id), [td.id]) // sin argumento: proyecto de la sesión
    assert.equal((await inAcme.tool('backoffice_overview', {})).data.workspace.name, 'acme')
    assert.equal((await inDefault.tool('backoffice_overview', {})).data.workspace.name, 'Back Office')
    assert.equal((await inAcme.tool('backoffice_team_context', { agent: 'coo' })).data.workspace.id, 'acme')
    assert.equal((await inAcme.tool('backoffice_checkin', { agent: 'cmo', status: 'working' })).data.workspace_id, 'acme')
    const file = join(w.root, 'm.md')
    writeFileSync(file, 'm')
    const del = await inAcme.tool('backoffice_task_deliver', { id: ta.id, path: file })
    assert.equal(del.data.workspace_id, 'acme')
  } finally { inAcme.stop(); inDefault.stop(); viaEnv.stop(); await app.close() }
})

test('proyecto nuevo: su carpeta va en BACKOFFICE_ROOT/workspaces aunque el default apunte a otra carpeta (p. ej. el código de Back Office)', () => {
  const store = createStore(openDb(':memory:'))
  store.updateWorkspace('default', { name: 'Back Office', root: '/tmp/codigo-de-backoffice' })
  const w = store.createWorkspace({ name: 'Proyecto Nuevo' })
  assert.equal(w.root, join(ROOT, w.id))
  assert.equal(store.workspaceForCwd('/tmp/codigo-de-backoffice/web'), 'default')
})

test('rutas humanas de tareas: crear en columna, mover (incluye done), borrar con entregables, aislamiento', async () => {
  const { app, call } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Acme', id: 'acme' })
    const A = { 'x-backoffice-workspace': 'acme' }
    const D = { 'x-backoffice-workspace': 'default' }
    // crear
    const c = await call('POST', '/api/human/tasks', { title: '  Nueva  ', status: 'blocked', agent: 'cmo' }, A)
    assert.equal(c.status, 201)
    assert.equal(c.body.status, 'blocked')
    assert.equal(c.body.title, 'Nueva')
    assert.equal(c.body.workspace_id, 'acme')
    assert.equal((await call('POST', '/api/human/tasks', { title: '' }, A)).status, 400)
    assert.equal((await call('POST', '/api/human/tasks', { title: 'x'.repeat(201) }, A)).status, 400)
    assert.equal((await call('POST', '/api/human/tasks', { title: 'x', status: 'nope' }, A)).status, 400)
    assert.equal((await call('POST', '/api/human/tasks', { title: 'sin status' }, A)).body.status, 'todo')
    // mover
    assert.equal((await call('PATCH', `/api/human/tasks/${c.body.id}`, { status: 'done' }, A)).body.status, 'done')
    assert.equal((await call('PATCH', `/api/human/tasks/${c.body.id}`, { status: 'doing' }, A)).body.status, 'doing')
    assert.equal((await call('PATCH', `/api/human/tasks/${c.body.id}`, { status: 'x' }, A)).status, 400)
    assert.equal((await call('PATCH', `/api/human/tasks/${c.body.id}`, { status: 'todo' }, D)).status, 404)
    // el camino de agentes sigue sin poder done
    assert.equal((await call('PATCH', `/api/tasks/${c.body.id}`, { status: 'done' }, A)).status, 403)
    // borrar
    const file = join(ROOT, 'entrega.md')
    writeFileSync(file, 'hola')
    await call('POST', `/api/tasks/${c.body.id}/outputs`, { path: file }, A)
    const other = (await call('POST', '/api/tasks', { title: 'Otra default' })).body
    await call('POST', `/api/tasks/${other.id}/outputs`, { path: file }, D)
    assert.equal((await call('DELETE', `/api/human/tasks/${c.body.id}`, null, D)).status, 404)
    assert.equal((await call('GET', `/api/tasks/${c.body.id}`, null, A)).status, 200)
    assert.equal((await call('DELETE', `/api/human/tasks/${c.body.id}`, null, A)).status, 200)
    assert.equal((await call('GET', `/api/tasks/${c.body.id}`, null, A)).status, 404)
    assert.equal((await call('DELETE', `/api/human/tasks/${c.body.id}`, null, A)).status, 404)
    const outs = (await call('GET', '/api/outputs', null, A)).body
    assert.equal(outs.length, 0)
    assert.equal((await call('GET', '/api/outputs', null, D)).body.length, 1)
    assert.equal((await call('GET', `/api/tasks/${other.id}`, null, D)).body.outputs.length, 1)
    assert.ok(existsSync(file)) // no borra archivos
  } finally { await app.close() }
})
