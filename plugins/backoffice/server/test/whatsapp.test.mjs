import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'

const SECRET = 'whsec-test-123'
const KEY = 'owa-key-xyz'

// Tiny fake open-wa: records requests, answers sendText / getConnectionState.
async function fakeOpenWa({ failSend = false } = {}) {
  const calls = []
  const srv = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/getConnectionState') return res.end(JSON.stringify({ success: true, data: 'CONNECTED' }))
      if (req.url === '/api/sendText') {
        if (failSend) { res.statusCode = 500; return res.end(JSON.stringify({ success: false, error: 'boom' })) }
        return res.end(JSON.stringify({ success: true, data: `true_5218111111111@c.us_OUT${calls.length}` }))
      }
      res.statusCode = 404
      res.end('{}')
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { calls, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.close(r); srv.closeAllConnections?.() }) }
}

async function boot({ owaUrl = 'http://127.0.0.1:9', limits = null, secret = SECRET } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'backoffice-wa-'))
  if (limits) writeFileSync(join(home, 'whatsapp.json'), JSON.stringify(limits))
  const env = { BACKOFFICE_HOME: home, BACKOFFICE_WA_URL: owaUrl, BACKOFFICE_WA_API_KEY: KEY, ...(secret ? { BACKOFFICE_WA_WEBHOOK_SECRET: secret } : {}) }
  const app = createApp({ db: openDb(':memory:'), port: 0, whatsapp: { env, home } })
  const port = await app.listen()
  const call = async (method, path, body, ws) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', ...(ws ? { 'x-backoffice-workspace': ws } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null, text }
  }
  const hook = (data, event = 'onMessage', secretQ = SECRET) => call('POST', `/api/whatsapp/webhook${secretQ === null ? '' : `?secret=${secretQ}`}`, { event, data })
  return { app, call, hook, env }
}
let n = 0
const msg = (o = {}) => ({ id: `false_5218112345678@c.us_${++n}`, from: '5218112345678@c.us', chatId: '5218112345678@c.us', to: '5218100000000@c.us', body: 'Hola, me interesa el taller', type: 'chat', t: 1760000000 + n, sender: { pushname: 'Ana Pérez' }, isGroupMsg: false, fromMe: false, ...o })

test('whatsapp: webhook exige secreto (falta / mal / bien) y no pide sesión', async () => {
  const { app, hook } = await boot()
  assert.equal((await hook(msg(), 'onMessage', null)).status, 401)
  assert.equal((await hook(msg(), 'onMessage', 'nope')).status, 401)
  assert.equal((await hook(msg(), 'onMessage', SECRET)).status, 200)
  await app.close()
  const b = await boot({ secret: null })
  assert.equal((await b.hook(msg())).status, 401) // sin secreto configurado nada entra
  await b.app.close()
})

test('whatsapp: idempotente, ignora grupos/otros eventos, crea y reutiliza lead por teléfono', async () => {
  const { app, hook, call } = await boot()
  const m = msg()
  assert.equal((await hook(m)).body.stored, true)
  assert.equal((await hook(m)).body.stored, false)
  assert.equal((await hook(msg({ isGroupMsg: true, chatId: '1203@g.us', from: '1203@g.us' }))).body.stored, false)
  assert.equal((await hook(msg({ chatId: 'status@broadcast', from: 'status@broadcast' }))).body.stored, false)
  assert.equal((await hook(m, 'onAck')).body.stored, false)
  assert.equal((await hook(msg({ type: 'ptt' }))).body.stored, false)
  const img = await hook(msg({ type: 'image', body: 'BASE64DATA', caption: 'foto del local' }))
  assert.equal(img.body.stored, true)
  const leads = (await call('GET', '/api/leads')).body
  assert.equal(leads.length, 1)
  assert.equal(leads[0].name, 'Ana Pérez')
  assert.equal(leads[0].source, 'whatsapp')
  assert.equal(leads[0].stage, 'new')
  assert.equal(leads[0].contact, 'WhatsApp +5218112345678')
  assert.equal(leads[0].interest, 'Hola, me interesa el taller')
  assert.match(leads[0].next_contact_at, /^\d{4}-\d{2}-\d{2}$/)
  const chats = (await call('GET', '/api/whatsapp/chats')).body
  assert.equal(chats.length, 1)
  assert.equal(chats[0].unanswered, 2)
  assert.equal(chats[0].lead_id, leads[0].id)
  const ms = (await call('GET', `/api/whatsapp/messages?chat_id=${encodeURIComponent('5218112345678@c.us')}`)).body
  assert.equal(ms.length, 2)
  assert.ok(!JSON.stringify(ms).includes('BASE64DATA'))
  // un lead existente con ese teléfono se reutiliza
  await call('POST', '/api/leads', { name: 'Beto', contact: '+52 1 81 9999 0000' })
  await hook(msg({ chatId: '5218199990000@c.us', from: '5218199990000@c.us', sender: { pushname: 'Otro nombre' } }))
  assert.equal((await call('GET', '/api/leads')).body.length, 2)
  // mensaje enviado desde el celular = out
  await hook(msg({ fromMe: true, from: '5218100000000@c.us', to: '5218112345678@c.us', chatId: '5218112345678@c.us', body: 'Claro, te cuento' }))
  assert.equal((await call('GET', '/api/whatsapp/chats')).body.find((c) => c.phone === '5218112345678').unanswered, 0)
  await app.close()
})

test('whatsapp: workspace configurable recibe los leads', async () => {
  const { app, hook, call } = await boot()
  const w = (await call('POST', '/api/workspaces', { name: 'Cliente Uno' })).body
  assert.equal((await call('PUT', '/api/human/whatsapp/settings', { workspace: 'no-existe' })).status, 404)
  assert.equal((await call('PUT', '/api/human/whatsapp/settings', { workspace: w.id })).status, 200)
  await hook(msg())
  assert.equal((await call('GET', '/api/leads', undefined, w.id)).body.length, 1)
  assert.equal((await call('GET', '/api/leads', undefined, 'default')).body.length, 0)
  assert.equal((await call('GET', '/api/whatsapp/status')).body.workspace, w.id)
  await app.close()
})

test('whatsapp: borrador y envío con guardrails (sin inbound, límite, texto largo)', async () => {
  const owa = await fakeOpenWa()
  const { app, hook, call } = await boot({ owaUrl: owa.url, limits: { max_per_hour: 2 } })
  const chat = '5218112345678@c.us'
  // sin inbound: no hay borrador ni envío
  assert.equal((await call('POST', '/api/whatsapp/drafts', { chat_id: chat, text: 'Hola' })).status, 400)
  await hook(msg())
  const d = await call('POST', '/api/whatsapp/drafts', { phone: '+52 1 81 1234 5678', text: 'Hola Ana' })
  assert.equal(d.status, 201)
  assert.match(d.body.id, /^D-/)
  assert.equal(d.body.status, 'draft')
  assert.equal(d.body.chat_id, chat)
  assert.equal((await call('POST', '/api/whatsapp/drafts', { chat_id: chat, text: 'x'.repeat(1501) })).status, 400)
  // un borrador forzado a un chat sin inbound se bloquea al enviar
  const e = (await call('PATCH', `/api/human/whatsapp/drafts/${d.body.id}`, { text: 'Hola Ana, ¿cómo estás?' })).body
  assert.equal(e.text, 'Hola Ana, ¿cómo estás?')
  const sent = await call('POST', `/api/human/whatsapp/drafts/${d.body.id}/send`, {})
  assert.equal(sent.status, 200)
  assert.equal(sent.body.status, 'sent')
  const req = owa.calls.find((c) => c.url === '/api/sendText')
  assert.equal(req.method, 'POST')
  assert.equal(req.headers['x-api-key'], KEY)
  assert.deepEqual(req.body, { args: { to: chat, content: 'Hola Ana, ¿cómo estás?' } })
  assert.match(sent.body.sent_message_id, /^true_/)
  const msgs = (await call('GET', `/api/whatsapp/messages?chat_id=${encodeURIComponent(chat)}`)).body
  assert.equal(msgs.at(-1).direction, 'out')
  assert.equal((await call('POST', `/api/human/whatsapp/drafts/${d.body.id}/send`, {})).status, 409) // ya enviado
  // límite por hora = 2
  const d2 = (await call('POST', '/api/whatsapp/drafts', { chat_id: chat, text: 'otro' })).body
  assert.equal((await call('POST', `/api/human/whatsapp/drafts/${d2.id}/send`, {})).status, 200)
  const d3 = (await call('POST', '/api/whatsapp/drafts', { chat_id: chat, text: 'tercero' })).body
  const lim = await call('POST', `/api/human/whatsapp/drafts/${d3.id}/send`, {})
  assert.equal(lim.status, 429)
  assert.equal(owa.calls.filter((c) => c.url === '/api/sendText').length, 2)
  assert.equal((await call('GET', '/api/whatsapp/status')).body.sent_last_hour, 2)
  assert.equal((await call('DELETE', `/api/human/whatsapp/drafts/${d3.id}`)).body.status, 'discarded')
  assert.equal((await call('GET', '/api/whatsapp/drafts?status=discarded')).body.length, 1)
  await app.close(); await owa.close()
})

test('whatsapp: envío bloqueado en chat sin inbound (borrador sembrado en la base)', async () => {
  const owa = await fakeOpenWa()
  const { app, call } = await boot({ owaUrl: owa.url })
  app.store.db.prepare("INSERT INTO wa_drafts (id, workspace_id, chat_id, phone, text, status, created_at) VALUES ('D-cold','default','5218155550000@c.us','5218155550000','Hola','draft',?)").run(Date.now())
  const r = await call('POST', '/api/human/whatsapp/drafts/D-cold/send', {})
  assert.equal(r.status, 409)
  assert.equal(owa.calls.filter((c) => c.url === '/api/sendText').length, 0)
  await app.close(); await owa.close()
})

test('whatsapp: envío fallido deja el borrador en failed con error', async () => {
  const owa = await fakeOpenWa({ failSend: true })
  const { app, hook, call } = await boot({ owaUrl: owa.url })
  await hook(msg())
  const d = (await call('POST', '/api/whatsapp/drafts', { chat_id: '5218112345678@c.us', text: 'Hola' })).body
  const r = await call('POST', `/api/human/whatsapp/drafts/${d.id}/send`, {})
  assert.equal(r.body.status, 'failed')
  assert.match(r.body.error, /500/)
  assert.ok(!r.text.includes(KEY))
  assert.equal((await call('GET', '/api/whatsapp/status')).body.sent_last_hour, 0)
  await app.close(); await owa.close()
})

test('whatsapp: status ping a open-wa y los secretos nunca salen en la API', async () => {
  const owa = await fakeOpenWa()
  const { app, hook, call } = await boot({ owaUrl: owa.url })
  await hook(msg())
  const d = (await call('POST', '/api/whatsapp/drafts', { chat_id: '5218112345678@c.us', text: 'Hola' })).body
  await call('POST', `/api/human/whatsapp/drafts/${d.id}/send`, {})
  const st = await call('GET', '/api/whatsapp/status')
  assert.equal(st.body.configured, true)
  assert.equal(st.body.connected, true)
  assert.equal(owa.calls.find((c) => c.url === '/api/getConnectionState').headers['x-api-key'], KEY)
  assert.equal(st.body.limits.max_text_length, 1500)
  for (const p of ['/api/whatsapp/status', '/api/whatsapp/chats', '/api/whatsapp/drafts', `/api/whatsapp/messages?chat_id=${encodeURIComponent('5218112345678@c.us')}`, '/api/leads', '/api/overview']) {
    const r = await call('GET', p)
    assert.ok(!r.text.includes(KEY) && !r.text.includes(SECRET), p)
  }
  await app.close(); await owa.close()
})

test('whatsapp: status sin configurar y open-wa caído', async () => {
  const a = await boot({ secret: null })
  const s = (await a.call('GET', '/api/whatsapp/status')).body
  assert.equal(s.configured, false)
  assert.equal(s.connected, false)
  await a.app.close()
  const b = await boot() // puerto 9: nadie escucha
  const s2 = (await b.call('GET', '/api/whatsapp/status')).body
  assert.equal(s2.configured, true)
  assert.equal(s2.connected, false)
  await b.app.close()
})

test('whatsapp: el agente crea borrador por MCP (inbox + draft) y no existe herramienta de envío', async () => {
  const { spawn } = await import('node:child_process')
  const { app, hook } = await boot()
  await hook(msg())
  const port = app.server.address().port
  const child = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname], { env: { ...process.env, BACKOFFICE_PORT: String(port) }, stdio: ['pipe', 'pipe', 'inherit'] })
  let buf = ''; let id = 0; const waiters = new Map()
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(m.id)?.(m) } })
  const rpc = (method, params) => new Promise((resolve) => { const i = ++id; waiters.set(i, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n') })
  const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return { isError: !!r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) } }
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18' })
    assert.ok(!(await rpc('tools/list')).result.tools.some((t) => /send/i.test(t.name) && /whatsapp/.test(t.name)))
    const inbox = await tool('backoffice_whatsapp_inbox', {})
    assert.equal(inbox.data.length, 1)
    assert.equal(inbox.data[0].unanswered, 1)
    assert.ok(inbox.data[0].lead_id)
    const d = await tool('backoffice_whatsapp_draft', { chat_id: inbox.data[0].chat_id, text: 'Hola Ana, con gusto' })
    assert.equal(d.data.status, 'draft')
    assert.match(d.data.note, /web/)
    assert.equal(d.data.lead_id, inbox.data[0].lead_id)
    assert.equal((await tool('backoffice_whatsapp_draft', { chat_id: '5218100000001@c.us', text: 'frío' })).isError, true)
    assert.equal((await tool('backoffice_whatsapp_draft', { chat_id: inbox.data[0].chat_id, text: 'x'.repeat(1600) })).isError, true)
  } finally { child.kill(); await app.close() }
})
