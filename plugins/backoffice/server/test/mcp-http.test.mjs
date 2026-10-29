import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, cpSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'
import { handle } from '../src/mcp.mjs'
import { ensureMcpKey, mcpKeyFile, bearerOk } from '../src/auth.mjs'
import { locateInstall } from '../src/ensure.mjs'

const KEY = 'test-key-123'

async function withApp(fn, opts = {}) {
  const app = createApp({ db: openDb(':memory:'), port: 0, mcpKey: KEY, ...opts })
  const port = await app.listen()
  try { await fn(port) } finally { await app.close() }
}

const rpc = (port, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${KEY}`, ...headers },
    body: JSON.stringify(body),
  })

test('MCP HTTP: sin llave o con llave mala = 401 con WWW-Authenticate; sin llave configurada = 503', async () => {
  await withApp(async (port) => {
    const none = await rpc(port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: '' })
    assert.equal(none.status, 401)
    assert.match(none.headers.get('www-authenticate'), /^Bearer/)
    assert.match((await none.json()).message, /mcp-key/)
    assert.equal((await rpc(port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer nope' })).status, 401)
    // A foreign web page cannot even try.
    assert.equal((await rpc(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status, 403)
    // GET (SSE stream) is not offered.
    const get = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { authorization: `Bearer ${KEY}` } })
    assert.equal(get.status, 405)
  })
  await withApp(async (port) => {
    assert.equal((await rpc(port, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 503)
  }, { mcpKey: null })
})

test('MCP HTTP: initialize, tools/list (las mismas que stdio), tools/call, notificaciones y lotes', async () => {
  await withApp(async (port) => {
    const init = await (await rpc(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()
    assert.equal(init.result.serverInfo.name, 'backoffice')
    const note = await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(note.status, 202)

    const list = await (await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const stdio = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    assert.deepEqual(list.result.tools.map((t) => t.name), stdio.result.tools.map((t) => t.name))

    const ov = await (await rpc(port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'backoffice_overview', arguments: {} } })).json()
    assert.equal(ov.result.isError, undefined)
    assert.ok(JSON.parse(ov.result.content[0].text).roster)

    // X-BackOffice-Agent names the caller; X-BackOffice-Workspace scopes it.
    const t = await (await rpc(port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'backoffice_task_create', arguments: { title: 'Desde Codex' } } }, { 'x-backoffice-workspace': 'default' })).json()
    assert.equal(JSON.parse(t.result.content[0].text).title, 'Desde Codex')

    const pub = await (await rpc(port, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'backoffice_artifact_publish', arguments: { title: 'Post', name: 'post.md', content: '# Hola' } } }, { 'x-backoffice-agent': 'cmo' })).json()
    const art = JSON.parse(pub.result.content[0].text)
    assert.equal(art.author_agent, 'cmo')
    assert.equal(art.link, `http://localhost:4781/canvas?ws=default&artifact=${encodeURIComponent(art.id)}`)

    const batch = await (await rpc(port, [{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 7, method: 'nope' }])).json()
    assert.equal(batch.length, 2)
    assert.equal(batch[1].error.code, -32601)

    const bad = await (await rpc(port, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'backoffice_overview', arguments: { workspace: 'nope' } } })).json()
    assert.equal(bad.result.isError, true)
    assert.match(bad.result.content[0].text, /Unknown workspace/)
  })
})

test('MCP stdio: servidor apagado y carpeta de Back Office desconocida = error claro en español, no silencio', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-nohome-'))) // isMain compares real paths (macOS /var -> /private/var)
  // A copy laid out like the plugin cache (~/.claude/plugins/cache/backoffice/backoffice/<v>/server/src): not inside a clone.
  const src = join(home, 'cache', 'backoffice', 'backoffice', '9.9.9', 'server', 'src')
  cpSync(new URL('../src', import.meta.url).pathname, src, { recursive: true })
  const child = spawn(process.execPath, [join(src, 'mcp.mjs')], {
    // Nothing tells it where Back Office is (no env, empty HOME, cwd outside any clone) and port 1 never answers.
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, BACKOFFICE_PORT: '1' },
    cwd: home,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let buf = ''
  const got = new Promise((resolve) => child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) resolve(JSON.parse(buf.split('\n')[0])) }))
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'backoffice_overview', arguments: {} } }) + '\n')
  try {
    const r = await got
    assert.equal(r.result.isError, true)
    assert.match(r.result.content[0].text, /Back Office está apagado.*\.\/bin\/backoffice start/)
  } finally { child.kill() }
})

test('locateInstall: env > clon > settings.json de Claude > config de Claude Desktop > ~/Documents/AgentOS', () => {
  const home = mkdtempSync(join(tmpdir(), 'backoffice-loc-'))
  const clone = join(home, 'Documents', 'AgentOS')
  mkdirSync(join(clone, '.claude-plugin'), { recursive: true })
  mkdirSync(join(clone, 'plugins', 'backoffice'), { recursive: true })
  writeFileSync(join(clone, '.claude-plugin', 'marketplace.json'), '{}')
  assert.deepEqual(locateInstall({ env: {}, home, repo: null }), { home: join(clone, 'data'), root: join(clone, 'workspaces'), repo: clone })

  const other = join(home, 'Elsewhere')
  mkdirSync(join(other, '.claude-plugin'), { recursive: true })
  mkdirSync(join(other, 'plugins', 'backoffice'), { recursive: true })
  writeFileSync(join(other, '.claude-plugin', 'marketplace.json'), '{}')
  const desk = join(home, 'Library', 'Application Support', 'Claude')
  mkdirSync(desk, { recursive: true })
  writeFileSync(join(desk, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { backoffice: { env: { BACKOFFICE_HOME: join(other, 'data'), BACKOFFICE_ROOT: join(other, 'workspaces') } } } }))
  assert.equal(locateInstall({ env: {}, home, repo: null }).repo, other)

  const third = join(home, 'Third')
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { BACKOFFICE_HOME: join(third, 'data') } }))
  assert.deepEqual(locateInstall({ env: {}, home, repo: null }), { home: join(third, 'data'), root: join(home, 'AgentOS'), repo: null })

  assert.equal(locateInstall({ env: { BACKOFFICE_HOME: join(clone, 'data') }, home, repo: null }).repo, clone)
  assert.equal(locateInstall({ env: {}, home: join(home, 'nobody'), repo: null }), null)
})

test('llave del MCP HTTP: se crea una vez, 0600, y bearerOk compara', () => {
  const home = mkdtempSync(join(tmpdir(), 'backoffice-key-'))
  const k = ensureMcpKey(home)
  assert.ok(k.length >= 40)
  assert.equal(ensureMcpKey(home), k)
  assert.equal(readFileSync(mcpKeyFile(home), 'utf8').trim(), k)
  if (process.platform !== 'win32') assert.equal(statSync(mcpKeyFile(home)).mode & 0o777, 0o600)
  assert.ok(bearerOk(`Bearer ${k}`, k))
  assert.ok(!bearerOk(`Bearer ${k}x`, k))
  assert.ok(!bearerOk(undefined, k))
  assert.ok(!bearerOk(`Bearer ${k}`, null))
})
