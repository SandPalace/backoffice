import { test } from 'node:test'
import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'
import { stateFromEvent } from '../src/status.mjs'

async function boot() {
  const app = createApp({ db: openDb(':memory:'), port: 0 })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null }
  }
  return { app, base, call }
}

test('stateFromEvent traduce hooks a estados', () => {
  assert.equal(stateFromEvent('UserPromptSubmit').status, 'working')
  assert.equal(stateFromEvent('PermissionRequest', { tool_name: 'Bash' }).status, 'waiting')
  assert.equal(stateFromEvent('Stop').status, 'idle')
  assert.equal(stateFromEvent('PreToolUse', { tool_name: 'AskUserQuestion' }).status, 'waiting')
  assert.equal(stateFromEvent('SessionEnd').status, 'offline')
  assert.equal(stateFromEvent('SubagentStart'), null)
  assert.match(stateFromEvent('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a/b.md' } }).detail, /Read: \/a\/b\.md/)
})

test('un hook crea la sesión y cambia su estado', async () => {
  const { app, call } = await boot()
  const sid = 's-1'
  await call('POST', '/hooks/SessionStart', { session_id: sid, cwd: '/Users/x/inmobiliaria' })
  let { body } = await call('GET', '/api/sessions')
  assert.equal(body[0].status, 'idle')
  assert.equal(body[0].project, 'inmobiliaria')
  await call('POST', '/hooks/UserPromptSubmit', { session_id: sid })
  await call('POST', '/hooks/PermissionRequest', { session_id: sid, tool_name: 'Bash' })
  ;({ body } = await call('GET', '/api/sessions'))
  assert.equal(body[0].status, 'waiting')
  await call('POST', '/hooks/Stop', { session_id: sid })
  ;({ body } = await call('GET', '/api/sessions'))
  assert.equal(body[0].status, 'idle')
  await call('POST', '/hooks/SubagentStart', { session_id: sid, agent_id: 'a1', agent_type: 'analyst' })
  ;({ body } = await call('GET', '/api/sessions'))
  assert.equal(body.find((s) => s.id === sid).subagents, 1)
  await app.close()
})

// Secuencia real capturada de Claude Code 2.1 con --plugin-dir (13 oct 2026): el padre delega en un subagente.
test('un subagente se enciende en su escritorio y el padre conserva su identidad', async () => {
  const { app, call } = await boot()
  const sid = 'e5b05f30'
  const sub = { session_id: sid, cwd: '/x/e2e', agent_id: 'a2258a0b', agent_type: 'backoffice:researcher' }
  const get = async (id) => (await call('GET', '/api/sessions')).body.find((s) => s.id === id)
  await call('POST', '/hooks/SessionStart', { session_id: sid, cwd: '/x/e2e', source: 'startup' })
  await call('POST', '/hooks/UserPromptSubmit', { session_id: sid, cwd: '/x/e2e' })
  await call('POST', '/hooks/PreToolUse', { session_id: sid, cwd: '/x/e2e', tool_name: 'Agent' })
  await call('POST', '/hooks/SubagentStart', sub)
  let child = await get(`${sid}/a2258a0b`)
  assert.equal(child.agent, 'researcher') // sin el prefijo del plugin, igual que el roster de la web
  assert.equal(child.status, 'working')
  await call('POST', '/hooks/PreToolUse', { ...sub, tool_name: 'WebSearch', tool_input: { query: 'rentas' } })
  assert.equal((await get(`${sid}/a2258a0b`)).tool, 'WebSearch')
  let parent = await get(sid)
  assert.equal(parent.agent, null)
  assert.equal(parent.subagents, 1)
  assert.equal(parent.tool, 'Agent') // la herramienta del subagente no pisa la del padre
  await call('POST', '/hooks/SubagentStop', sub)
  assert.equal((await get(`${sid}/a2258a0b`)).status, 'offline')
  assert.equal((await get(sid)).subagents, 0)
  // Si la sesión se cierra con un subagente vivo, el subagente también se apaga.
  await call('POST', '/hooks/SubagentStart', { ...sub, agent_id: 'b2' })
  await call('POST', '/hooks/SessionEnd', { session_id: sid, cwd: '/x/e2e' })
  assert.equal((await get(`${sid}/b2`)).status, 'offline')
  assert.equal((await get(sid)).status, 'offline')
  await app.close()
})

test('los hooks siempre responden 200, aunque el cuerpo sea basura', async () => {
  const { app, base } = await boot()
  const r = await fetch(`${base}/hooks/Stop`, { method: 'POST', body: '{no es json' })
  assert.equal(r.status, 200)
  await app.close()
})

test('rechaza un Host que no es local', async () => {
  const { app, base } = await boot()
  const port = new URL(base).port
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/health', headers: { host: 'evil.example.com' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(status, 403)
  await app.close()
})

test('tarea: no pasa a review sin entregable; sí con output_dir o con un archivo', async () => {
  const { app, call } = await boot()
  const dir = mkdtempSync(join(tmpdir(), 'backoffice-'))
  const file = join(dir, 'reporte.html')
  writeFileSync(file, '<h1>hola</h1>')

  const { body: t } = await call('POST', '/api/tasks', { title: 'Reporte de leads', agent: 'analyst' })
  assert.equal(t.status, 'todo')
  await call('PATCH', `/api/tasks/${t.id}`, { status: 'doing' })

  let r = await call('PATCH', `/api/tasks/${t.id}`, { status: 'review' })
  assert.equal(r.status, 422)
  assert.equal(r.body.error, 'needs_output')

  r = await call('PATCH', `/api/tasks/${t.id}`, { status: 'review', output_dir: 'relativa/no/vale' })
  assert.equal(r.body.error, 'bad_path')

  r = await call('POST', `/api/tasks/${t.id}/outputs`, { path: file, kind: 'report', title: 'Reporte' })
  assert.equal(r.status, 201)
  assert.equal(r.body.outputs[0].exists, true)

  r = await call('PATCH', `/api/tasks/${t.id}`, { status: 'review', output_dir: dir })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'review')
  assert.equal(r.body.output_dir_exists, true)
  await app.close()
})

test('sólo una persona marca done', async () => {
  const { app, call } = await boot()
  const dir = mkdtempSync(join(tmpdir(), 'backoffice-'))
  const { body: t } = await call('POST', '/api/tasks', { title: 'Guion' })
  let r = await call('PATCH', `/api/tasks/${t.id}`, { status: 'done' })
  assert.equal(r.status, 403)
  r = await call('POST', `/api/human/tasks/${t.id}/approve`, {})
  assert.equal(r.body.error, 'not_in_review')
  await call('PATCH', `/api/tasks/${t.id}`, { status: 'review', output_dir: dir })
  r = await call('POST', `/api/human/tasks/${t.id}/approve`, { by: 'owner' })
  assert.equal(r.body.status, 'done')
  await app.close()
})

test('SSE entrega un snapshot y los cambios', async () => {
  const { app, base, call } = await boot()
  const res = await fetch(`${base}/api/stream`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const read = async (until) => {
    while (!buf.includes(until)) buf += dec.decode((await reader.read()).value)
  }
  await read('event: snapshot')
  await call('POST', '/hooks/UserPromptSubmit', { session_id: 'live', cwd: '/x/y' })
  await read('event: session')
  assert.match(buf, /"status":"working"/)
  await reader.cancel()
  await app.close()
})

test('abrir carpeta: sólo rutas registradas como entregable', async () => {
  const { app, call } = await boot()
  let r = await call('POST', '/api/human/open', { path: '/etc' })
  assert.equal(r.status, 403)
  assert.equal(r.body.error, 'unknown_path')
  await app.close()
})

test('equipos: crear, activar y adjuntar contexto por agente', async () => {
  const { app, call } = await boot()
  try {
    const a = await call('POST', '/api/teams', { name: 'Marketing', members: [{ agent_id: 'cmo', display_name: ' Sofía ', avatar: 6, context: 'Vendemos casas en San Nicolás' }, { agent_id: 'creative', context: '' }] })
    assert.equal(a.status, 201)
    assert.equal(a.body.active, true) // el primero queda activo
    const b = await call('POST', '/api/teams', { name: 'Admin', members: [{ agent_id: 'analyst', context: 'Gastos' }] })
    assert.equal(b.body.active, false)

    // contexto del agente en el equipo activo (acepta el prefijo del plugin)
    let c = await call('GET', '/api/context?agent=backoffice:cmo')
    assert.match(c.body.context, /«Marketing»/)
    assert.match(c.body.context, /San Nicolás/)
    assert.match(c.body.context, /creative/)
    assert.match(c.body.context, /te llaman Sofía/)
    assert.equal(a.body.members[0].display_name, 'Sofía') // se recorta
    assert.equal(a.body.members[0].avatar, 6)
    assert.equal(a.body.members[1].avatar, null) // sin elegir: la del roster
    assert.equal((await call('POST', '/api/teams', { name: 'Y', members: [{ agent_id: 'cmo', avatar: 21 }] })).status, 400)
    assert.equal((await call('POST', '/api/teams', { name: 'X', members: [{ agent_id: 'cmo', display_name: 'x'.repeat(41) }] })).status, 400)
    assert.equal((await call('GET', '/api/context?agent=analyst')).body.context, null) // no está en el activo

    // el hook de SubagentStart devuelve additionalContext; los demás agentes no reciben nada
    const r = await fetch(app.server.address() ? `http://127.0.0.1:${app.server.address().port}/hooks/SubagentStart` : '', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: 's1', agent_type: 'cmo' }) })
    const hook = JSON.parse(await r.text())
    assert.equal(hook.hookSpecificOutput.hookEventName, 'SubagentStart')
    assert.match(hook.hookSpecificOutput.additionalContext, /San Nicolás/)

    // cambiar de equipo activo
    await call('POST', `/api/teams/${b.body.id}/activate`)
    assert.match((await call('GET', '/api/context?agent=analyst')).body.context, /Gastos/)
    assert.equal((await call('GET', '/api/context?agent=cmo')).body.context, null)

    // editar y validar
    const u = await call('PATCH', `/api/teams/${b.body.id}`, { name: 'Administración', members: [{ agent_id: 'analyst', context: 'Gastos y agenda' }] })
    assert.equal(u.body.name, 'Administración')
    assert.equal((await call('POST', '/api/teams', { name: '', members: [] })).status, 400)
    assert.equal((await call('PATCH', `/api/teams/${b.body.id}`, { members: [{ agent_id: 'a' }, { agent_id: 'a' }] })).status, 400)

    // borrar el activo pasa la activación al que queda
    assert.equal((await call('DELETE', `/api/teams/${b.body.id}`)).status, 200)
    const left = await call('GET', '/api/teams')
    assert.equal(left.body.length, 1)
    assert.equal(left.body[0].active, true)
  } finally {
    await app.close()
  }
})

test('COO: agente del sistema con contexto propio y panorama de todos los equipos', async () => {
  const { app, base, call } = await boot()
  try {
    // existe desde el inicio y siempre recibe contexto, aunque no haya equipo activo
    assert.equal((await call('GET', '/api/system')).body.coo.display_name, '')
    let c = await call('GET', '/api/context?agent=backoffice:coo')
    assert.match(c.body.context, /Assistant, la recepcionista de Back Office/)
    assert.match(c.body.context, /equipos ninguno todavía \(se arman en la pestaña Equipos\)/)

    const u = await call('PATCH', '/api/system/coo', { display_name: ' Rafa ', avatar: 12, context: 'Habla de tú y sé breve' })
    assert.equal(u.body.display_name, 'Rafa')
    assert.equal(u.body.avatar, 12)
    assert.equal((await call('PATCH', '/api/system/coo', { avatar: 99 })).status, 400)
    assert.equal((await call('PATCH', '/api/system/otro', {})).status, 404)

    const team = await call('POST', '/api/teams', { name: 'Ventas', members: [{ agent_id: 'lead-qualifier', display_name: 'Ana' }, { agent_id: 'follow-up' }] })
    c = await call('GET', '/api/context?agent=coo')
    assert.match(c.body.context, /te llama Rafa/)
    assert.match(c.body.context, /«Ventas»/)
    assert.match(c.body.context, /Ana \(lead-qualifier\)/)
    assert.match(c.body.context, /sé breve/)

    // panorama: un agente trabajando, una tarea en revisión y una sesión suelta
    await call('POST', '/api/checkin', { agent: 'lead-qualifier', status: 'working', detail: 'Perfilando un lead' })
    await call('POST', '/api/checkin', { agent: 'suelto', status: 'idle' })
    const t = await call('POST', '/api/tasks', { title: 'Perfil de Carlos', agent: 'lead-qualifier' })
    await call('PATCH', `/api/tasks/${t.body.id}`, { status: 'blocked' })
    const o = (await call('GET', '/api/overview')).body
    assert.equal(o.coo.display_name, 'Rafa')
    assert.equal(o.active_team.id, team.body.id)
    const ana = o.teams[0].members.find((m) => m.agent_id === 'lead-qualifier')
    assert.equal(ana.name, 'Ana')
    assert.equal(ana.status, 'working')
    assert.equal(ana.open_tasks[0].status, 'blocked')
    assert.equal(o.tasks.blocked, 1)
    assert.equal(o.needs_you[0].task_id, t.body.id)
    assert.ok(o.loose_sessions.some((s) => s.detail === null || s.status === 'idle'))

    // el panorama llega por el stream inicial y por el cambio del COO
    const res = await fetch(`${base}/api/stream`)
    const reader = res.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    assert.match(first, /"system":\{"coo":\{"agent_id":"coo","display_name":"Rafa"/)
    await reader.cancel()
  } finally {
    await app.close()
  }
})

test('session_ref: conversación existente de Claude por agente y para el COO', async () => {
  const { app, call } = await boot()
  try {
    const t = await call('POST', '/api/teams', { name: 'Dev', members: [{ agent_id: 'tech-lead' }] })
    assert.equal(t.body.members[0].session_ref, null)
    const u = await call('PATCH', `/api/teams/${t.body.id}`, { members: [{ agent_id: 'tech-lead', session_ref: '  cse_01SGXsU5dvQJdmphAHctBAqs ' }, { agent_id: 'cmo', session_ref: '   ' }] })
    assert.equal(u.body.members[0].session_ref, 'cse_01SGXsU5dvQJdmphAHctBAqs')
    assert.equal(u.body.members[1].session_ref, null)
    assert.equal((await call('GET', '/api/teams')).body[0].members[0].session_ref, 'cse_01SGXsU5dvQJdmphAHctBAqs')
    assert.equal((await call('PATCH', `/api/teams/${t.body.id}`, { members: [{ agent_id: 'cmo', session_ref: 'x'.repeat(301) }] })).status, 400)

    assert.equal((await call('GET', '/api/system')).body.coo.session_ref, null)
    const c = await call('PATCH', '/api/system/coo', { session_ref: ' https://claude.ai/code/cse_abc ' })
    assert.equal(c.body.session_ref, 'https://claude.ai/code/cse_abc')
    // un parche sin session_ref no lo borra; vacío sí
    assert.equal((await call('PATCH', '/api/system/coo', { display_name: 'Rafa' })).body.session_ref, 'https://claude.ai/code/cse_abc')
    assert.equal((await call('PATCH', '/api/system/coo', { session_ref: '' })).body.session_ref, null)
    assert.equal((await call('PATCH', '/api/system/coo', { session_ref: 'y'.repeat(301) })).status, 400)
  } finally {
    await app.close()
  }
})
