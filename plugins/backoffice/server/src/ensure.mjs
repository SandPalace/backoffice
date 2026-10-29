// Asegura que el servidor local de Back Office esté corriendo. Lo usan el hook de SessionStart y el MCP.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { isMain, repoRoot } from './paths.mjs'
import { withLegacyEnv } from './env.mjs'

const PORT = Number(process.env.BACKOFFICE_PORT || 4780)
const BASE = `http://127.0.0.1:${PORT}`

export const baseUrl = BASE

async function healthy(ms = 400) {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(ms) })
    return r.ok
  } catch {
    return false
  }
}

/** What every surface says when the server is down and could not be started. */
export const DOWN_MESSAGE = 'Back Office está apagado: abre tu carpeta de Back Office y corre ./bin/backoffice start (o pídele a Claude «enciende Back Office»).'

const isBackOffice = (dir) => !!dir && existsSync(join(dir, '.claude-plugin', 'marketplace.json')) && existsSync(join(dir, 'plugins', 'backoffice'))
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

/**
 * Where this computer's Back Office folder is, WITHOUT relying on the caller's env. A plugin added from Claude Desktop
 * (Customize → Plugins, what Cowork loads) or a desktop extension does not get the `env` of ~/.claude/settings.json, so
 * the plugin-cache copy of this file looks, in order: BACKOFFICE_HOME/BACKOFFICE_ROOT → the clone this code runs from →
 * `env` in ~/.claude/settings.json → Claude Desktop's `mcpServers.backoffice.env` (both written by the installer) →
 * ~/Documents/AgentOS (where the public install has been cloned so far; the rename keeps that folder where it is).
 * An install not migrated yet still has AGENTOS_* names and `mcpServers.agentos`: both are read too (rename compat).
 * Read-only. Returns { home, root, repo } (repo null for an old ~/.agentos install) or null.
 */
export function locateInstall({ env = process.env, home = homedir(), repo = repoRoot() } = {}) {
  const fromVars = (raw) => {
    const v = raw && typeof raw === 'object' ? withLegacyEnv({ ...raw }) : null
    if (!v?.BACKOFFICE_HOME) return null
    const r = basename(v.BACKOFFICE_HOME) === 'data' && isBackOffice(dirname(v.BACKOFFICE_HOME)) ? dirname(v.BACKOFFICE_HOME) : null
    return { home: v.BACKOFFICE_HOME, root: v.BACKOFFICE_ROOT || (r ? join(r, 'workspaces') : join(home, 'AgentOS')), repo: r }
  }
  const fromRepo = (r) => (isBackOffice(r) ? { home: join(r, 'data'), root: join(r, 'workspaces'), repo: r } : null)
  const desktopDirs = [join(home, 'Library', 'Application Support', 'Claude'), join(home, '.config', 'Claude'), ...(env.APPDATA ? [join(env.APPDATA, 'Claude')] : [])]
  return (
    fromVars(env) ??
    fromRepo(repo) ??
    fromVars(readJson(join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json'))?.env) ??
    desktopDirs.map((d) => readJson(join(d, 'claude_desktop_config.json'))?.mcpServers).map((m) => fromVars((m?.backoffice ?? m?.agentos)?.env)).find(Boolean) ??
    fromRepo(join(home, 'Documents', 'AgentOS')) ??
    null
  )
}

// Node that can run the server (it needs node:sqlite, Node 22.5+). Claude Desktop may run plugins and extensions with its
// own built-in Node; if that one cannot, use the person's Node (the installer requires one). BACKOFFICE_NODE overrides.
export async function serverNode({ env = process.env } = {}) {
  if (env.BACKOFFICE_NODE) return env.BACKOFFICE_NODE
  if (!process.versions.electron) {
    try { await import('node:sqlite'); return process.execPath } catch { /* too old */ }
  }
  const win = process.platform === 'win32'
  const c = win ? [join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')] : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  return c.find((p) => existsSync(p)) ?? (win ? 'node.exe' : 'node')
}

// Starts the server of the person's own Back Office folder (not this plugin-cache copy: the server version must match their
// data), detached, with BACKOFFICE_HOME/ROOT set. Without a known folder nothing is started (it would create data outside
// the Back Office folder) and it returns false.
export async function ensureServer({ waitMs = 3000 } = {}) {
  if (await healthy()) return true
  const loc = locateInstall()
  if (!loc) return false
  const inRepo = loc.repo && join(loc.repo, 'plugins', 'backoffice', 'server', 'src', 'server.mjs')
  const serverJs = inRepo && existsSync(inRepo) ? inRepo : fileURLToPath(new URL('./server.mjs', import.meta.url))
  try {
    const logs = join(loc.home, 'logs')
    mkdirSync(logs, { recursive: true })
    const log = openSync(join(logs, 'server.log'), 'a')
    const child = spawn(await serverNode(), [serverJs], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, BACKOFFICE_HOME: loc.home, BACKOFFICE_ROOT: loc.root, BACKOFFICE_PORT: String(PORT) },
    })
    child.on('error', () => {})
    child.unref()
  } catch { return false }
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    if (await healthy()) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let raw = ''
  for await (const c of process.stdin) raw += c
  return raw
}

// Como hook de SessionStart: arranca el servidor y reenvía el evento (si no, el evento llegaría antes de que exista).
if (isMain(import.meta.url)) {
  try {
    const raw = await readStdin()
    if (await ensureServer() && raw.trim()) {
      const r = await fetch(`${BASE}/hooks/SessionStart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.BACKOFFICE_WORKSPACE ? { 'x-backoffice-workspace': process.env.BACKOFFICE_WORKSPACE } : {}) },
        body: raw,
        signal: AbortSignal.timeout(2000),
      })
      const text = await r.text()
      if (text) process.stdout.write(text) // contexto del agente en el equipo activo (additionalContext)
    }
  } catch {}
  process.exit(0) // un hook nunca debe fallar ni bloquear a Claude
}
