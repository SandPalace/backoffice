import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-root-')))
process.env.BACKOFFICE_ROOT = ROOT
const { openDb } = await import('../src/db.mjs')
const { createApp } = await import('../src/server.mjs')
const { loadCredentials, parseEnv, looseFiles } = await import('../src/auth.mjs')

const ORIGIN = 'http://localhost:4781'
async function boot(creds = { user: 'ana', password: 'una-clave-larga' }) {
  const box = { creds }
  const db = openDb(':memory:')
  const app = createApp({ db, port: 0, auth: { credentials: () => box.creds } })
  const port = await app.listen()
  const base = `http://127.0.0.1:${port}`
  // `browser` imita a la web: manda Origin y la cookie de sesión.
  const call = async (method, path, { body, browser = false, cookie } = {}) => {
    const headers = { 'content-type': 'application/json' }
    if (browser) headers.origin = ORIGIN
    if (cookie) headers.cookie = cookie
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null, setCookie: r.headers.get('set-cookie'), cors: r.headers.get('access-control-allow-credentials') }
  }
  const login = (user, password) => call('POST', '/api/auth/login', { browser: true, body: { user, password } })
  return { app, call, login, box, db }
}
const sessionCookie = (setCookie) => setCookie.split(';')[0]

test('sin credenciales configuradas: el estado lo dice, nadie entra desde el navegador y el login explica qué hacer', async () => {
  const { app, call, login } = await boot(null)
  const s = await call('GET', '/api/auth/status', { browser: true })
  assert.deepEqual([s.status, s.body.enabled, s.body.configured, s.body.authenticated, s.body.user], [200, true, false, false, null])
  assert.equal(s.cors, 'true', 'CORS con credenciales para la web local')
  assert.equal((await call('GET', '/api/workspaces', { browser: true })).status, 401)
  const l = await login('ana', 'x')
  assert.equal(l.status, 409)
  assert.match(l.body.message, /BACKOFFICE_USER/)
  assert.equal((await call('POST', '/api/auth/setup', { browser: true, body: { name: 'x', password: 'yyyyyyyy' } })).status, 401, 'ya no se crean cuentas desde la web')
  await app.close()
})

test('los procesos locales (hooks, MCP, curl: sin Origin) no pasan por el login', async () => {
  const { app, call } = await boot()
  assert.equal((await call('GET', '/api/workspaces')).status, 200)
  assert.equal((await call('POST', '/hooks/SessionStart', { body: { session_id: 'x', cwd: '/tmp' } })).status, 200)
  await app.close()
})

test('entrar con el usuario y contraseña del .env → cookie HttpOnly → salir', async () => {
  const { app, call, login } = await boot()
  assert.equal((await login('ana', 'mala')).status, 401)
  assert.equal((await login('otra', 'una-clave-larga')).status, 401, 'el usuario también cuenta')
  const ok = await login('ana', 'una-clave-larga')
  assert.equal(ok.status, 200)
  assert.match(ok.setCookie, /HttpOnly/)
  assert.match(ok.setCookie, /SameSite=Lax/)
  const cookie = sessionCookie(ok.setCookie)
  assert.equal((await call('GET', '/api/workspaces', { browser: true, cookie })).status, 200)
  const st = await call('GET', '/api/auth/status', { browser: true, cookie })
  assert.deepEqual([st.body.configured, st.body.authenticated, st.body.user], [true, true, 'ana'])
  await call('POST', '/api/auth/logout', { browser: true, cookie })
  assert.equal((await call('GET', '/api/workspaces', { browser: true, cookie })).status, 401, 'la cookie ya no sirve')
  await app.close()
})

test('si cambian la contraseña en el archivo, las sesiones abiertas dejan de valer', async () => {
  const { app, call, login, box } = await boot()
  const cookie = sessionCookie((await login('ana', 'una-clave-larga')).setCookie)
  box.creds = { user: 'ana', password: 'otra-clave-nueva' }
  assert.equal((await call('GET', '/api/workspaces', { browser: true, cookie })).status, 401)
  assert.equal((await login('ana', 'otra-clave-nueva')).status, 200)
  await app.close()
})

test('bloqueo de un minuto tras 5 intentos fallidos', async () => {
  const { app, login } = await boot()
  for (let i = 0; i < 5; i++) assert.equal((await login('ana', 'mala' + i)).status, 401)
  assert.equal((await login('ana', 'una-clave-larga')).status, 429)
  await app.close()
})

test('la base no guarda ni la contraseña ni el token de la cookie', async () => {
  const { app, login, db } = await boot()
  const token = sessionCookie((await login('ana', 'una-clave-larga')).setCookie).split('=')[1]
  const dump = JSON.stringify([db.prepare('SELECT * FROM settings').all(), db.prepare('SELECT * FROM auth_sessions').all()])
  assert.ok(!dump.includes('una-clave-larga'))
  assert.ok(!dump.includes(token))
  await app.close()
})

test('con auth apagada (BACKOFFICE_AUTH=off) el navegador entra sin sesión', async () => {
  const app = createApp({ db: openDb(':memory:'), port: 0, auth: false })
  const port = await app.listen()
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/workspaces`, { headers: { origin: ORIGIN } })).status, 200)
  const s = await (await fetch(`http://127.0.0.1:${port}/api/auth/status`, { headers: { origin: ORIGIN } })).json()
  assert.equal(s.authenticated, true)
  await app.close()
})

test('credenciales: variables de entorno > ~/.agentos/.env > ~/.agentos/config.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'backoffice-home-'))
  assert.equal(loadCredentials({ env: {}, home }), null)
  writeFileSync(join(home, 'config.json'), JSON.stringify({ user: 'json-user', password: 'json-pass' }))
  assert.deepEqual(loadCredentials({ env: {}, home }).user, 'json-user')
  writeFileSync(join(home, '.env'), '# comentario\nexport BACKOFFICE_USER="env-file-user"\nBACKOFFICE_PASSWORD=\'con # gato\'\n')
  const c = loadCredentials({ env: {}, home })
  assert.deepEqual([c.user, c.password], ['env-file-user', 'con # gato'])
  const e = loadCredentials({ env: { BACKOFFICE_USER: 'var-user', BACKOFFICE_PASSWORD: 'var-pass' }, home })
  assert.deepEqual([e.user, e.password], ['var-user', 'var-pass'])
  // un archivo que otros usuarios pueden leer se reporta (chmod 600 lo arregla)
  if (process.platform !== 'win32') {
    chmodSync(join(home, '.env'), 0o644)
    assert.ok(looseFiles(c).includes(join(home, '.env')))
    chmodSync(join(home, '.env'), 0o600)
    assert.ok(!looseFiles(c).includes(join(home, '.env')))
  }
})

test('parseEnv: comentarios, export, comillas y comentario al final de la línea', () => {
  assert.deepEqual(parseEnv('A=1\n# x\nexport B = dos # nota\nC="tres # no es nota"\n\nmal linea'), { A: '1', B: 'dos', C: 'tres # no es nota' })
})
