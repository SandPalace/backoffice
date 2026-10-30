// AgentOS → Back Office rename: the one-release compat shims keep an install that was not migrated yet working.
// Old MCP tool names (agentos_*), AGENTOS_* env vars (process env, data/.env, Claude's settings/Desktop config),
// X-AgentOS-* headers, the old session cookie, data/agentos.db and the default project named «AgentOS».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-compat-')))
process.env.BACKOFFICE_ROOT = ROOT
const { withLegacyEnv, newName } = await import('../src/env.mjs')
const { openDb, dbFileIn, MIGRATIONS } = await import('../src/db.mjs')
const { createApp } = await import('../src/server.mjs')
const { handle, canonicalTool } = await import('../src/mcp.mjs')
const { loadCredentials, parseCookie, COOKIE, LEGACY_COOKIE } = await import('../src/auth.mjs')
const { locateInstall } = await import('../src/ensure.mjs')

test('env: cada AGENTOS_* llena su BACKOFFICE_* si falta; el nuevo siempre gana', () => {
  assert.equal(newName('AGENTOS_HOME'), 'BACKOFFICE_HOME')
  assert.equal(newName('NEXT_PUBLIC_AGENTOS_PORT'), 'NEXT_PUBLIC_BACKOFFICE_PORT')
  assert.equal(newName('PATH'), null)
  const e = withLegacyEnv({ AGENTOS_HOME: '/old', AGENTOS_PORT: '4795', BACKOFFICE_PORT: '4796', AGENTOS_WA_URL: 'http://x', BACKOFFICE_ROOT: '', AGENTOS_ROOT: '/r' })
  assert.equal(e.BACKOFFICE_HOME, '/old')
  assert.equal(e.BACKOFFICE_PORT, '4796', 'el nombre nuevo gana')
  assert.equal(e.BACKOFFICE_WA_URL, 'http://x')
  assert.equal(e.BACKOFFICE_ROOT, '/r', 'vacío cuenta como no definido')
})

test('MCP: los nombres viejos agentos_* siguen funcionando, pero tools/list sólo muestra backoffice_*', async () => {
  const list = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const names = list.result.tools.map((t) => t.name)
  assert.ok(names.length > 10 && names.every((n) => n.startsWith('backoffice_')), names.join(', '))
  assert.equal(canonicalTool('agentos_task_create'), 'backoffice_task_create')
  assert.equal(canonicalTool('agentos_no_such_tool'), 'agentos_no_such_tool')
  assert.equal(canonicalTool('backoffice_overview'), 'backoffice_overview')
  const app = createApp({ db: openDb(':memory:'), port: 0, mcpKey: 'k' })
  const port = await app.listen()
  try {
    const call = async (name, args = {}) => (await (await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k', 'X-AgentOS-Agent': 'cmo' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })).json()).result
    const old = await call('agentos_task_create', { title: 'Por el nombre viejo' })
    assert.equal(old.isError, undefined, old.content?.[0]?.text)
    const listed = JSON.parse((await call('backoffice_task_list')).content[0].text)
    assert.deepEqual(listed.map((t) => t.title), ['Por el nombre viejo'])
    const unknown = await call('agentos_nope')
    assert.equal(unknown.isError, true)
  } finally { await app.close() }
})

test('cabeceras X-AgentOS-* (hooks y clientes MCP configurados antes) siguen valiendo', async () => {
  const db = openDb(':memory:')
  const app = createApp({ db, port: 4797 }) // the hook port check compares with the configured port (test range 4794-4799)
  const port = await app.listen()
  try {
    const hook = (headers) => fetch(`http://127.0.0.1:${port}/hooks/SessionStart`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ session_id: 'h1', cwd: join(ROOT, 'default', 'x'), agent_type: 'backoffice:cmo' }) })
    // Otro puerto con el nombre viejo: se ignora igual que con X-BackOffice-Port.
    await hook({ 'X-AgentOS-Port': '4799' })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0)
    // Cabecera nueva vacía (variable sin definir) + vieja con este puerto: cuenta la vieja.
    await hook({ 'X-BackOffice-Port': '', 'X-AgentOS-Port': String(port) })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1)
    const opt = await fetch(`http://127.0.0.1:${port}/api/tasks`, { method: 'OPTIONS', headers: { origin: 'http://localhost:4781' } })
    assert.match(opt.headers.get('access-control-allow-headers'), /x-backoffice-workspace.*x-agentos-workspace/)
  } finally { await app.close() }
})

test('auth: la cookie vieja sigue abriendo sesión; data/.env con AGENTOS_USER/AGENTOS_PASSWORD sigue valiendo', () => {
  assert.equal(parseCookie(`${LEGACY_COOKIE}=abc`), 'abc')
  assert.equal(parseCookie(`${LEGACY_COOKIE}=old; ${COOKIE}=new`), 'new', 'la nueva gana')
  assert.equal(parseCookie('otra=1', 'otra'), '1')
  const home = mkdtempSync(join(tmpdir(), 'backoffice-auth-'))
  writeFileSync(join(home, '.env'), 'AGENTOS_USER=ana\nAGENTOS_PASSWORD=clave-larga\n')
  assert.deepEqual(loadCredentials({ env: {}, home }).user, 'ana')
  assert.equal(loadCredentials({ env: { AGENTOS_PASSWORD: 'de-env' }, home }).password, 'de-env', 'env (nombre viejo) gana al archivo')
})

test('base: usa agentos.db mientras no exista backoffice.db; el proyecto «AgentOS» pasa a «Back Office» (si no lo renombraron)', () => {
  const home = mkdtempSync(join(tmpdir(), 'backoffice-db-'))
  assert.equal(dbFileIn(home), join(home, 'backoffice.db'))
  writeFileSync(join(home, 'agentos.db'), '')
  assert.equal(dbFileIn(home), join(home, 'agentos.db'), 'instalación sin migrar')
  writeFileSync(join(home, 'backoffice.db'), '')
  assert.equal(dbFileIn(home), join(home, 'backoffice.db'), 'migrada: la nueva gana')

  const seed = (name) => {
    const f = join(mkdtempSync(join(tmpdir(), 'backoffice-db-')), 'agentos.db')
    const old = new DatabaseSync(f)
    old.exec('CREATE TABLE _migrations (n INTEGER PRIMARY KEY)')
    // everything before the AgentOS → Back Office rename migration (later migrations may follow it)
    const rename = MIGRATIONS.findIndex((m) => typeof m === 'string' && m.includes("name = 'AgentOS'"))
    MIGRATIONS.slice(0, rename).forEach((sql, n) => {
      if (typeof sql === 'function') sql(old)
      else old.exec(sql)
      old.prepare('INSERT INTO _migrations (n) VALUES (?)').run(n)
    })
    old.prepare("UPDATE workspaces SET name = ? WHERE id = 'default'").run(name)
    old.close()
    const db = openDb(f)
    const n = db.prepare("SELECT name FROM workspaces WHERE id = 'default'").get().name
    db.close()
    return n
  }
  assert.equal(seed('AgentOS'), 'Back Office')
  assert.equal(seed('Mi negocio'), 'Mi negocio')
})

test('locateInstall: una instalación sin migrar (AGENTOS_HOME en settings.json, mcpServers.agentos en Desktop) se encuentra', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-loc-')))
  const repo = join(home, 'proyecto', 'bo')
  mkdirSync(join(repo, '.claude-plugin'), { recursive: true })
  mkdirSync(join(repo, 'plugins', 'backoffice'), { recursive: true })
  writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), '{}')
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { AGENTOS_HOME: join(repo, 'data') } }))
  assert.deepEqual(locateInstall({ env: {}, home, repo: null }), { home: join(repo, 'data'), root: join(repo, 'workspaces'), repo })
  writeFileSync(join(home, '.claude', 'settings.json'), '{}')
  const desk = join(home, 'Library', 'Application Support', 'Claude')
  mkdirSync(desk, { recursive: true })
  writeFileSync(join(desk, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { agentos: { command: 'node', args: [], env: { AGENTOS_HOME: join(repo, 'data') } } } }))
  assert.equal(locateInstall({ env: {}, home, repo: null }).repo, repo)
  assert.equal(locateInstall({ env: { AGENTOS_HOME: '/otra/data' }, home, repo: null }).home, '/otra/data', 'env del proceso con nombre viejo')
})
