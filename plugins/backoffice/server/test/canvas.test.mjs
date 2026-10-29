import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// La raíz de los workspaces va a una carpeta temporal ANTES de abrir cualquier base (nunca ~/AgentOS).
process.env.BACKOFFICE_ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-canvas-')))
const { openDb, MIGRATIONS } = await import('../src/db.mjs')
const { createApp } = await import('../src/server.mjs')

const WEB = { origin: 'http://localhost:4781' } // lo que manda el navegador (la web en otro puerto)

async function boot() {
  const app = createApp({ db: openDb(':memory:'), port: 0 })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    const t = await r.text()
    let json = null
    try { json = t ? JSON.parse(t) : null } catch { json = t }
    return { status: r.status, body: json, headers: r.headers }
  }
  return { app, port, base, call }
}

function mcpClient(port) {
  const child = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname], { env: { ...process.env, BACKOFFICE_PORT: String(port), BACKOFFICE_WORKSPACE: 'default' }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''
  const waiters = new Map()
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(msg.id)?.(msg) }
  })
  let n = 0
  const rpc = (method, params) => new Promise((resolve) => { const id = ++n; waiters.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
  const tool = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args })
    return { isError: !!r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) }
  }
  return { rpc, tool, stop: () => child.kill() }
}

test('canvas: la migración crea artifacts, artifact_versions y artifact_comments', () => {
  const db = openDb(':memory:')
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  for (const t of ['artifacts', 'artifact_versions', 'artifact_comments']) assert.ok(tables.includes(t), t)
  assert.equal(db.prepare('SELECT MAX(n) AS n FROM _migrations').get().n, MIGRATIONS.length - 1)
  assert.ok(MIGRATIONS.some((m) => /CREATE TABLE IF NOT EXISTS artifacts/.test(String(m))))
  const cols = db.prepare('PRAGMA table_info(artifact_comments)').all().map((c) => c.name)
  assert.deepEqual(cols, ['id', 'artifact_id', 'version_n', 'author', 'body', 'decision', 'read_by_agent', 'created_at'])
})

test('canvas: publicar, versión nueva desde un archivo (copia), listar, detalle y contenido crudo', async () => {
  const { app, call, base } = await boot()
  try {
    const p = await call('POST', '/api/canvas/publish', { agent: 'backoffice:CMO', title: 'Post de lanzamiento', name: 'post.md', content: '# Hola\nv1', description: 'Revisa el tono' })
    assert.equal(p.status, 201, JSON.stringify(p.body))
    assert.match(p.body.id, /^A-[0-9a-f]{8}$/)
    assert.equal(p.body.status, 'in_review')
    assert.equal(p.body.kind, 'markdown')
    assert.equal(p.body.scope_type, 'agent')
    assert.equal(p.body.scope_id, 'cmo')
    assert.equal(p.body.author_agent, 'cmo')
    assert.equal(p.body.current_version, 1)
    const id = p.body.id

    // versión 2 desde un archivo del almacenamiento; editarlo después no cambia lo publicado
    assert.equal((await call('POST', '/api/files/write', { path: 'marketing/post.md', content: '# Hola\nv2' })).status, 201)
    const v2 = await call('POST', '/api/canvas/publish', { agent: 'cmo', artifact_id: id, path: 'marketing/post.md', note: 'Tono más cercano' })
    assert.equal(v2.status, 201, JSON.stringify(v2.body))
    assert.equal(v2.body.current_version, 2)
    await call('POST', '/api/files/write', { path: 'marketing/post.md', content: 'editado después' })

    const raw = async (n) => { const r = await fetch(`${base}/api/workspaces/default/canvas/${id}/v/${n}`); return { status: r.status, type: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options'), text: await r.text() } }
    const r1 = await raw(1), r2 = await raw(2)
    assert.equal(r1.text, '# Hola\nv1')
    assert.equal(r2.text, '# Hola\nv2')
    assert.match(r1.type, /^text\/markdown/)
    assert.equal(r1.nosniff, 'nosniff')

    const list = await call('GET', '/api/workspaces/default/canvas')
    assert.deepEqual(list.body.map((a) => [a.id, a.current_version, a.status]), [[id, 2, 'in_review']])
    assert.equal((await call('GET', '/api/workspaces/default/canvas?scope_type=agent&scope_id=cmo')).body.length, 1)
    assert.equal((await call('GET', '/api/workspaces/default/canvas?scope_type=team')).body.length, 0)
    assert.equal((await call('GET', '/api/workspaces/default/canvas?status=approved')).body.length, 0)

    const d = await call('GET', `/api/workspaces/default/canvas/${id}`)
    assert.deepEqual(d.body.versions.map((v) => [v.n, v.note, v.url]), [[1, null, `/api/workspaces/default/canvas/${id}/v/1`], [2, 'Tono más cercano', `/api/workspaces/default/canvas/${id}/v/2`]])
    assert.deepEqual(d.body.comments, [])

    // html: se sirve con la CSP de sandbox (sin same-origin), igual que los archivos
    const h = await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'Landing', scope_type: 'workspace', name: 'landing.html', content: '<h1>x</h1>' })
    assert.equal(h.body.scope_id, 'default')
    const hr = await fetch(`${base}${h.body.url}`)
    assert.equal(hr.headers.get('content-security-policy'), 'sandbox allow-scripts')

    // alcance de equipo: por defecto el equipo del workspace donde está el agente, si no el plugin del roster
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'T', scope_type: 'team', name: 'a.txt', content: 'x' })).body.scope_id, 'marketing-team')
    const team = (await call('POST', '/api/teams', { name: 'Mkt', members: [{ agent_id: 'cmo' }] })).body
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'T2', scope_type: 'team', name: 'a.txt', content: 'x' })).body.scope_id, team.id)

    // validaciones
    assert.equal((await call('POST', '/api/canvas/publish', { title: 'Sin agente', name: 'a.md', content: 'x' })).status, 400)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'Zip', name: 'a.zip', content_base64: 'UEsDBA==' })).body.error, 'unsupported_kind')
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'X', name: 'a.md', content: 'x', task_id: 'T-nope' })).status, 404)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'nadie-real', title: 'X', scope_type: 'agent', name: 'a.md', content: 'x' })).status, 404)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'X', scope_type: 'galaxy', name: 'a.md', content: 'x' })).status, 400)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'X', path: 'no/existe.md' })).status, 404)
  } finally { await app.close() }
})

test('canvas: los agentes no aprueban ni piden cambios; la persona sí, y la tarea ligada no se toca', async () => {
  const { app, call } = await boot()
  try {
    const task = (await call('POST', '/api/tasks', { title: 'Cotización', agent: 'proposal-writer' })).body
    const a = (await call('POST', '/api/canvas/publish', { agent: 'proposal-writer', title: 'Cotización Acme', name: 'cot.md', content: 'x', task_id: task.id, request_review: false })).body
    assert.equal(a.status, 'draft')
    assert.equal(a.task_id, task.id)

    // sin Origin (MCP, hooks, curl) = no es la persona
    const noHuman = await call('POST', `/api/workspaces/default/canvas/${a.id}/decision`, { decision: 'approved' })
    assert.equal(noHuman.status, 403)
    assert.equal(noHuman.body.error, 'human_only')
    assert.equal((await call('POST', `/api/workspaces/default/canvas/${a.id}/comments`, { body: 'soy la persona' })).status, 403)
    // un agente no puede firmar como «humano»
    assert.equal((await call('POST', `/api/canvas/${a.id}/comments`, { body: 'ok', agent: 'humano' })).status, 403)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'humano', title: 'X', name: 'a.md', content: 'x' })).status, 403)
    // publicar nunca deja approved: un campo status se ignora
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'proposal-writer', artifact_id: a.id, name: 'cot.md', content: 'y', status: 'approved' })).body.status, 'in_review')

    // la persona: pedir cambios exige comentario
    assert.equal((await call('POST', `/api/workspaces/default/canvas/${a.id}/decision`, { decision: 'changes_requested' }, WEB)).status, 400)
    assert.equal((await call('POST', `/api/workspaces/default/canvas/${a.id}/decision`, { decision: 'done' }, WEB)).status, 400)
    const ch = await call('POST', `/api/workspaces/default/canvas/${a.id}/decision`, { decision: 'changes_requested', comment: 'Falta el IVA' }, WEB)
    assert.equal(ch.status, 200, JSON.stringify(ch.body))
    assert.equal(ch.body.status, 'changes_requested')
    assert.deepEqual(ch.body.comments.map((c) => [c.author, c.body, c.decision, c.version_n]), [['humano', 'Falta el IVA', 'changes_requested', 2]])

    // el agente se entera: needs_action, checkin y team_context
    const pend = await call('GET', '/api/canvas?needs_action=true&agent=proposal-writer')
    assert.deepEqual(pend.body.map((x) => x.id), [a.id])
    assert.equal((await call('GET', '/api/canvas?needs_action=true')).status, 400)
    assert.equal((await call('GET', '/api/canvas?needs_action=true&agent=cmo')).body.length, 0)
    assert.match((await call('POST', '/api/checkin', { agent: 'proposal-writer', status: 'working' })).body.canvas_feedback, /^1 canvas artifact/)
    assert.equal((await call('POST', '/api/checkin', { agent: 'cmo', status: 'working' })).body.canvas_feedback, undefined)
    assert.match((await call('GET', '/api/context?agent=proposal-writer')).body.canvas_feedback, /needs_action=true/)

    // el agente lee (marca leído), contesta y sube la corrección: deja de estar pendiente
    const got = await call('GET', `/api/canvas/${a.id}?agent=proposal-writer`)
    assert.equal(got.body.comments[0].read_by_agent, 1)
    assert.equal((await call('POST', `/api/canvas/${a.id}/comments`, { body: 'Listo, agregué el IVA', agent: 'proposal-writer' })).status, 201)
    await call('POST', '/api/canvas/publish', { agent: 'proposal-writer', artifact_id: a.id, name: 'cot.md', content: 'con IVA' })
    assert.equal((await call('GET', '/api/canvas?needs_action=true&agent=proposal-writer')).body.length, 0)

    // comentario de la persona sin decisión = pendiente otra vez; aprobar no cierra la tarea
    await call('POST', `/api/workspaces/default/canvas/${a.id}/comments`, { body: '¿Y la vigencia?' }, WEB)
    assert.equal((await call('GET', '/api/canvas?needs_action=true&agent=proposal-writer')).body.length, 1)
    const ok = await call('POST', `/api/workspaces/default/canvas/${a.id}/decision`, { decision: 'approved' }, WEB)
    assert.equal(ok.body.status, 'approved')
    assert.deepEqual(ok.body.task, { id: task.id, title: 'Cotización', status: 'todo' })
    assert.equal((await call('GET', `/api/tasks/${task.id}`)).body.status, 'todo')
  } finally { await app.close() }
})

test('canvas: aislamiento por workspace y rutas de contenido a prueba de traversal', async () => {
  const { app, call, base } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Acme', id: 'acme' })
    await call('POST', '/api/workspaces', { name: 'Beta', id: 'beta' })
    const a = (await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'De Acme', name: 'a.md', content: 'secreto' }, { 'x-backoffice-workspace': 'acme' })).body
    assert.equal(a.workspace_id, 'acme')
    assert.equal((await call('GET', '/api/workspaces/acme/canvas')).body.length, 1)
    assert.equal((await call('GET', '/api/workspaces/beta/canvas')).body.length, 0)
    assert.equal((await call('GET', `/api/workspaces/beta/canvas/${a.id}`)).status, 404)
    assert.equal((await fetch(`${base}/api/workspaces/beta/canvas/${a.id}/v/1`)).status, 404)
    assert.equal((await call('POST', `/api/workspaces/beta/canvas/${a.id}/decision`, { decision: 'approved' }, WEB)).status, 404)
    assert.equal((await call('GET', `/api/canvas/${a.id}`, undefined, { 'x-backoffice-workspace': 'beta' })).status, 404)
    assert.equal((await call('POST', `/api/canvas/${a.id}/comments`, { body: 'x', agent: 'cmo' }, { 'x-backoffice-workspace': 'beta' })).status, 404)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', artifact_id: a.id, name: 'a.md', content: 'y' }, { 'x-backoffice-workspace': 'beta' })).status, 404)
    assert.equal((await call('GET', '/api/canvas', undefined, { 'x-backoffice-workspace': 'beta' })).body.length, 0)
    // las versiones viven en el bucket de su workspace, bajo canvas/
    assert.equal((await fetch(`${base}/api/workspaces/acme/object?key=${encodeURIComponent(`canvas/agent/cmo/${a.id}/v1.md`)}`)).status, 200)

    // traversal: la clave sale de la base, nunca de la URL
    for (const p of [`/api/workspaces/acme/canvas/..%2F..%2Fetc/v/1`, `/api/workspaces/acme/canvas/${a.id}/v/..%2F1`, `/api/workspaces/acme/canvas/${a.id}/v/1%2F..%2F..%2Fpasswd`, `/api/workspaces/acme/canvas/${a.id}/v/2`, `/api/workspaces/acme/canvas/${a.id}/v/abc`, `/api/workspaces/..%2Fdefault/canvas/${a.id}/v/1`]) {
      const r = await fetch(base + p)
      assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`)
      assert.doesNotMatch(await r.text(), /secreto/)
    }
    // un nombre de archivo con / o un path con .. no sirven para publicar
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'X', name: '../x.md', content: 'x' }, { 'x-backoffice-workspace': 'acme' })).status, 400)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'cmo', title: 'X', path: '../../etc/passwd' }, { 'x-backoffice-workspace': 'acme' })).status, 400)
  } finally { await app.close() }
})

test('canvas: herramientas MCP publish → list → get → comment, y emiten eventos canvas por SSE', async () => {
  const { app, port, call } = await boot()
  const events = []
  app.store.bus.on('change', (e) => { if (e.type === 'canvas') events.push(e) })
  const mcp = mcpClient(port)
  try {
    const names = (await mcp.rpc('tools/list')).result.tools.map((t) => t.name)
    for (const n of ['backoffice_artifact_publish', 'backoffice_artifact_list', 'backoffice_artifact_get', 'backoffice_artifact_comment']) assert.ok(names.includes(n), n)
    const p = await mcp.tool('backoffice_artifact_publish', { agent: 'creative', title: 'Arte del post', name: 'arte.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' })
    assert.equal(p.isError, false, p.data)
    assert.equal(p.data.kind, 'image')
    assert.equal((await mcp.tool('backoffice_artifact_list', { scope_type: 'agent', scope_id: 'creative' })).data.length, 1)
    await call('POST', `/api/workspaces/default/canvas/${p.data.id}/decision`, { decision: 'changes_requested', comment: 'Más color' }, WEB)
    assert.equal((await mcp.tool('backoffice_artifact_list', { needs_action: true, agent: 'creative' })).data.length, 1)
    const g = await mcp.tool('backoffice_artifact_get', { id: p.data.id, agent: 'creative' })
    assert.match(g.data.versions[0].content_url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/api/workspaces/default/canvas/${p.data.id}/v/1$`))
    assert.equal(g.data.comments[0].body, 'Más color')
    assert.equal((await mcp.tool('backoffice_artifact_comment', { id: p.data.id, agent: 'creative', body: 'Va' })).isError, false)
    assert.equal((await mcp.tool('backoffice_artifact_publish', { title: 'x', name: 'a.md', content: 'x' })).isError, true)
    assert.deepEqual([...new Set(events.map((e) => e.workspace_id))], ['default'])
    assert.ok(events.length >= 4)
  } finally { mcp.stop(); await app.close() }
})

test('canvas home: la migración agrega is_home con índice único parcial por workspace', () => {
  const db = openDb(':memory:')
  assert.ok(db.prepare('PRAGMA table_info(artifacts)').all().some((c) => c.name === 'is_home'))
  assert.match(String(MIGRATIONS.find((m) => /is_home/.test(String(m))) ?? ''), /is_home/)
  const ins = (id, ws, home) => db.prepare("INSERT INTO artifacts (id, workspace_id, scope_type, scope_id, title, kind, created_at, updated_at, is_home) VALUES (?, ?, 'workspace', ?, 't', 'html', 0, 0, ?)").run(id, ws, ws, home)
  ins('A-1', 'default', 1); ins('A-2', 'default', 0); ins('A-3', 'default', 0); ins('A-4', 'acme', 1)
  assert.throws(() => ins('A-5', 'default', 1), /UNIQUE/)
})

test('canvas home: cualquier agente lo crea y versiona, uno por workspace, sin revisión; la persona comenta; GET /canvas/home', async () => {
  const { app, call, base } = await boot()
  try {
    await call('POST', '/api/workspaces', { name: 'Acme', id: 'acme' })
    assert.equal((await call('GET', '/api/workspaces/default/canvas/home')).body, null)
    assert.equal((await call('GET', '/api/workspaces/nope/canvas/home')).status, 404)

    const h1 = await call('POST', '/api/canvas/publish', { agent: 'backoffice:COO', home: true, name: 'inicio.html', content: '<h1>v1</h1>', request_review: true })
    assert.equal(h1.status, 201, JSON.stringify(h1.body))
    assert.equal(h1.body.is_home, 1)
    assert.equal(h1.body.status, 'draft') // página viva: nunca in_review aunque lo pida
    assert.equal(h1.body.scope_type, 'workspace')
    assert.equal(h1.body.scope_id, 'default')
    assert.equal(h1.body.title, 'Inicio del proyecto')
    assert.equal(h1.body.author_agent, 'coo')

    // home: true otra vez = versión nueva del mismo artefacto (no crea otro)
    const h2 = await call('POST', '/api/canvas/publish', { agent: 'coo', home: true, title: 'Inicio Mi Negocio', name: 'inicio.html', content: '<h1>v2</h1>', note: 'Tareas al día' })
    assert.equal(h2.status, 201, JSON.stringify(h2.body))
    assert.equal(h2.body.id, h1.body.id)
    assert.equal(h2.body.current_version, 2)
    assert.equal(h2.body.title, 'Inicio Mi Negocio')
    assert.equal((await call('GET', '/api/workspaces/default/canvas')).body.filter((a) => a.is_home).length, 1)
    // home: true con el id de otro artefacto, sin contenido o en otro alcance = error
    const other = (await call('POST', '/api/canvas/publish', { agent: 'coo', title: 'Otro', scope_type: 'workspace', name: 'o.md', content: 'x' })).body
    assert.equal(other.is_home, 0)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'coo', home: true, artifact_id: other.id, name: 'i.html', content: 'x' })).status, 400)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'coo', home: true })).status, 400)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'coo', home: true, scope_type: 'agent', name: 'i.html', content: 'x' })).status, 400)

    // ruta de la web: versión actual con su URL
    const g = await call('GET', '/api/workspaces/default/canvas/home')
    assert.equal(g.status, 200)
    assert.equal(g.body.id, h1.body.id)
    assert.equal(g.body.current_version, 2)
    assert.equal(g.body.version_note, 'Tareas al día')
    assert.equal(g.body.url, `/api/workspaces/default/canvas/${h1.body.id}/v/2`)
    assert.equal(await (await fetch(base + g.body.url)).text(), '<h1>v2</h1>')
    // otro agente (el encargado del proyecto, p. ej. cmo) también lo versiona: sigue siendo el mismo y único inicio
    const h3 = await call('POST', '/api/canvas/publish', { agent: 'cmo', home: true, name: 'inicio.html', content: '<h1>v3</h1>' })
    assert.equal(h3.status, 201, JSON.stringify(h3.body))
    assert.equal(h3.body.id, h1.body.id)
    assert.equal(h3.body.current_version, 3)
    assert.equal((await call('GET', '/api/workspaces/default/canvas')).body.filter((a) => a.is_home).length, 1)
    assert.equal(await (await fetch(`${base}/api/workspaces/default/canvas/${h1.body.id}/v/1`)).text(), '<h1>v1</h1>') // inmutable

    // la persona comenta (le llega a coo); no se aprueba ni se piden cambios
    assert.equal((await call('POST', `/api/workspaces/default/canvas/${h1.body.id}/comments`, { body: 'Agrega los leads' }, WEB)).status, 200)
    assert.equal((await call('GET', '/api/canvas?needs_action=true&agent=coo')).body.length, 1)
    const dec = await call('POST', `/api/workspaces/default/canvas/${h1.body.id}/decision`, { decision: 'approved' }, WEB)
    assert.equal(dec.status, 400)
    assert.equal(dec.body.error, 'home_no_review')

    // aislamiento: el home de default no es el de acme, y cada workspace tiene el suyo
    assert.equal((await call('GET', '/api/workspaces/acme/canvas/home')).body, null)
    const ha = await call('POST', '/api/canvas/publish', { agent: 'coo', home: true, name: 'inicio.html', content: '<h1>acme</h1>' }, { 'x-backoffice-workspace': 'acme' })
    assert.equal(ha.status, 201, JSON.stringify(ha.body))
    assert.notEqual(ha.body.id, h1.body.id)
    assert.equal(ha.body.current_version, 1)
    assert.equal((await call('GET', '/api/workspaces/acme/canvas/home')).body.id, ha.body.id)
    assert.equal((await call('GET', '/api/workspaces/default/canvas/home')).body.id, h1.body.id)
    assert.equal((await call('POST', '/api/canvas/publish', { agent: 'coo', artifact_id: h1.body.id, name: 'i.html', content: 'x' }, { 'x-backoffice-workspace': 'acme' })).status, 404)
  } finally { await app.close() }
})

test('canvas home: MCP backoffice_artifact_publish con home=true (cmo y coo); list/get exponen is_home', async () => {
  const { app, port } = await boot()
  const mcp = mcpClient(port)
  try {
    const tool = (await mcp.rpc('tools/list')).result.tools.find((t) => t.name === 'backoffice_artifact_publish')
    assert.equal(tool.inputSchema.properties.home.type, 'boolean')
    assert.equal((await mcp.tool('backoffice_artifact_publish', { agent: 'cmo', home: true, name: 'i.md', content: '# x' })).isError, false) // cualquier agente
    const p = await mcp.tool('backoffice_artifact_publish', { agent: 'coo', home: true, name: 'inicio.md', content: '# Inicio' })
    assert.equal(p.isError, false, p.data)
    assert.equal(p.data.is_home, 1)
    assert.deepEqual((await mcp.tool('backoffice_artifact_list', {})).data.map((a) => a.is_home), [1])
    assert.equal((await mcp.tool('backoffice_artifact_get', { id: p.data.id, agent: 'coo' })).data.is_home, 1)
  } finally { mcp.stop(); await app.close() }
})
