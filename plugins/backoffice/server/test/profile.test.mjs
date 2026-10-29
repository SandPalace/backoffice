import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'
import { createStore } from '../src/store.mjs'

test('store: perfil parcial, límites, datos sensibles e insights (tope 200)', () => {
  const store = createStore(openDb(':memory:'))
  const events = []
  store.bus.on('change', (e) => events.push(e.type))
  let { profile, insights } = store.getProfile()
  assert.equal(profile.about, '')
  assert.deepEqual(insights, [])

  profile = store.updateProfile({ preferred_name: '  Rafa ', current_focus: 'Cerrar 3 clientes' }).profile
  assert.equal(profile.preferred_name, 'Rafa')
  profile = store.updateProfile({ about: 'Consultor' }).profile
  assert.equal(profile.current_focus, 'Cerrar 3 clientes') // parcial: no pisa lo demás
  assert.ok(profile.updated_at)
  assert.ok(events.includes('profile'))
  assert.throws(() => store.updateProfile({}), { code: 'bad_request' })
  assert.throws(() => store.updateProfile({ about: 'x'.repeat(4001) }), { code: 'too_long' })
  assert.throws(() => store.updateProfile({ about: 5 }), { code: 'bad_request' })
  assert.throws(() => store.updateProfile({ about: 'mi tarjeta 4111 1111 1111 1111' }), { code: 'sensitive' })

  const i = store.addInsight({ text: 'Prefiere respuestas cortas', category: 'communication' })
  assert.equal(i.source, 'assistant')
  assert.throws(() => store.addInsight({ text: '' }), { code: 'bad_request' })
  assert.throws(() => store.addInsight({ text: 'ok', category: 'nope' }), { code: 'bad_request' })
  assert.throws(() => store.addInsight({ text: 'x'.repeat(501) }), { code: 'too_long' })
  assert.throws(() => store.addInsight({ text: 'su contraseña es hunter2' }), { code: 'sensitive' })
  for (let n = 0; n < 205; n++) store.addInsight({ text: `nota ${n}` })
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM profile_insights').get().c, 200)
  assert.equal(store.getProfile(5).insights[0].text, 'nota 204') // más nuevas primero
  store.deleteInsight(store.getProfile(1).insights[0].id)
  assert.throws(() => store.deleteInsight(999999), { code: 'not_found' })
  assert.match(store.contextFor('coo'), /le dices Rafa/)
})

test('HTTP /api/profile y herramientas MCP del perfil', async () => {
  const app = createApp({ db: openDb(':memory:'), port: 0 })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const t = await r.text()
    return { status: r.status, body: t ? JSON.parse(t) : null }
  }
  const child = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname], { env: { ...process.env, BACKOFFICE_PORT: String(port) }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''
  const waiters = new Map()
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      waiters.get(msg.id)?.(msg)
    }
  })
  let n = 0
  const tool = (name, args) =>
    new Promise((resolve) => {
      const id = ++n
      waiters.set(id, (m) => resolve({ isError: !!m.result.isError, data: m.result.isError ? m.result.content[0].text : JSON.parse(m.result.content[0].text) }))
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    })
  try {
    let r = await call('GET', '/api/profile')
    assert.equal(r.status, 200)
    assert.equal(r.body.profile.about, '')
    assert.deepEqual(r.body.insights, [])
    r = await call('PATCH', '/api/profile', { about: 'Dueño de una inmobiliaria', professional_goals: 'Duplicar ventas' })
    assert.equal(r.body.profile.professional_goals, 'Duplicar ventas')
    assert.equal((await call('PATCH', '/api/profile', {})).status, 400)
    assert.equal((await call('PATCH', '/api/profile', { about: 'x'.repeat(4001) })).status, 400)

    const up = await tool('backoffice_profile_update', { work_style: 'Directo y breve' })
    assert.equal(up.data.profile.work_style, 'Directo y breve')
    assert.equal(up.data.profile.about, 'Dueño de una inmobiliaria')
    assert.equal((await tool('backoffice_profile_update', {})).isError, true)

    const note = await tool('backoffice_profile_note', { text: 'Le gustan los resúmenes con bullets', category: 'preference' })
    assert.equal(note.data.source, 'assistant')
    assert.equal((await tool('backoffice_profile_note', { text: 'password: abc123' })).isError, true)
    assert.equal((await tool('backoffice_profile_note', { text: 'x', category: 'zzz' })).isError, true)

    const rd = await tool('backoffice_profile_read', {})
    assert.equal(rd.data.profile.preferred_name, '')
    assert.equal(rd.data.insights.length, 1)

    r = await call('DELETE', `/api/profile/insights/${note.data.id}`)
    assert.equal(r.status, 200)
    assert.equal((await call('DELETE', `/api/profile/insights/${note.data.id}`)).status, 404)
    assert.deepEqual((await call('GET', '/api/profile')).body.insights, [])
  } finally {
    child.kill()
    await app.close()
  }
})
