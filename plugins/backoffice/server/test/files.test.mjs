import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readdirSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// La raíz del workspace `default` va a una carpeta temporal ANTES de abrir cualquier base (nunca ~/AgentOS).
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-froot-')))
process.env.BACKOFFICE_ROOT = ROOT
const { openDb } = await import('../src/db.mjs')
const { createApp } = await import('../src/server.mjs')
const { createLocalStore, assertBlobKey } = await import('../src/blobstore.mjs')
const { contentTypeOf } = await import('../src/outputs-storage.mjs')

const sha = (b) => createHash('sha256').update(b).digest('hex')
const tmp = (p = 'backoffice-t-') => realpathSync(mkdtempSync(join(tmpdir(), p)))
const text = async (r) => (await r).text()

async function boot(opts = {}) {
  const app = createApp({ db: openDb(':memory:'), port: 0, extraRoots: [], ...opts })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    const t = await r.text()
    let json = null
    try { json = t ? JSON.parse(t) : null } catch { json = t }
    return { status: r.status, body: json }
  }
  const raw = (path, init = {}) => fetch(base + path, init)
  const put = (ws, key, body, type, extra = '') => fetch(`${base}/api/workspaces/${ws}/object?key=${encodeURIComponent(key)}${extra}`, { method: 'PUT', headers: type ? { 'content-type': type } : {}, body })
  return { app, base, call, raw, put }
}
const mkWs = async (call, id) => (await call('POST', '/api/workspaces', { name: id, id })).body

function mcpClient(port, cwd, env = {}) {
  const child = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname], { cwd, env: { ...process.env, BACKOFFICE_PORT: String(port), ...env }, stdio: ['pipe', 'pipe', 'inherit'] })
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

// ───────────── blob store: local backend ─────────────
test('local store: put/get/head/list/copy/delete, sidecar, atomic writes and empty-folder pruning', async () => {
  const root = tmp()
  const st = createLocalStore({ root, typeOf: contentTypeOf })
  const b = 'ws-demo'
  const r = await st.put(b, 'files/a/b/hola ñ.md', Buffer.from('# Hola'), 'text/markdown; charset=utf-8')
  assert.equal(r.sha256, sha('# Hola'))
  assert.equal(readdirSync(join(root, '.tmp')).length, 0) // temp + rename: nothing left behind
  const h = await st.head(b, 'files/a/b/hola ñ.md')
  assert.equal(h.size, 6)
  assert.equal(h.contentType, 'text/markdown; charset=utf-8')
  assert.equal(h.sha256, sha('# Hola'))
  const g = await st.get(b, 'files/a/b/hola ñ.md')
  let body = ''
  for await (const c of g.stream) body += c
  assert.equal(body, '# Hola')
  assert.equal(await st.get(b, 'files/nope'), null)
  // overwrite replaces atomically
  await st.put(b, 'files/a/b/hola ñ.md', Buffer.from('v2'), 'text/plain')
  assert.equal((await st.head(b, 'files/a/b/hola ñ.md')).size, 2)
  await st.put(b, 'files/a/c.txt', 'c', 'text/plain')
  await st.put(b, 'outputs/T-1/x.pdf', Buffer.from([1, 2, 3]), 'application/pdf')
  // listing with delimiter and recursive, prefix semantics (partial prefixes included)
  let l = await st.list(b, '', { delimiter: '/' })
  assert.deepEqual(l.prefixes, ['files/', 'outputs/'])
  l = await st.list(b, 'files/', { delimiter: '/' })
  assert.deepEqual(l.prefixes, ['files/a/'])
  l = await st.list(b, 'files/a/', { delimiter: '/' })
  assert.deepEqual(l.objects.map((o) => o.key), ['files/a/c.txt'])
  assert.deepEqual(l.prefixes, ['files/a/b/'])
  l = await st.list(b, 'fil', { delimiter: '/' })
  assert.deepEqual(l.prefixes, ['files/'])
  l = await st.list(b, 'files/', {})
  assert.deepEqual(l.objects.map((o) => o.key).sort(), ['files/a/b/hola ñ.md', 'files/a/c.txt'])
  assert.equal((await st.list(b, 'files/', { max: 1 })).truncated, true)
  // copy keeps type + hash
  const c = await st.copy(b, 'outputs/T-1/x.pdf', 'trash/1/outputs/T-1/x.pdf')
  assert.equal(c.sha256, sha(Buffer.from([1, 2, 3])))
  assert.equal((await st.head(b, 'trash/1/outputs/T-1/x.pdf')).contentType, 'application/pdf')
  // delete prunes empty folders; a missing key is a no-op
  await st.delete(b, 'files/a/b/hola ñ.md')
  assert.equal(existsSync(join(root, b, 'files', 'a', 'b')), false)
  await st.delete(b, 'files/never')
  // a file dropped by hand (no sidecar) still works: type by extension, sha computed on demand
  writeFileSync(join(root, b, 'files', 'manual.csv'), 'a,b')
  const hm = await st.head(b, 'files/manual.csv', { sha: true })
  assert.equal(hm.contentType, 'text/csv; charset=utf-8')
  assert.equal(hm.sha256, sha('a,b'))
  // a file and a folder cannot share a name
  await assert.rejects(st.put(b, 'files/a/c.txt/inner', 'x', 'text/plain'), (e) => e.http === 409)
  await assert.rejects(st.put(b, 'files/a', 'x', 'text/plain'), (e) => e.http === 409)
})

test('key validation: traversal, absolute, NUL, empty segments, length, bad buckets', async () => {
  const bad = ['../x', 'a/../b', '/abs', 'a\\b', 'a\0b', 'a//b', 'a/', './a', 'a/./b', '', 'a'.repeat(1025), 'x/' + 'y'.repeat(241), 'a\nb']
  for (const k of bad) assert.throws(() => assertBlobKey(k), (e) => e.http === 400, JSON.stringify(k).slice(0, 30))
  assert.equal(assertBlobKey('files/ok/ñ ü.md'), 'files/ok/ñ ü.md')
  const st = createLocalStore({ root: tmp() })
  for (const k of bad) await assert.rejects(st.put('ws-demo', k, 'x', 'text/plain'), (e) => e.http === 400, JSON.stringify(k).slice(0, 30))
  await assert.rejects(st.put('../evil', 'a', 'x', 'text/plain'), (e) => e.code === 'InvalidBucketName')
  await assert.rejects(st.list('ws-demo', '../'), (e) => e.http === 400)
})

test('local store is symlink-safe', async () => {
  const root = tmp()
  const outside = tmp('backoffice-outside-')
  writeFileSync(join(outside, 'secret.txt'), 'SECRET')
  const st = createLocalStore({ root })
  await st.put('ws-demo', 'files/a.txt', 'a', 'text/plain')
  symlinkSync(outside, join(root, 'ws-demo', 'files', 'link'))
  symlinkSync(join(outside, 'secret.txt'), join(root, 'ws-demo', 'files', 'secret-link.txt'))
  await assert.rejects(st.get('ws-demo', 'files/link/secret.txt'), (e) => e.http === 403)
  await assert.rejects(st.put('ws-demo', 'files/link/new.txt', 'x', 'text/plain'), (e) => e.http === 403)
  await assert.rejects(st.get('ws-demo', 'files/secret-link.txt'), (e) => e.http === 403)
  const l = await st.list('ws-demo', 'files/', { delimiter: '/' })
  assert.deepEqual(l.objects.map((o) => o.key), ['files/a.txt']) // links are not listed
  assert.deepEqual(l.prefixes, [])
  assert.equal(existsSync(join(outside, 'new.txt')), false)
})

test('web API: upload, list (recursive/limit/cursor), folder, move, soft delete, key restrictions, origin', async () => {
  const { app, call, put, raw, base } = await boot({ limits: { maxFileBytes: 1000 } })
  try {
    await mkWs(call, 'acme')
    // upload: type from header, from extension when the header is generic; overwrite
    let r = await put('acme', 'files/marketing/inmobiliaria/facts.md', '# Hechos ñ', 'text/markdown; charset=utf-8')
    assert.equal(r.status, 201)
    assert.equal((await r.json()).created, true)
    r = await put('acme', 'files/marketing/inmobiliaria/notes.txt', 'n', 'application/octet-stream')
    assert.equal((await r.json()).content_type, 'text/plain; charset=utf-8')
    r = await put('acme', 'files/marketing/inmobiliaria/facts.md', '# v2', 'text/markdown')
    assert.equal(r.status, 200)
    assert.equal((await r.json()).overwritten, true)
    assert.equal((await put('acme', 'files/marketing/inmobiliaria/facts.md', 'x', 'text/markdown', '&overwrite=0')).status, 409)
    assert.equal(await text(raw('/api/workspaces/acme/object?key=files/marketing/inmobiliaria/facts.md')), '# v2')
    // caps and key rules
    assert.equal((await put('acme', 'files/big.bin', Buffer.alloc(1001))).status, 413)
    assert.equal((await put('acme', 'files/chunked.bin', new Blob([Buffer.alloc(1001)]).stream(), 'application/octet-stream').catch(() => ({ status: 413 }))).status, 413)
    for (const key of ['outputs/T-1/x.md', 'trash/1/x', 'files', '../x', 'files/../x', '/files/x', 'files//x']) {
      const s = (await put('acme', key, 'x', 'text/plain')).status
      assert.ok(s === 403 || s === 400, `${key} -> ${s}`)
    }
    assert.equal((await put('nope', 'files/x', 'x')).status, 404)
    // sandbox for html/svg, nosniff
    await put('acme', 'files/page.html', '<script>1</script>', 'text/html')
    const h = await raw('/api/workspaces/acme/object?key=files/page.html')
    assert.equal(h.headers.get('content-security-policy'), 'sandbox allow-scripts')
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff')
    await h.arrayBuffer()
    // folder marker: hidden file, visible folder
    assert.equal((await call('POST', '/api/workspaces/acme/folder', { prefix: 'files/empty/nested' })).status, 201)
    const top = (await call('GET', '/api/workspaces/acme/files?prefix=files/')).body
    assert.deepEqual(top.folders.map((f) => f.name), ['empty', 'marketing'])
    assert.deepEqual(top.files.map((f) => f.name), ['page.html'])
    assert.equal(top.backend, 'local')
    const nested = (await call('GET', '/api/workspaces/acme/files?prefix=files/empty/nested/')).body
    assert.deepEqual(nested.files, []) // .keep is hidden
    // recursive + pagination
    const all = (await call('GET', '/api/workspaces/acme/files?prefix=files/&recursive=1')).body
    assert.deepEqual(all.files.map((f) => f.name), ['marketing/inmobiliaria/facts.md', 'marketing/inmobiliaria/notes.txt', 'page.html'])
    assert.ok(all.folders.some((f) => f.prefix === 'files/empty/nested/'))
    const p1 = (await call('GET', '/api/workspaces/acme/files?prefix=files/&recursive=1&limit=2')).body
    assert.equal(p1.folders.length + p1.files.length, 2)
    assert.ok(p1.next_cursor)
    const p2 = (await call('GET', `/api/workspaces/acme/files?prefix=files/&recursive=1&limit=100&cursor=${encodeURIComponent(p1.next_cursor)}`)).body
    assert.equal(p2.next_cursor, null)
    assert.equal(p1.folders.length + p1.files.length + p2.folders.length + p2.files.length, all.folders.length + all.files.length)
    // move file and folder; conflicts
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'files/marketing/inmobiliaria/notes.txt', to: 'files/marketing/inmobiliaria/n2.txt' })).status, 200)
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'files/marketing/inmobiliaria/n2.txt', to: 'files/marketing/inmobiliaria/facts.md' })).status, 409)
    const mv = await call('POST', '/api/workspaces/acme/move', { from: 'files/marketing/inmobiliaria', to: 'files/clients/inmobiliaria' })
    assert.equal(mv.body.kind, 'folder')
    assert.equal(mv.body.moved, 2)
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'files/clients', to: 'files/clients/sub' })).status, 400)
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'files/nope', to: 'files/x' })).status, 404)
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'files/clients/inmobiliaria/facts.md', to: 'outputs/x' })).status, 403)
    assert.equal(await text(raw('/api/workspaces/acme/object?key=files/clients/inmobiliaria/facts.md')), '# v2')
    // soft delete: leaves listings, lands in trash/<ts>/<key>
    const del = await call('DELETE', `/api/workspaces/acme/object?key=${encodeURIComponent('files/clients/inmobiliaria/facts.md')}`)
    assert.equal(del.body.trashed, 1)
    assert.match(del.body.trash_prefix, /^trash\/\d+\/files\/clients\/inmobiliaria\/facts\.md$/)
    assert.equal((await raw('/api/workspaces/acme/object?key=files/clients/inmobiliaria/facts.md')).status, 404)
    assert.equal(await text(raw(`/api/workspaces/acme/object?key=${encodeURIComponent(del.body.trash_prefix)}`)), '# v2') // recoverable
    // restore: move from trash/<ts>/files/... back into files/ (and nothing else out of trash)
    const back = await call('POST', '/api/workspaces/acme/move', { from: del.body.trash_prefix, to: 'files/clients/inmobiliaria/facts.md' })
    assert.equal(back.status, 200)
    assert.equal(await text(raw('/api/workspaces/acme/object?key=files/clients/inmobiliaria/facts.md')), '# v2')
    assert.equal((await raw(`/api/workspaces/acme/object?key=${encodeURIComponent(del.body.trash_prefix)}`)).status, 404) // gone from trash
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'trash/1/outputs/x', to: 'files/x' })).status, 403)
    assert.equal((await call('POST', '/api/workspaces/acme/move', { from: 'trash/1/files/x', to: 'outputs/x' })).status, 403)
    const del2 = await call('DELETE', `/api/workspaces/acme/object?key=${encodeURIComponent('files/clients/inmobiliaria/facts.md')}`) // trash it again for the rest of the test
    assert.equal(del2.body.trashed, 1)
    const root = (await call('GET', '/api/workspaces/acme/files')).body
    assert.ok(!root.folders.some((f) => f.prefix === 'trash/')) // hidden from the root
    assert.ok((await call('GET', '/api/workspaces/acme/files?include_trash=1')).body.folders.some((f) => f.prefix === 'trash/'))
    assert.equal((await call('DELETE', '/api/workspaces/acme/object?key=files/clients')).body.trashed, 1) // folder (facts.md was trashed already)
    assert.equal((await call('DELETE', '/api/workspaces/acme/object?key=files/ghost')).status, 404)
    assert.equal((await call('DELETE', '/api/workspaces/acme/object?key=outputs/T-1/x')).status, 403)
    // other workspace sees nothing of acme
    assert.deepEqual((await call('GET', '/api/workspaces/default/files?prefix=files/&recursive=1')).body.files, [])
    // writes from a foreign origin are refused; the local web origin is fine
    const evil = await fetch(`${base}/api/workspaces/acme/object?key=files/evil.txt`, { method: 'PUT', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: 'x' })
    assert.equal(evil.status, 403)
    const okOrigin = await fetch(`${base}/api/workspaces/acme/object?key=files/web.txt`, { method: 'PUT', headers: { origin: 'http://localhost:4781', 'content-type': 'text/plain' }, body: 'x' })
    assert.equal(okOrigin.status, 201)
    assert.equal(okOrigin.headers.get('access-control-allow-origin'), 'http://localhost:4781')
    // status: local backend, the store folder (so people know what to back up) and usage counts; no credentials
    const st = (await call('GET', '/api/storage/status')).body
    assert.equal(st.backend, 'local')
    assert.ok(st.root && st.usage.files >= 1)
    assert.doesNotMatch(JSON.stringify(st), /secret|access_key|endpoint|console/i)
  } finally { await app.close() }
})

test('web API emits a workspace-scoped `files` SSE event', async () => {
  const { app, call, put, base } = await boot()
  try {
    await mkWs(call, 'acme')
    const seen = { acme: [], default: [] }
    const ctrl = new AbortController()
    const watch = async (ws) => {
      const r = await fetch(`${base}/api/stream?workspace=${ws}`, { signal: ctrl.signal })
      let buf = ''
      for await (const c of r.body) {
        buf += Buffer.from(c).toString()
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); if (ev.startsWith('event: files')) seen[ws].push(JSON.parse(ev.split('data: ')[1])) }
      }
    }
    watch('acme').catch(() => {})
    watch('default').catch(() => {})
    await new Promise((r) => setTimeout(r, 150))
    await put('acme', 'files/a.md', 'a', 'text/markdown')
    await call('POST', '/api/workspaces/acme/move', { from: 'files/a.md', to: 'files/b.md' })
    await new Promise((r) => setTimeout(r, 150))
    ctrl.abort()
    assert.deepEqual(seen.acme.map((e) => e.op), ['put', 'move'])
    assert.equal(seen.acme[0].workspace_id, 'acme')
    assert.equal(seen.acme[0].key, 'files/a.md')
    assert.deepEqual(seen.default, [])
  } finally { await app.close() }
})

// ───────────── ZIP ─────────────
test('zip: streams a folder as a valid store-only ZIP (unzip -t / python zipfile)', async () => {
  const { app, call, put, raw } = await boot()
  try {
    await mkWs(call, 'acme')
    const big = Buffer.alloc(300_000, 'abc')
    await put('acme', 'files/proj/readme ñ.md', '# Léeme', 'text/markdown')
    await put('acme', 'files/proj/sub/data.bin', big)
    await put('acme', 'files/proj/sub/deeper/x.txt', 'x', 'text/plain')
    await call('POST', '/api/workspaces/acme/folder', { prefix: 'files/proj/vacia' })
    await put('acme', 'files/otro/no.txt', 'no', 'text/plain')
    const r = await raw('/api/workspaces/acme/zip?prefix=files/proj')
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'application/zip')
    assert.match(r.headers.get('content-disposition'), /proj\.zip/)
    const zip = Buffer.from(await r.arrayBuffer())
    const dir = tmp('backoffice-zip-')
    writeFileSync(join(dir, 'f.zip'), zip)
    const py = spawnSync('python3', ['-I', '-c', `
import zipfile, sys, hashlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = sorted(z.namelist())
print('|'.join(names))
print(hashlib.sha256(z.read('proj/sub/data.bin')).hexdigest())
print(z.read('proj/readme ñ.md').decode())
`, join(dir, 'f.zip')], { encoding: 'utf8' })
    if (py.error?.code !== 'ENOENT') {
      assert.equal(py.status, 0, py.stderr)
      const [names, digest, readme] = py.stdout.split('\n')
      assert.equal(names, 'proj/readme ñ.md|proj/sub/|proj/sub/data.bin|proj/sub/deeper/|proj/sub/deeper/x.txt|proj/vacia/')
      assert.equal(digest, sha(big))
      assert.equal(readme, '# Léeme')
    }
    const un = spawnSync('unzip', ['-t', join(dir, 'f.zip')], { encoding: 'utf8' })
    if (un.error?.code !== 'ENOENT') {
      assert.equal(un.status, 0, un.stdout + un.stderr)
      assert.match(un.stdout, /No errors detected/)
    }
    assert.equal((await raw('/api/workspaces/acme/zip?prefix=files/nada')).status, 404)
    assert.equal((await raw('/api/workspaces/acme/zip?prefix=../x')).status, 400)
  } finally { await app.close() }
})

// ───────────── MCP file tools ─────────────
test('MCP file tools: write/read/list/move/delete, scoped by workspace, legacy paths, limits', async () => {
  const { app, call, put, raw } = await boot({ limits: { maxFileBytes: 2000, maxReadBytes: 1000 } })
  const w = await mkWs(call, 'acme')
  const port = app.server.address().port
  const inAcme = mcpClient(port, w.root)
  const inDefault = mcpClient(port, ROOT)
  const viaEnv = mcpClient(port, tmpdir(), { BACKOFFICE_WORKSPACE: 'acme' })
  try {
    const list = await inAcme.rpc('tools/list')
    assert.deepEqual(list.result.tools.map((t) => t.name).filter((n) => n.startsWith('backoffice_file_')), ['backoffice_file_write', 'backoffice_file_read', 'backoffice_file_list', 'backoffice_file_delete', 'backoffice_file_move'])
    const wr = await inAcme.tool('backoffice_file_write', { path: 'marketing/inmobiliaria/facts.md', content: '# Hechos\nCasas en San Nicolás ñ' })
    assert.equal(wr.data.created, true)
    assert.equal(wr.data.content_type, 'text/markdown; charset=utf-8')
    assert.equal(wr.data.sha256, sha('# Hechos\nCasas en San Nicolás ñ'))
    // isolation: the default workspace session cannot see it; the env-scoped one can
    assert.equal((await inDefault.tool('backoffice_file_read', { path: 'marketing/inmobiliaria/facts.md' })).isError, true)
    assert.equal((await viaEnv.tool('backoffice_file_read', { path: 'marketing/inmobiliaria/facts.md' })).data.content, '# Hechos\nCasas en San Nicolás ñ')
    assert.deepEqual((await inDefault.tool('backoffice_file_list', { recursive: true })).data.files, [])
    assert.equal((await raw('/api/workspaces/default/object?key=files/marketing/inmobiliaria/facts.md')).status, 404)
    // legacy path forms all resolve to the same file
    for (const p of ['~/AgentOS/workspaces/acme/marketing/inmobiliaria/facts.md', `${w.root}/marketing/inmobiliaria/facts.md`, '/marketing/inmobiliaria/facts.md', './marketing//inmobiliaria/facts.md']) {
      const rd = await inAcme.tool('backoffice_file_read', { path: p })
      assert.equal(rd.data.path, 'marketing/inmobiliaria/facts.md', p)
    }
    assert.equal((await inDefault.tool('backoffice_file_write', { path: '~/AgentOS/x/y.md', content: 'd' })).data.path, 'x/y.md')
    // traversal
    assert.match((await inAcme.tool('backoffice_file_write', { path: '../../etc/passwd', content: 'x' })).data, /\.\./)
    assert.equal((await inAcme.tool('backoffice_file_read', { path: 'a/../../x' })).isError, true)
    // overwrite flag
    const no = await inAcme.tool('backoffice_file_write', { path: 'marketing/inmobiliaria/facts.md', content: 'x', overwrite: false })
    assert.equal(no.isError, true)
    assert.match(no.data, /already exists/)
    assert.equal((await inAcme.tool('backoffice_file_write', { path: 'marketing/inmobiliaria/facts.md', content: 'v2' })).data.overwritten, true)
    // binary round trip
    const bin = Buffer.from([0, 1, 2, 255, 254])
    await inAcme.tool('backoffice_file_write', { path: 'assets/logo.png', content_base64: bin.toString('base64') })
    const rb = (await inAcme.tool('backoffice_file_read', { path: 'assets/logo.png' })).data
    assert.equal(rb.encoding, 'base64')
    assert.equal(rb.content_type, 'image/png')
    assert.deepEqual([...Buffer.from(rb.content_base64, 'base64')], [...bin])
    // both / neither content, and size limits
    assert.equal((await inAcme.tool('backoffice_file_write', { path: 'a.txt', content: 'a', content_base64: 'YQ==' })).isError, true)
    assert.equal((await inAcme.tool('backoffice_file_write', { path: 'a.txt' })).isError, true)
    assert.match((await inAcme.tool('backoffice_file_write', { path: 'big.txt', content: 'x'.repeat(2001) })).data, /limit/)
    await inAcme.tool('backoffice_file_write', { path: 'mid.txt', content: 'y'.repeat(1500) }) // writable (<2000) but over the 1000-byte read cap
    const big = await inAcme.tool('backoffice_file_read', { path: 'mid.txt' })
    assert.equal(big.isError, true)
    assert.match(big.data, /read limit/)
    const part = (await inAcme.tool('backoffice_file_read', { path: 'mid.txt', max_bytes: 10 })).data
    assert.equal(part.content, 'yyyyyyyyyy')
    assert.equal(part.truncated, true)
    // list: one level, recursive, trash excluded
    const l1 = (await inAcme.tool('backoffice_file_list', {})).data
    assert.deepEqual(l1.folders.map((f) => f.path), ['assets', 'marketing'])
    assert.deepEqual(l1.files.map((f) => f.path), ['mid.txt'])
    assert.ok(l1.files[0].size === 1500 && l1.files[0].mtime)
    const l2 = (await inAcme.tool('backoffice_file_list', { prefix: 'marketing' })).data
    assert.deepEqual(l2.folders.map((f) => f.path), ['marketing/inmobiliaria'])
    const l3 = (await inAcme.tool('backoffice_file_list', { recursive: true })).data
    assert.deepEqual(l3.files.map((f) => f.path), ['assets/logo.png', 'marketing/inmobiliaria/facts.md', 'mid.txt'])
    // move + delete (soft)
    const mv = await inAcme.tool('backoffice_file_move', { from: 'marketing/inmobiliaria', to: 'clientes/inmobiliaria' })
    assert.equal(mv.data.kind, 'folder')
    assert.equal((await inAcme.tool('backoffice_file_move', { from: 'mid.txt', to: 'assets/logo.png' })).isError, true)
    const dl = await inAcme.tool('backoffice_file_delete', { path: 'clientes/inmobiliaria/facts.md' })
    assert.equal(dl.data.trashed, 1)
    assert.equal((await inAcme.tool('backoffice_file_read', { path: 'clientes/inmobiliaria/facts.md' })).isError, true)
    assert.ok(!(await inAcme.tool('backoffice_file_list', { recursive: true })).data.files.some((f) => f.path.includes('trash')))
    assert.equal((await inAcme.tool('backoffice_file_delete', { path: 'clientes/inmobiliaria/facts.md' })).isError, true)
    // the web sees the same objects under files/ and keeps the trash
    const web = (await call('GET', '/api/workspaces/acme/files?prefix=files/&recursive=1')).body
    assert.deepEqual(web.files.map((f) => f.name), ['assets/logo.png', 'mid.txt'])
    assert.ok((await call('GET', '/api/workspaces/acme/files?prefix=trash/&recursive=1')).body.files.some((f) => f.name.endsWith('files/clientes/inmobiliaria/facts.md')))
  } finally { inAcme.stop(); inDefault.stop(); viaEnv.stop(); await app.close() }
})

// ───────────── delivery with virtual files ─────────────
test('backoffice_task_deliver with files: virtual file, folder and inline content; disk path still works', async () => {
  const { app, call, put, raw } = await boot()
  const w = await mkWs(call, 'acme')
  const A = { 'x-backoffice-workspace': 'acme' }
  try {
    await put('acme', 'files/marketing/informe.md', '# Informe', 'text/markdown; charset=utf-8')
    await put('acme', 'files/marketing/sitio/index.html', '<h1>hola</h1>', 'text/html')
    await put('acme', 'files/marketing/sitio/css/a.css', 'body{}', 'text/css')
    const t = (await call('POST', '/api/tasks', { title: 'Entrega virtual' }, A)).body
    const r = await call('POST', `/api/tasks/${t.id}/outputs`, {
      files: [
        { path: 'marketing/informe.md', kind: 'markdown', title: 'Informe final' },
        { path: '~/AgentOS/workspaces/acme/marketing/sitio' },
        { name: 'resumen.txt', content: 'Resumen ñ' },
      ],
    }, A)
    assert.equal(r.status, 201)
    const [o1, o2, o3] = r.body.outputs
    assert.equal(o1.path, null) // no disk path anywhere
    assert.equal(o1.virtual, true)
    assert.equal(o1.title, 'Informe final')
    assert.equal(o1.bucket, 'ws-acme')
    assert.equal(o1.storage_key, `outputs/${t.id}/informe.md`)
    assert.equal(o1.sha256, sha('# Informe'))
    assert.equal(o1.stored, true)
    assert.equal(o1.exists, true)
    assert.equal(await text(raw(`/api/files/${o1.id}`, { headers: A })), '# Informe')
    assert.equal(o2.kind, 'folder')
    assert.equal(o2.path, null)
    assert.deepEqual(o2.files.files.map((f) => f.rel), ['css/a.css', 'index.html'])
    assert.equal(await text(raw(`/api/files/${o2.id}?file=index.html`, { headers: A })), '<h1>hola</h1>')
    const idx = await raw(`/api/files/${o2.id}?file=index.html`, { headers: A })
    assert.equal(idx.headers.get('content-security-policy'), 'sandbox allow-scripts')
    await idx.arrayBuffer()
    const lf = (await call('GET', `/api/outputs/${o2.id}/files`, null, A)).body
    assert.equal(lf.kind, 'folder')
    assert.equal(lf.files.length, 2)
    assert.equal(o3.storage_key, `outputs/${t.id}/resumen.txt`)
    assert.equal(await text(raw(`/api/files/${o3.id}`, { headers: A })), 'Resumen ñ')
    const single = (await call('GET', `/api/outputs/${o3.id}/files`, null, A)).body
    assert.equal(single.files[0].rel, 'resumen.txt')
    // the source files stay where they were
    assert.equal(await text(raw('/api/workspaces/acme/object?key=files/marketing/informe.md')), '# Informe')
    // delivering counts for review; collision of names inside one task
    const again = await call('POST', `/api/tasks/${t.id}/outputs`, { files: [{ path: 'marketing/informe.md' }] }, A)
    assert.equal(again.body.outputs[3].storage_key, `outputs/${t.id}/${again.body.outputs[3].id}/informe.md`)
    assert.equal((await call('PATCH', `/api/tasks/${t.id}`, { status: 'review' }, A)).status, 200)
    // validation: unknown file, bad item, traversal, task of another workspace
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { files: [{ path: 'no/existe.md' }] }, A)).status, 404)
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { files: [{ foo: 1 }] }, A)).status, 400)
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { files: [{ path: '../x' }] }, A)).status, 400)
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { files: [{ name: 'a/b.txt', content: 'x' }] }, A)).status, 400)
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { files: [{ path: 'marketing/informe.md' }] }, { 'x-backoffice-workspace': 'default' })).status, 404)
    assert.equal((await call('GET', `/api/tasks/${t.id}`, null, A)).body.outputs.length, 4) // failed attempts created no rows
    // backward compatible: a disk path still works (copied into storage)
    const file = join(w.root, 'disco.md')
    writeFileSync(file, 'en disco')
    const d = await call('POST', `/api/tasks/${t.id}/outputs`, { path: file, kind: 'markdown' }, A)
    const od = d.body.outputs.at(-1)
    assert.equal(od.path, file)
    assert.equal(od.virtual, false)
    assert.equal(od.storage_key, `outputs/${t.id}/disco.md`)
    assert.equal(await text(raw(`/api/files/${od.id}`, { headers: A })), 'en disco')
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { kind: 'file' }, A)).status, 400) // neither path nor files
  } finally { await app.close() }
})

test('MCP backoffice_task_deliver with files', async () => {
  const { app, call } = await boot()
  const w = await mkWs(call, 'acme')
  const mcp = mcpClient(app.server.address().port, w.root)
  try {
    const t = (await mcp.tool('backoffice_task_create', { title: 'x' })).data
    await mcp.tool('backoffice_file_write', { path: 'seo/audit.md', content: '# Audit' })
    const del = await mcp.tool('backoffice_task_deliver', { id: t.id, files: [{ path: 'seo/audit.md' }] })
    assert.equal(del.data.outputs[0].path, null)
    assert.equal(del.data.outputs[0].storage_key, `outputs/${t.id}/audit.md`)
    const rev = await mcp.tool('backoffice_task_update', { id: t.id, status: 'review' }) // virtual output satisfies the review rule
    assert.equal(rev.data.status, 'review')
  } finally { mcp.stop(); await app.close() }
})

// ───────────── import-disk ─────────────
test('import-disk: ingests the workspace folder as files/<rel>, idempotent, skips junk and other workspaces', async () => {
  const { app, call, raw } = await boot()
  try {
    const w = await mkWs(call, 'imp')
    mkdirSync(join(w.root, 'marketing', 'x'), { recursive: true })
    mkdirSync(join(w.root, 'node_modules', 'm'), { recursive: true })
    mkdirSync(join(w.root, '.git'), { recursive: true })
    writeFileSync(join(w.root, 'marketing', 'x', 'a.md'), '# a')
    writeFileSync(join(w.root, 'top.csv'), 'a,b')
    writeFileSync(join(w.root, '.DS_Store'), 'junk')
    writeFileSync(join(w.root, 'node_modules', 'm', 'big.js'), 'no')
    writeFileSync(join(w.root, '.git', 'HEAD'), 'no')
    const outside = tmp('backoffice-imp-out-')
    writeFileSync(join(outside, 'secret.txt'), 'S')
    symlinkSync(outside, join(w.root, 'linkdir'))
    symlinkSync(join(outside, 'secret.txt'), join(w.root, 'link.txt'))
    const r = await call('POST', '/api/workspaces/imp/import-disk?wait=1', {})
    assert.equal(r.status, 200)
    assert.equal(r.body.imported, 2)
    assert.equal(r.body.failed, 0)
    const l = (await call('GET', '/api/workspaces/imp/files?prefix=files/&recursive=1')).body
    assert.deepEqual(l.files.map((f) => f.name), ['marketing/x/a.md', 'top.csv'])
    assert.equal(await text(raw('/api/workspaces/imp/object?key=files/marketing/x/a.md')), '# a')
    // idempotent, and never clobbers what was edited in the web afterwards
    await fetch(`${app.server.address() && `http://127.0.0.1:${app.server.address().port}`}/api/workspaces/imp/object?key=files/top.csv`, { method: 'PUT', headers: { 'content-type': 'text/csv' }, body: 'edited' })
    writeFileSync(join(w.root, 'new.txt'), 'n')
    const r2 = await call('POST', '/api/workspaces/imp/import-disk?wait=1', {})
    assert.equal(r2.body.imported, 1)
    assert.equal(r2.body.skipped_existing, 2)
    assert.equal(await text(raw('/api/workspaces/imp/object?key=files/top.csv')), 'edited')
    // root outside the allowed roots is refused; unknown root is a 404
    assert.equal((await call('POST', '/api/workspaces/imp/import-disk', { root: outside })).status, 403)
    assert.equal((await call('POST', '/api/workspaces/imp/import-disk', { root: join(w.root, 'no-existe') })).status, 404)
    // default root contains other workspaces' roots: they are not imported into default
    mkdirSync(join(ROOT, 'default'), { recursive: true })
    writeFileSync(join(ROOT, 'default', 'raiz.md'), '# raiz')
    const rd = await call('POST', '/api/workspaces/default/import-disk?wait=1', {})
    assert.equal(rd.status, 200)
    const names = (await call('GET', '/api/workspaces/default/files?prefix=files/&recursive=1')).body.files.map((f) => f.name)
    assert.ok(names.includes('raiz.md'))
    assert.ok(!names.some((n) => n.startsWith('workspaces/') || n.startsWith('imp/')))
    // status carries progress
    const st = (await call('GET', '/api/storage/status')).body
    assert.equal(st.import.running, false)
    assert.ok(st.import.imported >= 1)
  } finally { await app.close() }
})

test('startBackground: one-time import of `default`, recorded in settings and not repeated', async () => {
  const root = tmp('backoffice-default-')
  const prev = process.env.BACKOFFICE_ROOT
  process.env.BACKOFFICE_ROOT = root
  const db = openDb(':memory:')
  process.env.BACKOFFICE_ROOT = prev
  mkdirSync(join(root, 'default'), { recursive: true })
  writeFileSync(join(root, 'default', 'hola.md'), '# hola')
  const { app, call } = await boot({ db })
  try {
    const logs = []
    await app.startBackground((m) => logs.push(m))
    assert.ok(logs.some((l) => /Import of the default/.test(l)), logs.join('\n'))
    assert.equal((await call('GET', '/api/workspaces/default/files?prefix=files/')).body.files[0].name, 'hola.md')
    assert.ok(app.store.getSetting('import.disk.default').done_at)
    writeFileSync(join(root, 'default', 'otro.md'), 'x')
    await app.startBackground(() => {})
    assert.equal((await call('GET', '/api/workspaces/default/files?prefix=files/')).body.files.length, 1) // not repeated
  } finally { await app.close() }
})

test('agent context and overview tell agents to use Back Office storage, not disk paths', async () => {
  const { app, call } = await boot()
  try {
    await call('POST', '/api/teams', { name: 'Marketing', members: [{ agent_id: 'cmo', context: 'ctx' }] })
    const c = (await call('GET', '/api/context?agent=cmo')).body.context
    assert.match(c, /backoffice_file_read\/write\/list\/delete\/move/)
    assert.match(c, /Never ask the person for disk paths/)
    assert.match(c, /backoffice_task_deliver `files`/)
    assert.match((await call('GET', '/api/context?agent=coo')).body.context, /Back Office storage/)
    assert.match((await call('GET', '/api/overview')).body.files_hint, /workspace-relative paths/)
  } finally { await app.close() }
})

// ───────────── mover una tarea de proyecto ─────────────
test('move-project: task, file and folder deliverables go to the destination; source is emptied', async () => {
  const { app, call, raw } = await boot({ extraRoots: [ROOT] })
  try {
    await mkWs(call, 'alfa')
    await mkWs(call, 'beta')
    const A = { 'x-backoffice-workspace': 'alfa' }
    const B = { 'x-backoffice-workspace': 'beta' }
    const dir = join(ROOT, 'mv-' + Date.now())
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'doc.md'), '# hola')
    writeFileSync(join(dir, 'sub', 'a.txt'), 'AAA')
    writeFileSync(join(dir, 'sub', 'b.txt'), 'BBB')
    const t = (await call('POST', '/api/human/tasks', { title: 'Mover yo', description: 'desc', status: 'doing' }, A)).body
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { path: join(dir, 'doc.md'), title: 'Doc' }, A)).status, 201)
    assert.equal((await call('POST', `/api/tasks/${t.id}/outputs`, { path: join(dir, 'sub'), kind: 'folder', title: 'Carpeta' }, A)).status, 201)
    const before = (await call('GET', '/api/tasks', null, A)).body.find((x) => x.id === t.id)
    assert.ok(before.outputs.every((o) => o.bucket === 'ws-alfa' && o.stored))

    // errores
    assert.equal((await call('POST', `/api/human/tasks/${t.id}/move-project`, { to: 'beta' }, B)).status, 404)
    assert.equal((await call('POST', `/api/human/tasks/${t.id}/move-project`, { to: 'nope' }, A)).status, 400)
    assert.equal((await call('POST', `/api/human/tasks/${t.id}/move-project`, { to: 'alfa' }, A)).status, 400)
    assert.equal((await call('POST', `/api/human/tasks/${t.id}/move-project`, {}, A)).status, 400)

    const r = await call('POST', `/api/human/tasks/${t.id}/move-project`, { to: 'beta' }, A)
    assert.equal(r.status, 200)
    assert.equal(r.body.workspace_id, 'beta')
    assert.equal(r.body.id, t.id)
    assert.equal(r.body.status, 'doing')
    assert.equal(r.body.description, 'desc')
    assert.ok(r.body.outputs.every((o) => o.bucket === 'ws-beta' && o.workspace_id === 'beta'))
    assert.equal((await call('GET', '/api/tasks', null, A)).body.some((x) => x.id === t.id), false)
    assert.equal((await call('GET', '/api/tasks', null, B)).body.some((x) => x.id === t.id), true)

    const [fileOut, dirOut] = r.body.outputs
    assert.equal(await text(raw(`/api/files/${fileOut.id}?workspace=beta`)), '# hola')
    assert.equal(await text(raw(`/api/files/${dirOut.id}?workspace=beta&file=b.txt`)), 'BBB')
    const obj = (ws, key) => raw(`/api/workspaces/${ws}/object?key=${encodeURIComponent(key)}`)
    assert.equal((await obj('beta', fileOut.storage_key)).status, 200)
    assert.equal((await obj('alfa', fileOut.storage_key)).status, 404)
    for (const f of dirOut.files.files) {
      assert.equal((await obj('beta', f.key)).status, 200)
      assert.equal((await obj('alfa', f.key)).status, 404)
    }
  } finally { await app.close?.() }
})
