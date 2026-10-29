// WhatsApp through open-wa (`npx @open-wa/wa-automate`, EASY API). Unofficial WhatsApp Web automation, local only.
// Mode: read + send only with the person's click. Agents create drafts; only /api/human/... sends.
//
// Config (env vars win, then ~/.agentos/.env; re-read on every use, no restart):
//   BACKOFFICE_WA_URL            default http://127.0.0.1:8002
//   BACKOFFICE_WA_API_KEY        sent to open-wa as header `X-API-Key`
//   BACKOFFICE_WA_WEBHOOK_SECRET required in `POST /api/whatsapp/webhook?secret=...`
// Secrets are never logged or returned by any endpoint.
//
// open-wa shapes used (EASY API; see https://docs.openwa.dev/pages/Tutorials/Easy%20API.html):
// Verified against open-wa v5.6.2 (see docs/WHATSAPP-OPENWA.md):
//   POST <url>/api/sendText            header X-API-Key, body {"args":{"to":"<chatId>","content":"<text>"}} -> {"success":true,"data":"<messageId>"}
//   GET  <url>/api/getConnectionState  header X-API-Key                                                    -> {"success":true,"data":"CONNECTED"}
//   Incoming messages arrive through scripts/whatsapp-bridge.mjs (open-wa's CLI no longer posts webhooks).
//   webhook (open-wa -> us)        {"event":"onMessage","data":{id,from,to,chatId,body,type,t,sender,isGroupMsg,fromMe,...}}
import { readFileSync } from 'node:fs'
import { backofficeHome } from './paths.mjs'
import { join } from 'node:path'
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import { parseEnv } from './auth.mjs'
import { withLegacyEnv } from './env.mjs'
import { AppError } from './store.mjs'
import { loadWaLimits, checkSend, isBlockedChat } from './whatsapp-limits.mjs'

export const WA_DEFAULT_URL = 'http://127.0.0.1:8002'
const SETTING = 'whatsapp.workspace'
const sha = (s) => createHash('sha256').update(s).digest()
const sameSecret = (a, b) => timingSafeEqual(sha(String(a)), sha(String(b)))
const digitsOf = (chatId) => String(chatId ?? '').split('@')[0].replace(/\D/g, '')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const bad = (m) => new AppError('bad_request', m)

export function createWhatsApp({ db, store, env = process.env, home = backofficeHome({ env }), fetchFn = (...a) => fetch(...a) }) {
  const limits = () => loadWaLimits({ env, home })

  function config() {
    let file = {}
    try { file = withLegacyEnv(parseEnv(readFileSync(join(home, '.env'), 'utf8'))) } catch { /* no file */ }
    const e = withLegacyEnv({ ...env }) // rename compat: AGENTOS_WA_* still counts
    const pick = (k) => [e[k], file[k]].find((v) => typeof v === 'string' && v !== '')
    let url = pick('BACKOFFICE_WA_URL') ?? WA_DEFAULT_URL
    url = url.replace(/\/+$/, '')
    return { url, apiKey: pick('BACKOFFICE_WA_API_KEY') ?? null, secret: pick('BACKOFFICE_WA_WEBHOOK_SECRET') ?? null }
  }
  const owaHeaders = (c) => ({ 'content-type': 'application/json', ...(c.apiKey ? { 'X-API-Key': c.apiKey } : {}) })

  const workspace = () => {
    const id = store.getSetting(SETTING)
    try { return id ? store.needWorkspace(String(id)).id : store.DEFAULT_WS } catch { return store.DEFAULT_WS }
  }
  function setWorkspace(id) {
    if (typeof id !== 'string' || !id) throw bad('workspace es obligatorio')
    const w = store.needWorkspace(id)
    store.setSetting(SETTING, w.id)
    return { workspace: w.id }
  }

  // ---------- counters ----------
  const sentSince = (ms) => db.prepare("SELECT COUNT(*) AS n FROM wa_drafts WHERE status = 'sent' AND sent_at >= ?").get(Date.now() - ms).n
  const sentLastHour = () => sentSince(3600_000)
  const sentLastDay = () => sentSince(24 * 3600_000)

  // ---------- connection status (cached 10 s) ----------
  let cache = { at: 0, key: '', connected: false }
  async function ping(c) {
    const key = `${c.url}|${!!c.apiKey}`
    if (cache.key === key && Date.now() - cache.at < 10_000) return cache.connected
    let connected = false
    try {
      const r = await fetchFn(`${c.url}/api/getConnectionState`, { method: 'GET', headers: owaHeaders(c), signal: AbortSignal.timeout(3000) })
      const j = await r.json().catch(() => null)
      connected = r.ok && /^CONNECTED$/i.test(String(j?.data ?? j?.response ?? j?.state ?? ''))
    } catch { connected = false }
    cache = { at: Date.now(), key, connected }
    return connected
  }
  async function status() {
    const c = config()
    const configured = !!c.secret
    return { configured, connected: configured ? await ping(c) : false, workspace: workspace(), limits: limits(), sent_last_hour: sentLastHour() }
  }

  // ---------- leads ----------
  function findLead(ws, phone) {
    if (!phone) return null
    const needle = phone.length >= 10 ? phone.slice(-10) : phone
    for (const l of db.prepare('SELECT * FROM leads WHERE workspace_id = ? AND contact IS NOT NULL ORDER BY created_at').all(ws)) {
      if (String(l.contact).replace(/\D/g, '').includes(needle)) return l
    }
    return null
  }

  // ---------- webhook ----------
  const msgId = (d) => (typeof d?.id === 'string' ? d.id : typeof d?.id?._serialized === 'string' ? d.id._serialized : null)
  const str = (v) => (typeof v === 'string' ? v : null)

  /** Verifies the secret (constant time). */
  function secretOk(given) {
    const c = config()
    return !!c.secret && typeof given === 'string' && given !== '' && sameSecret(given, c.secret)
  }

  /** Processes an open-wa webhook body. Never throws on odd payloads; returns { ok, stored, reason }. */
  function ingest(body) {
    const event = str(body?.event)
    const d = body?.data
    if (!['onMessage', 'onAnyMessage'].includes(event) || !d || typeof d !== 'object') return { ok: true, stored: false, reason: 'ignored_event' }
    const id = msgId(d)
    const fromMe = d.fromMe === true
    const chatId = str(d.chatId) || str(fromMe ? d.to : d.from) || str(d.from)
    if (!id || !chatId) return { ok: true, stored: false, reason: 'invalid' }
    if (d.isGroupMsg === true || isBlockedChat(chatId)) return { ok: true, stored: false, reason: 'group_or_broadcast' }
    const type = str(d.type) ?? 'chat'
    let text
    if (type === 'chat') text = str(d.body)
    else if (type === 'image') text = str(d.caption) ?? '' // `body` of an image is base64: never stored
    else return { ok: true, stored: false, reason: 'unsupported_type' }
    if (text === null) return { ok: true, stored: false, reason: 'invalid' }
    if (type === 'chat' && !text.trim()) return { ok: true, stored: false, reason: 'empty' }
    if (db.prepare('SELECT 1 FROM wa_messages WHERE id = ?').get(id)) return { ok: true, stored: false, reason: 'duplicate' }
    const body2 = (type === 'image' && !text ? '[imagen]' : text).slice(0, 4000)
    const phone = digitsOf(chatId)
    const t = Number(d.t)
    const ts = Number.isFinite(t) && t > 0 ? Math.round(t * 1000) : Date.now()
    const ws = workspace()
    const pushname = (str(d.sender?.pushname) || str(d.notifyName) || str(d.sender?.name) || '').trim()
    let lead = findLead(ws, phone)
    if (!fromMe) {
      const interest = body2.slice(0, 120)
      if (!lead) {
        lead = store.createLead({ name: (pushname || phone).slice(0, 120), source: 'whatsapp', stage: 'new', contact: `WhatsApp +${phone}`, interest, next_contact_at: today(), agent: 'whatsapp' }, ws)
      } else if (lead.next_contact_at !== today()) {
        lead = store.updateLead(lead.id, { next_contact_at: today() }, ws, true)
      }
    }
    db.prepare('INSERT OR IGNORE INTO wa_messages (id, workspace_id, chat_id, phone, name, direction, body, type, ts, lead_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      id, ws, chatId, phone, fromMe ? null : pushname || null, fromMe ? 'out' : 'in', body2, type, ts, lead?.id ?? null, Date.now())
    const row = db.prepare('SELECT * FROM wa_messages WHERE id = ?').get(id)
    store.bus.emit('change', { type: 'wa_message', data: row, workspace_id: ws })
    return { ok: true, stored: true }
  }

  // ---------- reads ----------
  function chats(ws, { onlyUnanswered = false, limit = 100, recent = 0 } = {}) {
    const ids = db.prepare('SELECT chat_id, MAX(ts) AS last_ts FROM wa_messages WHERE workspace_id = ? GROUP BY chat_id ORDER BY last_ts DESC').all(ws)
    const out = []
    for (const { chat_id } of ids) {
      const last = db.prepare('SELECT * FROM wa_messages WHERE workspace_id = ? AND chat_id = ? ORDER BY ts DESC, created_at DESC LIMIT 1').get(ws, chat_id)
      const lastOut = db.prepare("SELECT MAX(ts) AS m FROM wa_messages WHERE workspace_id = ? AND chat_id = ? AND direction = 'out'").get(ws, chat_id).m ?? 0
      const unanswered = db.prepare("SELECT COUNT(*) AS n FROM wa_messages WHERE workspace_id = ? AND chat_id = ? AND direction = 'in' AND ts > ?").get(ws, chat_id, lastOut).n
      if (onlyUnanswered && !unanswered) continue
      const info = db.prepare("SELECT name, lead_id FROM wa_messages WHERE workspace_id = ? AND chat_id = ? AND direction = 'in' ORDER BY ts DESC LIMIT 1").get(ws, chat_id)
      const lead_id = db.prepare('SELECT lead_id FROM wa_messages WHERE workspace_id = ? AND chat_id = ? AND lead_id IS NOT NULL ORDER BY ts DESC LIMIT 1').get(ws, chat_id)?.lead_id ?? null
      const row = { chat_id, phone: last.phone, name: info?.name ?? null, lead_id, last_message: { direction: last.direction, body: last.body, type: last.type, ts: last.ts }, unanswered, pending_drafts: db.prepare("SELECT COUNT(*) AS n FROM wa_drafts WHERE workspace_id = ? AND chat_id = ? AND status = 'draft'").get(ws, chat_id).n }
      if (recent > 0) row.recent_messages = db.prepare('SELECT direction, body, ts FROM (SELECT * FROM wa_messages WHERE workspace_id = ? AND chat_id = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC').all(ws, chat_id, recent)
      out.push(row)
      if (out.length >= limit) break
    }
    return out
  }
  const messages = (ws, chatId, limit = 200) => {
    if (!chatId) throw bad('chat_id es obligatorio')
    return db.prepare('SELECT * FROM (SELECT * FROM wa_messages WHERE workspace_id = ? AND chat_id = ? ORDER BY ts DESC, created_at DESC LIMIT ?) ORDER BY ts ASC, created_at ASC').all(ws, chatId, Math.min(Math.max(Number(limit) || 200, 1), 500))
  }
  const drafts = (ws, { status, chat_id } = {}) => {
    if (status && !['draft', 'sent', 'discarded', 'failed'].includes(status)) throw bad('status inválido; usa: draft, sent, discarded, failed')
    let sql = 'SELECT * FROM wa_drafts WHERE workspace_id = ?'
    const args = [ws]
    if (status) { sql += ' AND status = ?'; args.push(status) }
    if (chat_id) { sql += ' AND chat_id = ?'; args.push(chat_id) }
    return db.prepare(sql + ' ORDER BY created_at DESC LIMIT 300').all(...args)
  }
  const hasInbound = (ws, chatId) => !!db.prepare("SELECT 1 FROM wa_messages WHERE workspace_id = ? AND chat_id = ? AND direction = 'in' LIMIT 1").get(ws, chatId)
  const draftIn = (id, ws) => {
    const d = db.prepare('SELECT * FROM wa_drafts WHERE id = ?').get(id)
    if (!d || (ws && d.workspace_id !== ws)) throw new AppError('not_found', `No existe el borrador ${id}`, 404)
    return d
  }
  const emitDraft = (id) => { const d = db.prepare('SELECT * FROM wa_drafts WHERE id = ?').get(id); store.bus.emit('change', { type: 'wa_draft', data: d, workspace_id: d.workspace_id }); return d }

  // ---------- drafts ----------
  /** Agents (MCP) and the person create drafts. Needs an existing chat with at least one inbound message. */
  function createDraft(ws, { chat_id, phone, text, lead_id, created_by } = {}) {
    store.needWorkspace(ws)
    let chatId = typeof chat_id === 'string' && chat_id ? chat_id : null
    if (!chatId && phone) {
      const dg = String(phone).replace(/\D/g, '')
      if (!dg) throw bad('phone inválido')
      chatId = db.prepare("SELECT chat_id FROM wa_messages WHERE workspace_id = ? AND direction = 'in' AND phone = ? ORDER BY ts DESC LIMIT 1").get(ws, dg)?.chat_id
        ?? db.prepare("SELECT chat_id FROM wa_messages WHERE workspace_id = ? AND direction = 'in' AND phone LIKE ? ORDER BY ts DESC LIMIT 1").get(ws, `%${dg.slice(-10)}`)?.chat_id ?? null
    }
    if (!chatId) throw bad('Indica chat_id o un phone de un chat que ya te escribió.')
    const lim = limits()
    if (typeof text !== 'string' || !text.trim()) throw bad('text es obligatorio')
    if (text.length > lim.max_text_length) throw bad(`text admite hasta ${lim.max_text_length} caracteres`)
    if (isBlockedChat(chatId)) throw bad('No se redactan mensajes para grupos, difusiones ni estados.')
    if (!hasInbound(ws, chatId)) throw bad('Sólo se puede redactar para chats que ya escribieron (sin mensajes en frío).')
    const lid = (typeof lead_id === 'string' && lead_id) || db.prepare('SELECT lead_id FROM wa_messages WHERE workspace_id = ? AND chat_id = ? AND lead_id IS NOT NULL ORDER BY ts DESC LIMIT 1').get(ws, chatId)?.lead_id || null
    const id = `D-${randomUUID().slice(0, 8)}`
    db.prepare('INSERT INTO wa_drafts (id, workspace_id, chat_id, phone, lead_id, text, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, ws, chatId, digitsOf(chatId), lid, text, 'draft', typeof created_by === 'string' ? created_by.slice(0, 60) : 'agent', Date.now())
    return emitDraft(id)
  }
  function editDraft(id, ws, text) {
    const d = draftIn(id, ws)
    if (!['draft', 'failed'].includes(d.status)) throw bad('Ese borrador ya no se puede editar.')
    const lim = limits()
    if (typeof text !== 'string' || !text.trim()) throw bad('text es obligatorio')
    if (text.length > lim.max_text_length) throw bad(`text admite hasta ${lim.max_text_length} caracteres`)
    db.prepare("UPDATE wa_drafts SET text = ?, status = 'draft', error = NULL WHERE id = ?").run(text, id)
    return emitDraft(id)
  }
  function discardDraft(id, ws) {
    const d = draftIn(id, ws)
    if (!['draft', 'failed'].includes(d.status)) throw bad('Ese borrador ya no se puede descartar.')
    db.prepare("UPDATE wa_drafts SET status = 'discarded' WHERE id = ?").run(id)
    return emitDraft(id)
  }

  const sending = new Set()
  /** Human click only. Guardrails first (nothing is marked failed when blocked by a guardrail), then open-wa. */
  async function sendDraft(id, ws, text) {
    let d = draftIn(id, ws)
    if (!['draft', 'failed'].includes(d.status)) throw new AppError('bad_state', 'Ese borrador ya se envió o se descartó.', 409)
    if (sending.has(id)) throw new AppError('in_flight', 'Ese borrador ya se está enviando.', 409)
    const finalText = typeof text === 'string' ? text : d.text
    const block = checkSend({ limits: limits(), text: finalText, chatId: d.chat_id, hasInbound: hasInbound(d.workspace_id, d.chat_id), sentLastHour: sentLastHour(), sentLastDay: sentLastDay() })
    if (block) throw new AppError(block.code, block.message, block.http)
    const c = config()
    if (!c.secret) throw new AppError('not_configured', 'WhatsApp no está configurado (falta BACKOFFICE_WA_WEBHOOK_SECRET).', 409)
    sending.add(id)
    try {
      db.prepare('UPDATE wa_drafts SET text = ? WHERE id = ?').run(finalText, id)
      let sentId = null
      let error = null
      try {
        const r = await fetchFn(`${c.url}/api/sendText`, { method: 'POST', headers: owaHeaders(c), body: JSON.stringify({ args: { to: d.chat_id, content: finalText } }), signal: AbortSignal.timeout(20_000) })
        const j = await r.json().catch(() => null)
        if (!r.ok || j?.success === false) error = `open-wa respondió ${r.status}${typeof j?.error === 'string' ? `: ${j.error.slice(0, 200)}` : ''}`
        else {
          const resp = j?.data ?? j?.response
          sentId = typeof resp === 'string' && resp ? resp : typeof resp?.id === 'string' ? resp.id : typeof resp?._serialized === 'string' ? resp._serialized : null
          if (j?.success !== true && !sentId) error = 'open-wa no confirmó el envío'
        }
      } catch (e) { error = `No se pudo hablar con open-wa (${e?.name === 'TimeoutError' ? 'tiempo agotado' : 'conexión rechazada'}).` }
      if (error) {
        db.prepare("UPDATE wa_drafts SET status = 'failed', error = ? WHERE id = ?").run(error, id)
        return emitDraft(id)
      }
      const mid = sentId ?? `out-${randomUUID()}`
      const ts = Date.now()
      db.prepare("INSERT OR IGNORE INTO wa_messages (id, workspace_id, chat_id, phone, name, direction, body, type, ts, lead_id, created_at) VALUES (?,?,?,?,NULL,'out',?,'chat',?,?,?)").run(mid, d.workspace_id, d.chat_id, d.phone, finalText, ts, d.lead_id, ts)
      db.prepare("UPDATE wa_drafts SET status = 'sent', error = NULL, sent_at = ?, sent_message_id = ? WHERE id = ?").run(ts, mid, id)
      const row = db.prepare('SELECT * FROM wa_messages WHERE id = ?').get(mid)
      if (row) store.bus.emit('change', { type: 'wa_message', data: row, workspace_id: d.workspace_id })
      return emitDraft(id)
    } finally { sending.delete(id) }
  }

  return { config, workspace, setWorkspace, status, secretOk, ingest, chats, messages, drafts, createDraft, editDraft, discardDraft, sendDraft }
}
