import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'

async function boot(port = 0) {
  const db = openDb(':memory:')
  const app = createApp({ db, port })
  const real = await app.listen()
  const base = `http://127.0.0.1:${real}`
  const hook = (event, body, headers = {}) =>
    fetch(`${base}/hooks/${event}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const sessions = async () => (await fetch(`${base}/api/sessions`)).json()
  return { db, app, hook, sessions, base }
}

test('hooks: un evento de otro puerto (BACKOFFICE_PORT de una corrida aislada) no se registra', async () => {
  const { app, hook, sessions } = await boot(0)
  await hook('SessionStart', { session_id: 'iso-1', cwd: '/tmp/agt' }, { 'x-backoffice-port': '4791' })
  assert.deepEqual(await sessions(), [])
  await app.close()
})

test('hooks: sin BACKOFFICE_PORT (header vacío) o sin header se registran normal', async () => {
  const { app, hook, sessions } = await boot(0)
  try {
    // roster agents: sessions outside every workspace root are only tracked for them (store tracksSession)
    await hook('SessionStart', { session_id: 'a', cwd: '/Users/x/proj', agent_type: 'backoffice:cmo' }, { 'x-backoffice-port': '' })
    await hook('SessionStart', { session_id: 'b', cwd: '/Users/x/proj2', agent_type: 'backoffice:cmo' })
    assert.equal((await sessions()).length, 2)
  } finally { await app.close() }
})

test('sesiones de auto-reporte (mcp:) sin check-in por 30 min se muestran sin conexión', async () => {
  const { db, app, base, sessions } = await boot(0)
  await fetch(`${base}/api/checkin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'cmo', status: 'working', detail: 'x' }) })
  assert.equal((await sessions()).find((s) => s.id === 'mcp:cmo').status, 'working')
  db.prepare("UPDATE sessions SET last_event_at = ? WHERE id = 'mcp:cmo'").run(Date.now() - 31 * 60 * 1000)
  assert.equal((await sessions()).find((s) => s.id === 'mcp:cmo').status, 'offline')
  await app.close()
})
