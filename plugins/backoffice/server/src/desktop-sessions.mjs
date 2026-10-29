// Best-effort, read-only listing of the owner's Claude Desktop sessions: Code and Cowork.
// Undocumented layout: <desktop>/claude-code-sessions/<uuid>/<uuid>/local_<uuid>.json (Code) and
// <desktop>/local-agent-mode-sessions/<uuid>/<uuid>/local_<uuid>.json (Cowork). Never throws.
import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { homedir } from 'node:os'
import { pathInside } from './paths.mjs'

const MAX_SESSIONS = 300
const MAX_FILE_BYTES = 5 * 1024 * 1024 // los archivos de Desktop guardan historial y pasan de 500 KB

// Folder that contains `claude-code-sessions` (env CLAUDE_DESKTOP_DIR overrides).
export function desktopDir() {
  if (process.env.CLAUDE_DESKTOP_DIR) return process.env.CLAUDE_DESKTOP_DIR
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude')
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude')
  return join(homedir(), '.config', 'Claude')
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const ms = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const real = (p) => {
  try { return realpathSync(p) } catch { /* may not exist anymore: resolve the nearest existing parent */ }
  const i = p.lastIndexOf(sep)
  return i > 0 ? join(real(p.slice(0, i)), p.slice(i + 1)) : p
}
const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return [] } }

export function isInside(cwd, root) {
  if (!cwd || !root) return false
  const c = real(cwd), r = real(root)
  return pathInside(c, r)
}

// Carpeta de cada superficie de Desktop. En Cowork el `cwd` es la VM; la carpeta real es la que eligió la persona.
const SURFACES = [['code', 'claude-code-sessions'], ['cowork', 'local-agent-mode-sessions']]

export function listDesktopCodeSessions({ dir = desktopDir(), workspaceRoot = null } = {}) {
  const out = []
  for (const [surface, folder] of SURFACES) try {
    const base = join(dir, folder)
    for (const a of dirs(base)) for (const b of dirs(join(base, a))) {
      let names = []
      try { names = readdirSync(join(base, a, b)) } catch { continue }
      for (const n of names) {
        if (!/^local_[\w-]+\.json$/.test(n)) continue
        try {
          const f = join(base, a, b, n)
          if (statSync(f).size > MAX_FILE_BYTES) continue
          const j = JSON.parse(readFileSync(f, 'utf8'))
          const id = str(j?.sessionId, 120)
          if (!/^local_[\w-]+$/.test(id)) continue
          const cwd = surface === 'cowork' ? (Array.isArray(j.userSelectedFolders) ? str(j.userSelectedFolders[0], 500) : '') : str(j.cwd, 500) || str(j.originCwd, 500)
          const createdAt = ms(j.createdAt)
          const lastActivityAt = ms(j.lastActivityAt) ?? createdAt
          const s = { id, cliId: str(j.cliSessionId, 120), title: str(j.title, 200), cwd, createdAt, lastActivityAt, archived: j.isArchived === true, model: str(j.model, 100), surface }
          if (workspaceRoot) s.inProject = isInside(cwd, workspaceRoot)
          out.push(s)
        } catch { /* malformed file: skip */ }
      }
    }
  } catch { /* unreadable dir */ }
  out.sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))
  return out.slice(0, MAX_SESSIONS)
}

export function desktopCodeSessions(opts = {}) {
  const dir = opts.dir ?? desktopDir()
  let available = false
  for (const [, folder] of SURFACES) try { available ||= statSync(join(dir, folder)).isDirectory() } catch { /* none */ }
  return { available, sessions: available ? listDesktopCodeSessions({ ...opts, dir }) : [] }
}
