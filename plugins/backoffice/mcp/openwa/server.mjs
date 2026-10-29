// Generic MCP wrapper (stdio) over an OpenWA REST API. Works on macOS / Windows / Linux, Node 20+.
// Why a wrapper instead of OpenWA's built-in /mcp? It handles files bigger than OpenWA's 25MB body cap,
// resolves @lid ids to phone numbers, supports several sessions by NAME, and keeps send tools separate
// so every send can sit behind your client's approval prompt.
//
// Config (env vars):
//   OPENWA_URL             default http://localhost:2785
//   OPENWA_API_KEY         the key; or OPENWA_KEY_FILE (path to data/.api-key); or it falls back to
//                          `docker exec <OPENWA_CONTAINER> cat /app/data/.api-key`
//   OPENWA_CONTAINER       default openwa-api
//   OPENWA_DEFAULT_SESSION session name used when a tool call omits `session`
//   OPENWA_FILE_HOST       how the OpenWA container reaches this machine; default host.docker.internal
//                          (use localhost if OpenWA runs natively with npm, no Docker)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const BASE = process.env.OPENWA_URL || 'http://localhost:2785';
const FILE_HOST = process.env.OPENWA_FILE_HOST || 'host.docker.internal';
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip' };

let keyCache;
function apiKey() {
  if (keyCache) return keyCache;
  if (process.env.OPENWA_API_KEY) return (keyCache = process.env.OPENWA_API_KEY.trim());
  if (process.env.OPENWA_KEY_FILE) return (keyCache = readFileSync(process.env.OPENWA_KEY_FILE, 'utf8').trim());
  return (keyCache = execFileSync('docker', ['exec', process.env.OPENWA_CONTAINER || 'openwa-api', 'cat', '/app/data/.api-key'], { encoding: 'utf8' }).trim());
}
async function api(method, path, body, timeoutMs = 45000) {
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => { throw new Error(e.name === 'TimeoutError' ? `OpenWA call timed out after ${timeoutMs / 1000}s (engine may be wedged: use wa_restart_session)` : e.message); });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const ok = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message || e) }] });
const wrap = (fn) => async (a) => { try { return ok(await fn(a)); } catch (e) { return fail(e); } };

// session name or id -> {id,name}
async function session(nameOrId) {
  const list = await api('GET', '/sessions', undefined, 15000);
  const want = nameOrId || process.env.OPENWA_DEFAULT_SESSION;
  if (want) {
    const s = list.find((x) => x.name === want || x.id === want);
    if (!s) throw new Error(`No session "${want}". Known: ${list.map((x) => x.name).join(', ')}`);
    return s;
  }
  const ready = list.filter((x) => x.status === 'ready');
  if (ready.length === 1) return ready[0];
  throw new Error(`Pass \`session\` (name). Known: ${list.map((x) => `${x.name}=${x.status}`).join(', ')}`);
}
// whatsapp-web.js sends fail on some builds when addressed by @lid; use phone@c.us.
async function resolveTarget(sid, id) {
  if (!id.endsWith('@lid')) return { id, phone: id.endsWith('@c.us') ? id.split('@')[0] : null };
  const r = await api('GET', `/sessions/${sid}/contacts/${encodeURIComponent(id)}/phone`, undefined, 20000);
  if (!r.phone) throw new Error(`Could not resolve ${id} to a phone number; not sending.`);
  return { id: `${r.phone}@c.us`, phone: r.phone };
}

const server = new McpServer({ name: 'openwa', version: '1.0.0' });
const sess = z.string().optional().describe('Session name (see wa_sessions). Optional when only one session is ready or OPENWA_DEFAULT_SESSION is set.');
const chatId = z.string().describe('Chat id from wa_recent_chats / wa_find_contact (…@c.us, …@lid or …@g.us). A bare phone number with country code also works.');
const norm = (c) => (/^\d{8,15}$/.test(c) ? `${c}@c.us` : c);

server.registerTool('wa_sessions', { description: 'List WhatsApp sessions (name, status, phone). Status must be "ready" to use one.', inputSchema: {} },
  wrap(async () => (await api('GET', '/sessions', undefined, 15000)).map((s) => ({ name: s.name, status: s.status, phone: s.phone, pushName: s.pushName }))));

server.registerTool('wa_recent_chats', { description: 'Most recent chats, newest first (name, id, last message, unread). The first is the latest conversation.', inputSchema: { session: sess, limit: z.number().int().min(1).max(100).default(15) } },
  wrap(async ({ session: n, limit }) => api('GET', `/sessions/${(await session(n)).id}/chats?limit=${limit}`)));

server.registerTool('wa_find_contact', { description: 'Find chats by name (case-insensitive substring) among the most recent 300 chats; resolves the phone for @lid chats. For a full local book, build one from /chats + /contacts/:id/phone (throttle to <80 calls/min).', inputSchema: { session: sess, query: z.string().min(2) } },
  wrap(async ({ session: n, query }) => {
    const s = await session(n);
    const chats = await api('GET', `/sessions/${s.id}/chats?limit=300`, undefined, 90000);
    const hits = chats.filter((c) => (c.name || '').toLowerCase().includes(query.toLowerCase()) || c.id.includes(query)).slice(0, 15);
    for (const h of hits) if (h.id.endsWith('@lid')) { try { h.phone = (await api('GET', `/sessions/${s.id}/contacts/${encodeURIComponent(h.id)}/phone`, undefined, 15000)).phone; } catch { /* leave unresolved */ } }
    return { session: s.name, matches: hits.map((h) => ({ id: h.id, name: h.name, isGroup: h.isGroup, phone: h.phone ?? null })) };
  }));

server.registerTool('wa_read_messages', { description: 'Read message history of one chat.', inputSchema: { session: sess, chatId, limit: z.number().int().min(1).max(100).default(20) } },
  wrap(async ({ session: n, chatId: c, limit }) => api('GET', `/sessions/${(await session(n)).id}/messages/${encodeURIComponent(norm(c))}/history?limit=${limit}`)));

server.registerTool('wa_send_text', { description: 'SEND a text message. Only after the human approved the exact recipient and text.', inputSchema: { session: sess, chatId, text: z.string().min(1) } },
  wrap(async ({ session: n, chatId: c, text }) => { const s = await session(n); const t = await resolveTarget(s.id, norm(c)); const r = await api('POST', `/sessions/${s.id}/messages/send-text`, { chatId: t.id, text }); return { from: s.name, to: c, phone: t.phone, sentAt: new Date().toISOString(), result: r }; }));

server.registerTool('wa_send_file', {
  description: 'SEND a local file (video/image/document/audio). Only after the human approved the exact recipient and file. Large files are served from a loopback-only temporary server. kind=auto picks by extension.',
  inputSchema: { session: sess, chatId, path: z.string().describe('Absolute local path'), kind: z.enum(['auto', 'video', 'image', 'document', 'audio']).default('auto'), caption: z.string().optional() },
}, wrap(async ({ session: n, chatId: c, path, kind, caption }) => {
  const s = await session(n); const t = await resolveTarget(s.id, norm(c));
  const size = statSync(path).size, name = basename(path), mimetype = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  const k = kind !== 'auto' ? kind : mimetype.startsWith('video/') ? 'video' : mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('audio/') ? 'audio' : 'document';
  const endpoint = { video: 'send-video', image: 'send-image', document: 'send-document', audio: 'send-audio' }[k];
  const body = { chatId: t.id, mimetype, filename: name, ...(caption ? { caption } : {}) };
  let srv;
  if (size <= 15 * 1024 * 1024) body.base64 = readFileSync(path).toString('base64'); // OpenWA body cap is 25MB (BODY_SIZE_LIMIT)
  else {
    srv = createServer((req, res) => { if (req.url !== `/${encodeURIComponent(name)}`) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': mimetype, 'Content-Length': size }); createReadStream(path).pipe(res); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r)); // loopback only; never 0.0.0.0
    body.url = `http://${FILE_HOST}:${srv.address().port}/${encodeURIComponent(name)}`;
  }
  try { const sentAt = new Date().toISOString(); const r = await api('POST', `/sessions/${s.id}/messages/${endpoint}`, body, 280000); return { from: s.name, to: c, phone: t.phone, sentAt, as: k, file: name, bytes: size, result: r }; }
  finally { srv?.close(); }
}));

server.registerTool('wa_restart_session', { description: 'Stop + start a session to unwedge the engine (calls hang or time out). May need a QR scan if the login expired.', inputSchema: { session: sess } },
  wrap(async ({ session: n }) => { const s = await session(n); await api('POST', `/sessions/${s.id}/stop`, undefined, 60000).catch(() => {}); await new Promise((r) => setTimeout(r, 3000)); await api('POST', `/sessions/${s.id}/start`, undefined, 90000);
    for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 6000)); const x = await api('GET', `/sessions/${s.id}`, undefined, 10000); if (x.status === 'ready' || x.status === 'qr_ready') return { session: s.name, status: x.status }; }
    return { session: s.name, status: 'still starting' }; }));

await server.connect(new StdioServerTransport());
