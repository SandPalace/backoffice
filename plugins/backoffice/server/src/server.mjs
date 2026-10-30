import { createServer } from 'node:http'
import { openDb } from './db.mjs'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, statSync, createReadStream } from 'node:fs'
import { join, resolve, sep, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { codexSessions } from './codex-sessions.mjs'
import { createStore, AppError, bucketOf } from './store.mjs'
import { defaultRoot } from './db.mjs'
import { createUploader, contentTypeOf, walkFolder } from './outputs-storage.mjs'
import { createBlobs, BlobError, assertBlobKey as assertKey } from './blobstore.mjs'
import { createFiles, FILES, DEFAULT_LIMITS } from './files.mjs'
import { createTransfer } from './transfer.mjs'
import { pathInside, isMain, backofficeHome, defaultWorkspaceRoot } from './paths.mjs'
import { zipStream } from './zip.mjs'
import { desktopCodeSessions } from './desktop-sessions.mjs'
import { createAgentDefs } from './agent-defs.mjs'
import { createIssues } from './issues.mjs'
import { createCanvas } from './canvas.mjs'
import { createAgile } from './agile.mjs'
import { createWhatsApp } from './whatsapp.mjs'
import { createAuth, loadCredentials, looseFiles, parseCookie, cookieHeader, clearCookieHeader, bearerOk, ensureMcpKey } from './auth.mjs'
import { handle as mcpHandle } from './mcp.mjs'

export const DEFAULT_PORT = Number(process.env.BACKOFFICE_PORT || 4780)
const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

// `extraRoots`: carpetas adicionales desde las que se puede servir un archivo local (además de las raíces de los workspaces).
// `blobs`: blob store local (blobstore.mjs). Por defecto vive en `blobsRoot` (o una carpeta temporal: createApp nunca toca ~/.agentos por su cuenta).
// `limits`: topes de archivos (ver DEFAULT_LIMITS en files.mjs).
export function createApp({ db = openDb(), port = DEFAULT_PORT, extraRoots = [], blobs = null, blobsRoot = null, limits = {}, roster = null, auth: authOpt = false, whatsapp: waOpt = {}, agentDefs: defsOpt = {}, mcpKey = null } = {}) {
  // `mcpKey`: bearer key of the HTTP MCP at /mcp (string or () => string). null = /mcp off (tests that do not need it).
  // `auth`: false (off), true (credentials from env/.env/config.json) or { credentials: () => ({ user, password }) | null } (tests).
  const store = createStore(db, { roster })
  const wa = createWhatsApp({ db, store, ...waOpt })
  const defs = createAgentDefs(defsOpt)
  const issues = createIssues(db)
  const auth = createAuth(db, { enabled: !!authOpt, ...(typeof authOpt === 'object' ? authOpt : {}) })
  blobs ??= createBlobs({
    root: blobsRoot ?? mkdtempSync(join(tmpdir(), 'backoffice-store-')),
    typeOf: contentTypeOf,
  })
  const lim = { ...DEFAULT_LIMITS, ...limits }
  const files = createFiles({ store, blobs, limits: lim })
  const canvas = createCanvas({ db, store, blobs, files, limits: lim })
  const agile = createAgile({ db, store })
  let allowedPath = () => true
  const uploader = createUploader({ store, blobs, allowPath: (p) => allowedPath(p) })
  const sse = new Map() // res -> workspace id

  store.bus.on('change', ({ type, data, workspace_id }) => {
    const chunk = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
    for (const [res, ws] of sse) if (workspace_id == null || workspace_id === ws) res.write(chunk)
  })

  // Workspace de una petición: ?workspace= o X-BackOffice-Workspace; X-BackOffice-Cwd (MCP) lo resuelve por carpeta. Sin nada = default.
  // `strict` = la petición lo pidió, así que lo que no pertenezca a ese workspace no existe para ella.
  const wsOf = (req, url) => {
    const explicit = url.searchParams.get('workspace') || req.headers['x-backoffice-workspace'] || null
    if (explicit) return { id: store.needWorkspace(String(explicit)).id, strict: true }
    const cwd = req.headers['x-backoffice-cwd']
    if (cwd) return { id: store.workspaceForCwd(String(cwd)), strict: true }
    return { id: store.DEFAULT_WS, strict: false }
  }

  // ── archivos ──
  const realRoots = () => {
    const out = []
    for (const r of [...store.rootsAllowed(), defaultRoot(), ...extraRoots]) {
      try { out.push(realpathSync(r)) } catch {}
    }
    return out
  }
  const inside = (p, root) => pathInside(p, root)
  allowedPath = (p) => { try { const real = realpathSync(p); return realRoots().some((r) => inside(real, r)) } catch { return false } }
  const transfer = createTransfer({ store, blobs, limits: lim, allowedRoots: realRoots })
  const safeRel = (rel) => {
    if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0') || rel.split('/').some((x) => x === '..' || x === '.' || x === ''))
      throw new AppError('bad_path', 'Ruta relativa inválida (no se permiten .., rutas absolutas ni vacías)', 400)
    return rel
  }
  // Resuelve un archivo local y comprueba (con realpath, así que también enlaces simbólicos) que cae dentro de una raíz permitida.
  function localFile(path, within = null) {
    let real
    try { real = realpathSync(path) } catch { throw new AppError('file_unavailable', 'El archivo ya no existe en disco', 404) }
    if (!realRoots().some((r) => inside(real, r))) throw new AppError('forbidden_path', 'Ese archivo está fuera de las carpetas permitidas', 403)
    if (within) {
      let w
      try { w = realpathSync(within) } catch { throw new AppError('file_unavailable', 'La carpeta ya no existe en disco', 404) }
      if (!inside(real, w)) throw new AppError('forbidden_path', 'El archivo se sale de la carpeta del entregable', 403)
    }
    if (!statSync(real).isFile()) throw new AppError('not_a_file', 'No es un archivo', 400)
    return real
  }
  const cdName = (n) => String(n).replace(/[\r\n"\\]/g, '_')
  function fileHeaders(url, name, type, length) {
    const headers = {
      'content-type': type,
      'cache-control': 'private, max-age=30',
      'x-content-type-options': 'nosniff',
      'content-disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${cdName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    }
    if (length != null) headers['content-length'] = String(length)
    // HTML/SVG servidos desde este origen no deben poder leer la API: se aíslan en un sandbox sin same-origin.
    if (/^(text\/html|image\/svg|application\/xhtml)/i.test(type)) headers['content-security-policy'] = 'sandbox allow-scripts'
    return headers
  }
  async function streamObject(res, url, bucket, key, name, type) {
    const obj = await blobs.get(bucket, key)
    if (!obj) return false
    res.writeHead(200, fileHeaders(url, name, type || obj.contentType || contentTypeOf(name), obj.size))
    await pipeline(obj.stream, res).catch(() => res.destroy())
    return true
  }
  async function serveLocal(res, url, real, name) {
    res.writeHead(200, fileHeaders(url, name, contentTypeOf(name), statSync(real).size))
    await pipeline(createReadStream(real), res).catch(() => res.destroy())
  }
  async function serveOutput(res, url, id, wsx) {
    const o = store.getOutput(id)
    if (!o || (wsx.strict && o.workspace_id !== wsx.id)) throw new AppError('not_found', 'No existe ese entregable', 404)
    if (o.kind === 'link') throw new AppError('not_a_file', 'Un enlace no tiene archivo', 400)
    const file = url.searchParams.get('file')
    const folder = !!o.files || (!o.storage_key && existsDir(o.path))
    if (folder) {
      if (!file) throw new AppError('bad_request', 'Es una carpeta: usa ?file=<ruta relativa> (lista en /api/outputs/:id/files)', 400)
      const rel = safeRel(file)
      const entry = o.files?.files?.find((f) => f.rel === rel)
      if (entry) {
        try { if (await streamObject(res, url, o.bucket, entry.key, basename(rel), entry.content_type)) return } catch (e) { if (res.headersSent) return }
      }
      if (!o.path) throw new AppError('not_found', 'El archivo ya no está en el almacenamiento', 404)
      return serveLocal(res, url, localFile(join(o.path, rel), o.path), basename(rel))
    }
    const name = basename(o.path || o.storage_key || 'file')
    if (file && file !== name) throw new AppError('not_found', 'Ese entregable es un archivo; no lleva ?file=', 404)
    if (o.storage_key) {
      try { if (await streamObject(res, url, o.bucket, o.storage_key, name, o.content_type)) return } catch (e) { if (res.headersSent) return }
    }
    if (!o.path) throw new AppError('not_found', 'El archivo ya no está en el almacenamiento', 404)
    return serveLocal(res, url, localFile(o.path), name)
  }
  const existsDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }


  const send = (res, code, body, headers = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
    res.end(text)
  }

  // Cuerpo crudo con tope. Con tope excedido responde 413 y cierra la conexión.
  const readBody = (req, max) =>
    new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'])
      if (declared > max) { req.resume(); return reject(new AppError('too_large', `Body is larger than ${max} bytes`, 413)) }
      const chunks = []
      let n = 0
      let over = false
      req.on('data', (c) => {
        if (over) return
        n += c.length
        if (n > max) { over = true; chunks.length = 0; return reject(new AppError('too_large', `Body is larger than ${max} bytes`, 413)) }
        chunks.push(c)
      })
      req.on('end', () => !over && resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  const readJson = (req, max = 1_000_000) =>
    new Promise((resolve, reject) => {
      let raw = ''
      let over = false
      req.on('data', (c) => {
        if (over) return
        raw += c
        if (raw.length > max) { over = true; raw = ''; reject(new AppError('too_large', 'Cuerpo demasiado grande', 413)) }
      })
      req.on('end', () => {
        if (over) return
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new AppError('bad_json', 'JSON inválido'))
        }
      })
    })

  const stripSlashes = (p) => String(p).replace(/\/+$/, '')
  // Trabajo en segundo plano: con ?wait=1 espera el resultado; si no, responde 202 (o 200 si termina enseguida; los errores de validación salen aquí).
  async function runJob(res, url, job, snapshot) {
    if (url.searchParams.get('wait') === '1') return send(res, 200, await job)
    job.catch(() => {})
    const quick = await Promise.race([job.then((r) => ({ r })), new Promise((r) => setTimeout(() => r(null), 80))])
    if (quick) return send(res, 200, quick.r)
    return send(res, 202, { started: true, ...snapshot(), note: 'Running in the background; see GET /api/storage/status' })
  }

  // Una línea para el agente cuando la persona le dejó comentarios o pidió cambios en el Canvas (sólo si hay algo).
  const canvasNote = (agent, ws) => {
    const n = canvas.pendingFor(agent, ws)
    return n ? { canvas_feedback: `${n} canvas artifact(s) need your action (changes requested or new comments from the person). Call backoffice_artifact_list with needs_action=true.` } : {}
  }

  // Rename compat (one release): hooks and MCP clients configured before the rename send X-AgentOS-* headers. Each one
  // fills its X-BackOffice-* counterpart when that is missing or empty (Node lower-cases header names).
  const legacyHeaders = (h) => {
    for (const k of Object.keys(h)) {
      if (!k.startsWith('x-agentos-')) continue
      const n = 'x-backoffice-' + k.slice('x-agentos-'.length)
      if (!String(h[n] ?? '').trim()) h[n] = h[k]
    }
  }

  async function route(req, res) {
    // Sólo local: evita que una página web externa le hable al servidor (DNS rebinding).
    if (!LOCAL_HOSTS.test(req.headers.host ?? '')) return send(res, 403, { error: 'host_not_allowed' })
    legacyHeaders(req.headers)
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname
    const m = req.method

    // La web local (Next en otro puerto) necesita CORS hacia localhost.
    const origin = req.headers.origin
    if (origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('access-control-allow-credentials', 'true')
      res.setHeader('access-control-allow-headers', 'content-type, x-backoffice-workspace, x-backoffice-cwd, x-agentos-workspace, x-agentos-cwd')
      res.setHeader('access-control-expose-headers', 'content-disposition, content-type, content-length')
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    }
    if (m === 'OPTIONS') return send(res, 204)
    // Escrituras sólo desde la web local o desde procesos sin Origin (MCP, curl): una página externa no puede escribir.
    if (m !== 'GET' && m !== 'HEAD' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'origin_not_allowed' })

    // ── MCP por HTTP (Streamable HTTP, sólo POST con respuesta JSON) para otros clientes: Codex, OpenCode, Cursor... ──
    // Mismas herramientas que el MCP por stdio (mcp.mjs `handle`), con llave Bearer de data/mcp-key en vez de sesión.
    if (path === '/mcp') {
      if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'origin_not_allowed' })
      const key = typeof mcpKey === 'function' ? mcpKey() : mcpKey
      if (!key) return send(res, 503, { error: 'mcp_off', message: 'El MCP por HTTP no está activo en este servidor.' })
      if (!bearerOk(req.headers.authorization, key)) return send(res, 401, { error: 'unauthorized', message: 'Falta la llave de Back Office: Authorization: Bearer <contenido de data/mcp-key>. Corre ./bin/backoffice mcp-key para ver cómo copiarla.' }, { 'www-authenticate': 'Bearer realm="backoffice"' })
      if (m !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'Este MCP sólo acepta POST (sin stream SSE).' }, { allow: 'POST' })
      const body = await readJson(req, Math.ceil(lim.maxFileBytes * 1.4) + 65536)
      const hdr = (n) => String(req.headers[n] ?? '').trim() || null
      const ctx = {
        base: `http://127.0.0.1:${req.socket.localPort}`,
        scope: () => (hdr('x-backoffice-workspace') ? { 'x-backoffice-workspace': hdr('x-backoffice-workspace') } : {}),
        agent: () => hdr('x-backoffice-agent'),
        ensure: false,
      }
      const msgs = Array.isArray(body) ? body : [body]
      const out = (await Promise.all(msgs.map((x) => (x && typeof x === 'object' ? mcpHandle(x, ctx) : { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })))).filter(Boolean)
      if (!out.length) { res.writeHead(202); return res.end() } // sólo notificaciones
      return send(res, 200, Array.isArray(body) ? out : out[0])
    }

    // ── autenticación de la web ──
    // Una petición de navegador (lleva Origin o Sec-Fetch-Site) necesita sesión; los procesos locales (hooks, MCP, curl) no.
    const token = parseCookie(req.headers.cookie)
    if (path === '/api/auth/status' && m === 'GET') {
      const authenticated = !auth.enabled || auth.verify(token)
      return send(res, 200, { enabled: auth.enabled, configured: auth.configured(), authenticated, user: authenticated ? auth.userName() : null })
    }
    if (m === 'POST' && path === '/api/auth/login') {
      const r = auth.login(await readJson(req))
      return send(res, 200, { ok: true, user: r.name }, { 'set-cookie': cookieHeader(r.token) })
    }
    if (m === 'POST' && path === '/api/auth/logout') {
      auth.logout(token)
      return send(res, 200, { ok: true }, { 'set-cookie': clearCookieHeader() })
    }
    const fromBrowser = !!(origin || req.headers['sec-fetch-site'])
    if (auth.enabled && fromBrowser && path !== '/health' && !path.startsWith('/hooks/') && path !== '/api/whatsapp/webhook' && !auth.verify(token)) return send(res, 401, { error: 'auth_required', message: 'Inicia sesión' })

    if (m === 'GET' && path === '/health') return send(res, 200, { ok: true, sessions: db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n })

    // Hooks de Claude: POST /hooks/<Evento>. Nunca bloquean. En SessionStart y SubagentStart, si el agente
    // tiene contexto en su equipo, se devuelve como additionalContext y Claude lo suma a la conversación.
    let h
    let tm
    if (m === 'POST' && (h = path.match(/^\/hooks\/([A-Za-z]+)$/))) {
      let out = null
      // HTTP hooks have a fixed URL (port 4780) but send the caller's BACKOFFICE_PORT as a header: a run that targets a
      // different (isolated test) server must not write into this one.
      const callerPort = String(req.headers['x-backoffice-port'] ?? '').trim()
      if (callerPort && callerPort !== String(port)) {
        res.writeHead(200)
        return res.end()
      }
      try {
        const payload = await readJson(req)
        payload.backoffice_workspace ??= (String(req.headers['x-backoffice-workspace'] ?? '').trim() || undefined) // BACKOFFICE_WORKSPACE (empty when unset)
        const session = store.recordEvent(h[1], payload)
        if (h[1] === 'SessionStart' || h[1] === 'SubagentStart') {
          const ctx = payload.agent_type ? store.contextFor(payload.agent_type, session?.workspace_id ?? store.resolveWorkspace({ explicit: payload.backoffice_workspace, cwd: payload.cwd })) : null
          if (ctx) out = { hookSpecificOutput: { hookEventName: h[1], additionalContext: ctx } }
        }
      } catch (e) {
        console.error('hook', h[1], e.message)
      }
      if (!out) {
        res.writeHead(200)
        return res.end()
      }
      return send(res, 200, out)
    }

    // ── workspaces ──
    const wsx = path.startsWith('/api/') ? wsOf(req, url) : { id: store.DEFAULT_WS, strict: false }
    const ws = wsx.id
    const strictWs = wsx.strict ? ws : null
    let wm
    if (m === 'GET' && path === '/api/workspaces') return send(res, 200, store.listWorkspaces())
    if (m === 'GET' && path === '/api/desktop/code-sessions') {
      const r = desktopCodeSessions({ workspaceRoot: url.searchParams.get('workspace') ? store.getWorkspace(ws)?.root ?? null : null })
      // A quién ya está ligada cada sesión (en cualquier proyecto), para que la web no ofrezca dos veces la misma.
      const links = store.sessionLinks()
      // Las tareas de Cowork se guardan como «cowork:local_…» (Desktop no las abre por id; ver web/lib/claude.ts).
      for (const s of r.sessions) { const l = links[s.id] ?? links[`cowork:${s.id}`]; if (l) s.linkedTo = l }
      return send(res, 200, r)
    }
    if (m === 'GET' && path === '/api/codex/sessions') {
      const r = codexSessions({ workspaceRoot: url.searchParams.get('workspace') ? store.getWorkspace(ws)?.root ?? null : null })
      const links = store.sessionLinks()
      for (const s of r.sessions) { const l = links[`codex://threads/${s.id}`] ?? links[`codex:${s.id}`]; if (l) s.linkedTo = l }
      return send(res, 200, r)
    }
    // ── definiciones de agentes (.md de Claude): global = ~/.claude/agents, project = <raíz>/.claude/agents ──
    if (path === '/api/agent-defs' || path.startsWith('/api/agent-defs/') || path.startsWith('/api/human/agent-defs/')) {
      const scope = url.searchParams.get('scope') || 'project'
      const root = scope === 'project' ? store.getWorkspace(ws)?.root ?? null : null
      if (m === 'GET' && path === '/api/agent-defs') return send(res, 200, defs.list({ scope, root }))
      const id = decodeURIComponent(path.split('/').pop())
      if (m === 'GET' && path.startsWith('/api/agent-defs/')) return send(res, 200, defs.get(id, { scope, root }))
      if (m === 'PUT' && path.startsWith('/api/human/agent-defs/')) return send(res, 200, defs.put(id, { scope, root, content: (await readJson(req, 200_000)).content }))
      if (m === 'DELETE' && path.startsWith('/api/human/agent-defs/')) return send(res, 200, defs.remove(id, { scope, root }))
    }
    // ── reportes de la plataforma: borrador + enlace de GitHub Issues prellenado (la persona lo envía) ──
    if (m === 'POST' && path === '/api/issues') return send(res, 201, issues.report(await readJson(req, 50_000), ws, undefined, (l) => console.log(l)))
    if (m === 'GET' && path === '/api/issues') return send(res, 200, issues.list(url.searchParams.get('limit')))
    // ── canvas para agentes (MCP): workspace de la sesión; nunca aprueban ni piden cambios ──
    if (path === '/api/canvas' || path.startsWith('/api/canvas/')) {
      const q = Object.fromEntries(url.searchParams)
      if (m === 'GET' && path === '/api/canvas') return send(res, 200, canvas.list(ws, q))
      if (m === 'POST' && path === '/api/canvas/publish') return send(res, 201, await canvas.publish(await readJson(req, Math.ceil(lim.maxFileBytes * 1.4) + 4096), ws))
      if (m === 'GET' && (wm = path.match(/^\/api\/canvas\/([\w-]+)$/))) return send(res, 200, canvas.get(wm[1], ws, { agent: q.agent }))
      if (m === 'POST' && (wm = path.match(/^\/api\/canvas\/([\w-]+)\/comments$/))) return send(res, 201, canvas.comment(wm[1], ws, await readJson(req, 50_000)))
      return send(res, 404, { error: 'not_found' })
    }
    if (m === 'POST' && path === '/api/workspaces') {
      const w = store.createWorkspace(await readJson(req))
      blobs.ensureBucket(bucketOf(w.id)).catch(() => {})
      return send(res, 201, w)
    }
    if (m === 'GET' && path === '/api/projects') return send(res, 200, store.projectsSummary())
    if (m === 'GET' && path === '/api/workspaces/resolve') return send(res, 200, { workspace: store.workspaceForCwd(url.searchParams.get('cwd')) })
    if ((wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)$/))) {
      if (m === 'GET') return send(res, 200, store.needWorkspace(wm[1]) && store.getWorkspace(wm[1]))
      if (m === 'PATCH') return send(res, 200, store.updateWorkspace(wm[1], await readJson(req)))
      if (m === 'DELETE') return send(res, 200, store.deleteWorkspace(wm[1], { force: url.searchParams.get('force') === '1' }))
    }
    // ── archivos del workspace (web): claves completas `files/...`, `outputs/...`; sin rutas de disco ──
    if (m === 'GET' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/files$/))) {
      const w = store.needWorkspace(wm[1])
      const prefix = url.searchParams.get('prefix') ?? ''
      if (prefix) safeRel(prefix.replace(/\/$/, ''))
      const rec = ['1', 'true'].includes(url.searchParams.get('recursive'))
      const page = await files.listPage(w.id, { prefix, recursive: rec, limit: url.searchParams.get('limit'), cursor: url.searchParams.get('cursor') ?? '', includeTrash: url.searchParams.get('include_trash') === '1' })
      return send(res, 200, { workspace: w.id, bucket: bucketOf(w.id), backend: 'local', prefix, recursive: rec, ...page })
    }
    if (m === 'GET' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/object$/))) {
      const w = store.needWorkspace(wm[1])
      const key = assertKey(url.searchParams.get('key') ?? '')
      if (!(await streamObject(res, url, bucketOf(w.id), key, basename(key), null))) return send(res, 404, { error: 'not_found' })
      return
    }
    if (m === 'PUT' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/object$/))) {
      const w = store.needWorkspace(wm[1])
      const key = files.userKey(url.searchParams.get('key') ?? '')
      const body = await readBody(req, lim.maxFileBytes)
      const hdr = String(req.headers['content-type'] ?? '').trim()
      const generic = !hdr || /^(application\/octet-stream|application\/x-www-form-urlencoded|multipart\/)/i.test(hdr) || !/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/.test(hdr)
      const r = await files.putKey(w.id, key, body, { contentType: generic ? contentTypeOf(key) : hdr, overwrite: url.searchParams.get('overwrite') !== '0' })
      return send(res, r.created ? 201 : 200, r)
    }
    if (m === 'DELETE' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/object$/))) {
      const w = store.needWorkspace(wm[1])
      return send(res, 200, await files.softDelete(w.id, files.userKey(url.searchParams.get('key') ?? '')))
    }
    if (m === 'POST' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/move$/))) {
      const w = store.needWorkspace(wm[1])
      const b = await readJson(req)
      const from = String(b.from ?? '').replace(/^\/+/, '').startsWith('trash/') ? files.trashKey(b.from) : files.userKey(b.from) // restore from trash
      return send(res, 200, await files.move(w.id, from, files.userKey(b.to)))
    }
    if (m === 'POST' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/folder$/))) {
      const w = store.needWorkspace(wm[1])
      return send(res, 201, await files.makeFolder(w.id, (await readJson(req)).prefix))
    }
    if (m === 'GET' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/zip$/))) {
      const w = store.needWorkspace(wm[1])
      const prefix = stripSlashes(url.searchParams.get('prefix') ?? '')
      if (prefix) safeRel(prefix)
      assertKey(prefix || FILES.slice(0, -1))
      const plan = await files.zipPlan(w.id, prefix || FILES.slice(0, -1))
      res.writeHead(200, {
        'content-type': 'application/zip',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename="${cdName(plan.label)}.zip"; filename*=UTF-8''${encodeURIComponent(plan.label)}.zip`,
      })
      await pipeline(Readable.from(zipStream(files.zipEntries(w.id, plan))), res).catch(() => res.destroy())
      return
    }
    if (m === 'POST' && (wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/import-disk$/))) {
      const w = store.needWorkspace(wm[1])
      const b = await readJson(req)
      return runJob(res, url, transfer.importDisk(w.id, { root: typeof b.root === 'string' ? b.root : null }), () => ({ import: { ...transfer.importState } }))
    }
    // ── canvas (web): tablero, detalle, contenido de una versión; comentar y decidir son sólo de la persona ──
    if ((wm = path.match(/^\/api\/workspaces\/([a-z0-9-]+)\/canvas(?:\/([\w-]+)(?:\/(comments|decision|v\/(\d+)))?)?$/))) {
      const w = store.needWorkspace(wm[1])
      const [, , aid, sub, n] = wm
      if (m === 'GET' && !aid) return send(res, 200, canvas.list(w.id, { scope_type: url.searchParams.get('scope_type') || undefined, scope_id: url.searchParams.get('scope_id') || undefined, status: url.searchParams.get('status') || undefined }))
      if (m === 'GET' && aid === 'home' && !sub) return send(res, 200, canvas.home(w.id)) // null = nadie ha armado el inicio todavía
      if (m === 'GET' && aid && !sub) return send(res, 200, canvas.get(aid, w.id))
      if (m === 'GET' && n) {
        const v = canvas.version(aid, w.id, n)
        if (!(await streamObject(res, url, v.bucket, v.key, v.name, v.contentType))) return send(res, 404, { error: 'not_found', message: 'El contenido de esa versión ya no está en el almacenamiento' })
        return
      }
      // Igual que aprobar una tarea, pero aplicado en el servidor: sólo una petición del navegador (con sesión cuando hay
      // autenticación) puede escribir como la persona. El MCP, los hooks y curl no mandan Origin.
      if (m === 'POST' && (sub === 'comments' || sub === 'decision')) {
        if (!fromBrowser) throw new AppError('human_only', 'Sólo la persona comenta o decide aquí, desde la web. Los agentes usan backoffice_artifact_comment.', 403)
        const b = await readJson(req, 50_000)
        return send(res, 200, sub === 'comments' ? canvas.comment(aid, w.id, { body: b.body }, true) : canvas.decide(aid, w.id, b))
      }
    }

    // ── API de archivos para agentes (MCP): rutas relativas al workspace de la sesión ──
    if (path.startsWith('/api/files/') && !/^\/api\/files\/\d+$/.test(path)) {
      const rel = (p, o) => files.normalizeRel(ws, p ?? '', o)
      const BIG = Math.ceil(lim.maxFileBytes * 1.4) + 4096
      if (m === 'POST' && path === '/api/files/write') {
        const b = await readJson(req, BIG)
        const relPath = rel(b.path)
        if (b.content !== undefined && b.content_base64 !== undefined) throw new AppError('bad_request', 'Send content or content_base64, not both', 400)
        if (typeof b.content !== 'string' && typeof b.content_base64 !== 'string') throw new AppError('bad_request', 'content (utf-8 text) or content_base64 is required', 400)
        const buf = typeof b.content_base64 === 'string' ? Buffer.from(b.content_base64, 'base64') : Buffer.from(b.content, 'utf8')
        const known = contentTypeOf(relPath)
        const type = b.content_type || (typeof b.content === 'string' && known === 'application/octet-stream' ? 'text/plain; charset=utf-8' : known)
        const r = await files.putKey(ws, files.keyOfRel(relPath), buf, { contentType: type, overwrite: b.overwrite !== false })
        return send(res, r.created ? 201 : 200, { path: relPath, size: r.size, sha256: r.sha256, content_type: r.content_type, created: r.created, overwritten: r.overwritten })
      }
      if (m === 'GET' && path === '/api/files/read') {
        const relPath = rel(url.searchParams.get('path'))
        const maxB = Number(url.searchParams.get('max_bytes')) || null
        const r = await files.readKey(ws, files.keyOfRel(relPath), { maxBytes: maxB })
        const buf = r.buf
        const truncated = r.truncated
        let text = null
        const dec = (b) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return null } }
        text = dec(buf)
        if (text === null && truncated) for (let k = 1; k <= 3 && text === null; k++) text = dec(buf.subarray(0, buf.length - k)) // the cut may split a multi-byte character
        if (text !== null && !text.includes('\0')) return send(res, 200, { path: relPath, size: r.size, content_type: r.contentType, encoding: 'utf-8', content: text, truncated })
        if (truncated) throw new AppError('too_large', `Binary file is ${r.size} bytes; binary files are returned whole (limit ${lim.maxReadBytes} bytes)`, 413)
        return send(res, 200, { path: relPath, size: r.size, content_type: r.contentType, encoding: 'base64', content_base64: buf.toString('base64'), truncated: false })
      }
      if (m === 'GET' && path === '/api/files/list') {
        const relPrefix = rel(url.searchParams.get('prefix'), { allowEmpty: true })
        const key = relPrefix ? FILES + relPrefix + '/' : FILES
        const rec = ['1', 'true'].includes(url.searchParams.get('recursive'))
        const cur = url.searchParams.get('cursor')
        const page = await files.listPage(ws, { prefix: key, recursive: rec, limit: url.searchParams.get('limit'), cursor: cur ? FILES + cur : '' })
        const cut = (k) => k.slice(FILES.length)
        return send(res, 200, {
          prefix: relPrefix,
          folders: page.folders.map((f) => ({ path: cut(f.prefix).replace(/\/$/, ''), name: f.name })),
          files: page.files.map((f) => ({ path: cut(f.key), name: f.name, size: f.size, mtime: f.last_modified, content_type: f.content_type })),
          next_cursor: page.next_cursor ? cut(page.next_cursor) : null,
          truncated: page.truncated,
        })
      }
      if (m === 'POST' && path === '/api/files/delete') {
        const r = await files.softDelete(ws, files.keyOfRel(rel((await readJson(req)).path)))
        return send(res, 200, { path: r.key.slice(FILES.length), kind: r.kind, trashed: r.trashed, trash_prefix: r.trash_prefix })
      }
      if (m === 'POST' && path === '/api/files/move') {
        const b = await readJson(req)
        const r = await files.move(ws, files.keyOfRel(rel(b.from)), files.keyOfRel(rel(b.to)))
        return send(res, 200, { from: r.from.slice(FILES.length), to: r.to.slice(FILES.length), kind: r.kind, moved: r.moved })
      }
      return send(res, 404, { error: 'not_found' })
    }

    // ── almacenamiento de archivos ──
    if (m === 'GET' && path === '/api/storage/status') return send(res, 200, await blobs.status({ import: { ...transfer.importState }, limits: { max_file_bytes: lim.maxFileBytes, max_read_bytes: lim.maxReadBytes, max_list_page: lim.maxListPage } }))
    if (m === 'GET' && (wm = path.match(/^\/api\/files\/(\d+)$/))) return serveOutput(res, url, Number(wm[1]), wsx)
    if (m === 'GET' && (wm = path.match(/^\/api\/outputs\/(\d+)\/files$/))) {
      const o = store.getOutput(Number(wm[1]))
      if (!o || (wsx.strict && o.workspace_id !== ws)) throw new AppError('not_found', 'No existe ese entregable', 404)
      if (o.kind === 'link') return send(res, 200, { output_id: o.id, kind: 'link', files: [], skipped: [] })
      let files = o.files?.files?.map((f) => ({ rel: f.rel, size: f.size, content_type: f.content_type, stored: true }))
      let skipped = o.files?.skipped ?? []
      if (!files) {
        if (existsDir(o.path)) {
          const w = await walkFolder(o.path) // todavía no está en el almacenamiento: se lista del disco
          if (realRoots().some((r) => { try { return inside(realpathSync(o.path), r) } catch { return false } })) {
            files = w.files.map((f) => ({ rel: f.rel, size: f.size, content_type: contentTypeOf(f.rel), stored: false }))
            skipped = w.skipped
          }
        }
        {
          const nm = basename(o.path || o.storage_key || 'file')
          files ??= [{ rel: nm, size: o.size, content_type: o.content_type ?? contentTypeOf(nm), stored: !!o.storage_key }]
        }
      }
      return send(res, 200, { output_id: o.id, kind: o.files || existsDir(o.path) ? 'folder' : 'file', stored: o.stored, storage_error: o.storage_error, files, skipped })
    }

    if (m === 'GET' && path === '/api/profile') return send(res, 200, store.getProfile(url.searchParams.get('insights') ?? 50))
    if (m === 'PATCH' && path === '/api/profile') return send(res, 200, store.updateProfile(await readJson(req)))
    if (m === 'POST' && path === '/api/profile/insights') return send(res, 200, store.addInsight(await readJson(req)))
    if (m === 'DELETE' && (tm = path.match(/^\/api\/profile\/insights\/(\d+)$/))) return store.deleteInsight(tm[1]), send(res, 200, { ok: true })
    if (m === 'GET' && path === '/api/system') return send(res, 200, store.listSystemAgents(ws))
    if (m === 'PATCH' && (tm = path.match(/^\/api\/system\/([\w-]+)$/))) return send(res, 200, store.updateSystemAgent(tm[1], await readJson(req), ws))
    if (m === 'GET' && path === '/api/overview') return send(res, 200, { ...store.overview(ws), agile: agile.summary(ws) })
    if (m === 'GET' && path === '/api/roster') return send(res, 200, store.getRoster({ plugin: url.searchParams.get('plugin'), agent: url.searchParams.get('agent') }, ws))
    if (m === 'GET' && path === '/api/teams') return send(res, 200, store.listTeams(ws))
    if (m === 'POST' && path === '/api/teams') return send(res, 201, store.createTeam(await readJson(req), ws))
    if (m === 'GET' && path === '/api/context') return send(res, 200, { workspace: { id: ws, name: store.needWorkspace(ws).name }, context: store.contextFor(url.searchParams.get('agent'), ws), ...canvasNote(url.searchParams.get('agent'), ws) })
    if ((tm = path.match(/^\/api\/teams\/([\w-]+)$/))) {
      if (m === 'PATCH') return send(res, 200, store.updateTeam(tm[1], await readJson(req), strictWs))
      if (m === 'DELETE') return store.deleteTeam(tm[1], strictWs), send(res, 200, { ok: true })
    }
    if (m === 'POST' && (tm = path.match(/^\/api\/teams\/([\w-]+)\/activate$/))) return send(res, 200, store.activateTeam(tm[1], strictWs))

    if (m === 'POST' && path === '/api/checkin') {
      const b = await readJson(req)
      return send(res, 200, { ...store.checkin(b, ws), ...canvasNote(b.agent, ws) })
    }
    if (m === 'GET' && path === '/api/sessions') return send(res, 200, store.listSessions(ws))
    if (m === 'GET' && path === '/api/events') return send(res, 200, store.recentEvents(Number(url.searchParams.get('limit')) || 100, ws))
    if (m === 'GET' && path === '/api/stream') {
      const w = store.needWorkspace(ws)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' }) // no-transform: a proxy (Next on 4781) must not gzip-buffer the stream
      res.write(`event: snapshot\ndata: ${JSON.stringify({ workspace: { id: w.id, name: w.name }, workspaces: store.listWorkspaces(), sessions: store.listSessions(ws), tasks: store.listTasks(ws), leads: store.listLeads(ws), teams: store.listTeams(ws), system: store.listSystemAgents(ws), ...agile.snapshot(ws) })}\n\n`)
      sse.set(res, ws)
      const ping = setInterval(() => res.write(': ping\n\n'), 20000)
      req.on('close', () => {
        clearInterval(ping)
        sse.delete(res)
      })
      return
    }

    if (m === 'GET' && path === '/api/tasks') {
      let list = store.listTasks(ws)
      for (const k of ['status', 'sprint_id', 'story_id']) {
        const v = url.searchParams.get(k)
        if (v) list = list.filter((x) => (v === 'none' ? x[k] == null : x[k] === v))
      }
      return send(res, 200, list)
    }
    // ── Agile: epics, stories, sprints. Agents: /api/<kind>; the person (browser only): /api/human/<kind> ──
    let ag
    if ((ag = path.match(/^\/api\/(human\/)?(epics|stories|sprints)(?:\/([\w-]+))?(\/complete)?$/))) {
      const [, human, kind, id, complete] = ag
      if (human && m !== 'GET' && !fromBrowser) throw new AppError('human_only', 'Sólo la persona hace esto, desde la web. Los agentes usan las herramientas backoffice_epic_*/_story_*/_sprint_*.', 403)
      if (complete) {
        if (!human || kind !== 'sprints' || !id || m !== 'POST') return send(res, 404, { error: 'not_found' })
        return send(res, 200, agile.complete(id, strictWs, await readJson(req)))
      }
      if (m === 'GET' && !id) return send(res, 200, agile.list(kind, ws, { status: url.searchParams.get('status'), epic_id: url.searchParams.get('epic_id'), sprint_id: url.searchParams.get('sprint_id') }))
      if (m === 'GET') return send(res, 200, agile.get(kind, id, strictWs))
      if (m === 'POST' && !id) return send(res, 201, agile.create(kind, await readJson(req), ws, !!human))
      if (m === 'PATCH' && id) return send(res, 200, agile.update(kind, id, await readJson(req), strictWs, !!human))
      if (m === 'DELETE' && id && human) return send(res, 200, agile.remove(kind, id, strictWs))
      return send(res, 404, { error: 'not_found' })
    }
    if (m === 'POST' && path === '/api/tasks') return send(res, 201, store.createTask(await readJson(req), ws))
    let t
    if (m === 'GET' && path === '/api/leads') return send(res, 200, store.listLeads(ws, { stage: url.searchParams.get('stage') || undefined, query: url.searchParams.get('query') || undefined }))
    if (m === 'POST' && path === '/api/leads') return send(res, 201, store.createLead(await readJson(req), ws))
    if (m === 'POST' && path === '/api/human/leads') return send(res, 201, store.createLead(await readJson(req), ws, true))
    if ((t = path.match(/^\/api\/leads\/([\w-]+)$/)) && m === 'PATCH') return send(res, 200, store.updateLead(t[1], await readJson(req), strictWs))
    if ((t = path.match(/^\/api\/human\/leads\/([\w-]+)$/))) {
      if (m === 'PATCH') return send(res, 200, store.updateLead(t[1], await readJson(req), strictWs, true))
      if (m === 'DELETE') return send(res, 200, store.deleteLead(t[1], strictWs))
    }
    // ── WhatsApp (open-wa) ──
    // Webhook from the local open-wa process: no browser session, but ONLY with the right secret (constant-time compare). Ack fast.
    if (m === 'POST' && path === '/api/whatsapp/webhook') {
      if (!wa.secretOk(url.searchParams.get('secret'))) return send(res, 401, { error: 'bad_secret' })
      const r = wa.ingest(await readJson(req, 25_000_000).catch(() => null))
      return send(res, 200, { ok: true, stored: r.stored })
    }
    if (m === 'GET' && path === '/api/whatsapp/status') return send(res, 200, await wa.status())
    if (m === 'GET' && path === '/api/whatsapp/chats') return send(res, 200, wa.chats(ws, { onlyUnanswered: ['1', 'true'].includes(url.searchParams.get('only_unanswered')), limit: Number(url.searchParams.get('limit')) || 100, recent: Math.min(Number(url.searchParams.get('recent')) || 0, 20) }))
    if (m === 'GET' && path === '/api/whatsapp/messages') return send(res, 200, wa.messages(ws, url.searchParams.get('chat_id'), url.searchParams.get('limit')))
    if (m === 'GET' && path === '/api/whatsapp/drafts') return send(res, 200, wa.drafts(ws, { status: url.searchParams.get('status') || undefined, chat_id: url.searchParams.get('chat_id') || undefined }))
    if (m === 'POST' && path === '/api/whatsapp/drafts') return send(res, 201, wa.createDraft(ws, await readJson(req)))
    if (m === 'PUT' && path === '/api/human/whatsapp/settings') return send(res, 200, wa.setWorkspace((await readJson(req)).workspace))
    if ((t = path.match(/^\/api\/human\/whatsapp\/drafts\/([\w-]+)(\/send)?$/))) {
      if (t[2] && m === 'POST') return send(res, 200, await wa.sendDraft(t[1], ws, (await readJson(req)).text))
      if (!t[2] && m === 'PATCH') return send(res, 200, wa.editDraft(t[1], ws, (await readJson(req)).text))
      if (!t[2] && m === 'DELETE') return send(res, 200, wa.discardDraft(t[1], ws))
    }
    if (m === 'GET' && path === '/api/outputs') return send(res, 200, store.listOutputs(ws))

    if ((t = path.match(/^\/api\/tasks\/([\w-]+)$/))) {
      if (m === 'GET') {
        const task = store.getTask(t[1], strictWs)
        return task ? send(res, 200, task) : send(res, 404, { error: 'not_found' })
      }
      if (m === 'PATCH') return send(res, 200, store.updateTask(t[1], await readJson(req), strictWs))
    }
    if (m === 'POST' && (t = path.match(/^\/api\/tasks\/([\w-]+)\/outputs$/))) {
      const body = await readJson(req, 12_000_000)
      if (Array.isArray(body.files)) { // entregables virtuales: archivos del almacenamiento (y/o {name, content}); sin rutas de disco
        const task = store.getTask(t[1], strictWs)
        if (!task) throw new AppError('not_found', `No existe la tarea ${t[1]}`, 404)
        const out = await files.deliverVirtual(task.workspace_id, t[1], body)
        if (typeof body.path === 'string' && body.path) { // además, una ruta de disco clásica
          const added = store.addOutput(t[1], { path: body.path, kind: body.kind, title: body.title }, strictWs)
          await uploader.uploadOutput(added.new_output_id).catch(() => {})
          return send(res, 201, store.getTask(t[1]))
        }
        return send(res, 201, out)
      }
      const added = store.addOutput(t[1], body, strictWs)
      await uploader.uploadOutput(added.new_output_id).catch(() => {}) // nunca falla la entrega
      return send(res, 201, store.getTask(t[1]))
    }
    // Ruta de personas (la web): los agentes no la tienen en sus herramientas.
    if (m === 'POST' && (t = path.match(/^\/api\/human\/tasks\/([\w-]+)\/approve$/))) return send(res, 200, store.approveTask(t[1], (await readJson(req)).by, strictWs))

    if (m === 'POST' && path === '/api/human/tasks') return send(res, 201, store.createTask(await readJson(req), ws, true))
    if (m === 'POST' && (t = path.match(/^\/api\/human\/tasks\/([\w-]+)\/move-project$/))) {
      const plan = store.planTaskMove(t[1], (await readJson(req))?.to, strictWs)
      // Copia los objetos al bucket destino; el origen sólo se borra cuando todas las copias salieron bien.
      const srcBucket = bucketOf(plan.from)
      const dstBucket = bucketOf(plan.to)
      const pairs = [] // { src: bucket, key }
      for (const o of plan.outputs) {
        if (o.kind === 'link') continue
        const b = o.bucket ?? srcBucket
        if (o.storage_key && !o.storage_key.endsWith('/')) pairs.push({ bucket: b, key: o.storage_key })
        let f = null
        try { f = o.files ? JSON.parse(o.files) : null } catch {}
        for (const e of f?.files ?? []) if (e?.key) pairs.push({ bucket: b, key: e.key })
      }
      const copied = []
      try {
        await blobs.ensureBucket(dstBucket)
        for (const p of pairs) {
          if (p.bucket === dstBucket) continue
          const obj = await blobs.get(p.bucket, p.key)
          if (!obj) continue // ya no estaba en el almacenamiento; la fila se mueve igual
          const chunks = []
          for await (const c of obj.stream) chunks.push(c)
          await blobs.put(dstBucket, p.key, Buffer.concat(chunks), obj.contentType)
          copied.push(p.key)
        }
      } catch (e) {
        for (const k of copied) await blobs.delete(dstBucket, k).catch(() => {})
        throw e
      }
      let out
      try { out = store.applyTaskMove(t[1], plan.to) } catch (e) {
        for (const k of copied) await blobs.delete(dstBucket, k).catch(() => {})
        throw e
      }
      for (const p of pairs) if (p.bucket !== dstBucket) await blobs.delete(p.bucket, p.key).catch(() => {})
      return send(res, 200, out)
    }
    if ((t = path.match(/^\/api\/human\/tasks\/([\w-]+)$/))) {
      if (m === 'PATCH') return send(res, 200, store.humanUpdateTask(t[1], await readJson(req), strictWs))
      if (m === 'DELETE') return send(res, 200, store.deleteTask(t[1], strictWs))
    }

    // La persona abre en Finder la carpeta de un entregable (sólo rutas que un agente registró).
    if (m === 'POST' && path === '/api/human/open') {
      const { path: target } = await readJson(req)
      if (!store.isKnownPath(target)) throw new AppError('unknown_path', 'Esa ruta no está registrada como entregable', 403)
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(cmd, [target], () => {})
      return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'not_found' })
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e.http === 413) res.setHeader('connection', 'close')
      if (e instanceof AppError || e instanceof BlobError) return send(res, e.http, { error: e.code, message: e.message })
      console.error(e)
      send(res, 500, { error: 'internal' })
    })
  })

  return {
    store,
    blobs,
    files,
    transfer,
    uploader,
    server,
    // Tareas de arranque (en segundo plano, nunca lanzan): importación única de la carpeta del workspace `default`.
    async startBackground(log = () => {}) {
      try {
        const u = await blobs.usage()
        log(`Storage: local store, ${u.files} files (${u.bytes} bytes)`)
        const ir = await transfer.importDefaultOnce()
        if (ir) log(`Import of the default workspace folder: ${ir.imported} files, ${ir.skipped_existing} already present, ${ir.failed} failed`)
      } catch (e) { log(`startBackground: ${e?.message ?? e}`) }
    },
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { for (const r of sse.keys()) r.end(); server.close(resolve); server.closeAllConnections?.() }),
  }
}

if (isMain(import.meta.url)) {
  const app = createApp({ auth: process.env.BACKOFFICE_AUTH !== 'off', blobsRoot: join(backofficeHome(), 'store'), mcpKey: () => ensureMcpKey() })
  const p = await app.listen()
  console.log(`Back Office escuchando en http://127.0.0.1:${p}`)
  // La carpeta del proyecto por defecto (workspaces/default) debe existir: ahí se abren las sesiones de Claude del proyecto.
  try { mkdirSync(defaultWorkspaceRoot(), { recursive: true }) } catch (e) { console.log(`No pude crear ${defaultWorkspaceRoot()}: ${e.message}`) }
  try { ensureMcpKey() } catch (e) { console.log(`No pude crear la llave del MCP por HTTP: ${e.message}`) } // data/mcp-key (0600), nunca se imprime
  // En segundo plano: el servidor ya atiende.
  app.startBackground((m) => console.log(m))
  if (process.env.BACKOFFICE_AUTH !== 'off') {
    const creds = loadCredentials()
    if (!creds) console.log('Auth: sin usuario ni contraseña. Crea data/.env (en la carpeta de Back Office) con BACKOFFICE_USER y BACKOFFICE_PASSWORD (ver docs/AUTH.md); mientras tanto la web no deja entrar.')
    for (const f of looseFiles(creds)) console.log(`Auth: ${f} lo pueden leer otros usuarios de esta computadora. Corre: chmod 600 ${f}`)
  }
}
