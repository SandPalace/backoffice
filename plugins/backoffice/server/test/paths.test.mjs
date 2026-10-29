import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pathInside, isMain } from '../src/paths.mjs'

test('pathInside con rutas de Windows: sin distinguir mayúsculas y con separador', () => {
  const w = path.win32
  assert.ok(pathInside('C:\\Users\\Ana\\AgentOS\\acme\\x', 'c:\\users\\ana\\agentos', w))
  assert.ok(pathInside('C:\\Users\\Ana\\AgentOS', 'C:\\Users\\Ana\\AgentOS\\', w))
  assert.ok(!pathInside('C:\\Users\\Ana\\AgentOS2', 'C:\\Users\\Ana\\AgentOS', w))
  assert.ok(!pathInside('D:\\Users\\Ana\\AgentOS\\x', 'C:\\Users\\Ana\\AgentOS', w))
})

test('pathInside posix distingue mayúsculas', () => {
  const p = path.posix
  assert.ok(pathInside('/a/b/c', '/a/b', p))
  assert.ok(!pathInside('/a/bc', '/a/b', p))
  assert.ok(!pathInside('/a/B/c', '/a/b', p))
})

test('isMain compara rutas reales, no strings de file://', () => {
  const f = path.resolve('x.mjs')
  assert.ok(isMain(pathToFileURL(f).href, f))
  assert.ok(!isMain(pathToFileURL(f).href, path.resolve('y.mjs')))
  assert.ok(!isMain(pathToFileURL(f).href, undefined))
})

test('backofficeHome/backofficeRoot: variable > estructura vieja sin migrar > carpeta del proyecto', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir, homedir } = await import('node:os')
  const { join } = await import('node:path')
  const { backofficeHome, backofficeRoot, repoRoot, legacyHome } = await import('../src/paths.mjs')
  const repo = mkdtempSync(join(tmpdir(), 'backoffice-repo-'))
  assert.equal(repoRoot(repo), null, 'sin marketplace no es el proyecto')
  mkdirSync(join(repo, '.claude-plugin')); writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), '{}')
  assert.equal(repoRoot(repo), repo)
  assert.equal(backofficeHome({ env: { BACKOFFICE_HOME: '/x' }, repo }), '/x')
  assert.equal(backofficeHome({ env: {}, repo: null }), join(homedir(), '.agentos'), 'desde la caché de plugins sin variable: la vieja')
  mkdirSync(join(repo, 'data'))
  assert.equal(backofficeHome({ env: {}, repo }), join(repo, 'data'), 'si ya existe la nueva, gana')
  assert.equal(backofficeRoot({ env: { BACKOFFICE_ROOT: '/r' }, repo }), '/r')
  const home = process.env.HOME; process.env.HOME = mkdtempSync(join(tmpdir(), 'backoffice-home-')) // sin ~/AgentOS viejo
  try { assert.equal(backofficeRoot({ env: {}, repo }), join(repo, 'workspaces')) } finally { process.env.HOME = home }
  assert.equal(legacyHome(), join(homedir(), '.agentos'))
})

test('workspaceDir/defaultWorkspaceRoot: estructura nueva plana, la vieja sin migrar no se mueve', async () => {
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const { isLegacyLayout, defaultWorkspaceRoot, workspaceDir } = await import('../src/paths.mjs')
  const fresh = join('/r', 'workspaces')
  assert.equal(isLegacyLayout(fresh), false)
  assert.equal(defaultWorkspaceRoot(fresh), join(fresh, 'default'))
  assert.equal(workspaceDir('acme', fresh), join(fresh, 'acme'))
  const old = join(homedir(), 'AgentOS')
  assert.equal(isLegacyLayout(old), true)
  assert.equal(defaultWorkspaceRoot(old), old)
  assert.equal(workspaceDir('acme', old), join(old, 'workspaces', 'acme'))
})
