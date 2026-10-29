import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'

async function boot() {
  const app = createApp({ db: openDb(':memory:'), port: 0 })
  const port = await app.listen()
  const call = async (method, path, body, ws) => {
    const headers = { 'content-type': 'application/json', ...(ws ? { 'x-backoffice-workspace': ws } : {}) }
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null }
  }
  return { app, call }
}

test('leads: crear, actualizar, listar y filtrar', async () => {
  const { app, call } = await boot()
  const a = await call('POST', '/api/leads', { name: 'Ana López', company: 'Casa SA', source: 'whatsapp', interest: 'Taller IA', score: 80, value: 8700, agent: 'lead-qualifier' })
  assert.equal(a.status, 201)
  assert.match(a.body.id, /^L-/)
  assert.equal(a.body.stage, 'new')
  assert.equal(a.body.agent, 'lead-qualifier')
  await call('POST', '/api/leads', { name: 'Beto', source: 'web' })
  const up = await call('PATCH', `/api/leads/${a.body.id}`, { stage: 'qualified', next_contact_at: '2026-10-20', notes: '# Nota' })
  assert.equal(up.body.stage, 'qualified')
  assert.equal(up.body.next_contact_at, '2026-10-20')
  assert.equal((await call('GET', '/api/leads')).body.length, 2)
  assert.equal((await call('GET', '/api/leads?stage=qualified')).body.length, 1)
  assert.equal((await call('GET', '/api/leads?query=casa')).body[0].name, 'Ana López')
  assert.equal((await call('POST', '/api/leads', { name: '' })).status, 400)
  assert.equal((await call('POST', '/api/leads', { name: 'X', score: 101 })).status, 400)
  assert.equal((await call('POST', '/api/leads', { name: 'X', source: 'tv' })).status, 400)
  assert.equal((await call('PATCH', `/api/leads/${a.body.id}`, { next_contact_at: '20/10/2026' })).status, 400)
  await app.close()
})

test('leads: los agentes no marcan won; la persona sí; lost exige motivo', async () => {
  const { app, call } = await boot()
  const l = (await call('POST', '/api/leads', { name: 'Cliente' })).body
  assert.equal((await call('POST', '/api/leads', { name: 'W', stage: 'won' })).status, 400)
  const w = await call('PATCH', `/api/leads/${l.id}`, { stage: 'won' })
  assert.equal(w.status, 400)
  assert.match(w.body.message, /person/)
  assert.equal((await call('PATCH', `/api/leads/${l.id}`, { stage: 'lost' })).status, 400)
  assert.equal((await call('PATCH', `/api/human/leads/${l.id}`, { stage: 'lost' })).status, 400)
  const lost = await call('PATCH', `/api/leads/${l.id}`, { stage: 'lost', lost_reason: 'Sin presupuesto' })
  assert.equal(lost.body.stage, 'lost')
  const won = await call('PATCH', `/api/human/leads/${l.id}`, { stage: 'won', position: 5 })
  assert.equal(won.status, 200)
  assert.equal(won.body.stage, 'won')
  assert.equal(won.body.position, 5)
  const h = await call('POST', '/api/human/leads', { name: 'Directo', stage: 'won' })
  assert.equal(h.status, 201)
  assert.equal((await call('DELETE', `/api/human/leads/${l.id}`)).status, 200)
  assert.equal((await call('PATCH', `/api/leads/${l.id}`, { name: 'x' })).status, 404)
  await app.close()
})

test('leads: aislados por workspace y contados en overview', async () => {
  const { app, call } = await boot()
  await call('POST', '/api/workspaces', { name: 'Otro' })
  const a = (await call('POST', '/api/leads', { name: 'En default' })).body
  assert.equal((await call('GET', '/api/leads', null, 'otro')).body.length, 0)
  assert.equal((await call('PATCH', `/api/leads/${a.id}`, { score: 10 }, 'otro')).status, 404)
  assert.equal((await call('DELETE', `/api/human/leads/${a.id}`, null, 'otro')).status, 404)
  assert.equal((await call('GET', '/api/overview')).body.leads.new, 1)
  assert.equal((await call('GET', '/api/projects')).body.find((p) => p.id === 'default').leads.new, 1)
  await app.close()
})
