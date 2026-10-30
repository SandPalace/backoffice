// Helpers de rutas que funcionan igual en macOS, Linux y Windows.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import './env.mjs' // rename compat: AGENTOS_* → BACKOFFICE_* fallback in the process env, before anything reads it
import './company-file.mjs' // a per-company plugin's company.json (folder + ports) wins over env; no-op in the generic plugin

// ¿Este módulo es el programa principal? (`file://${argv[1]}` falla en Windows: file:///C:/...)
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  const real = (p) => { try { return realpathSync(p) } catch { return path.resolve(p) } } // /var vs /private/var, symlinked plugin folders
  try { return real(fileURLToPath(metaUrl)) === real(argv1) } catch { return false }
}

// ¿`p` es `root` o está dentro? En Windows se compara sin distinguir mayúsculas. `mod` permite probar con path.win32.
export function pathInside(p, root, mod = path) {
  const ci = mod === path.win32 || (mod === path && process.platform === 'win32')
  let c = mod.resolve(p), r = mod.resolve(root)
  if (ci) { c = c.toLowerCase(); r = r.toLowerCase() }
  return c === r || c.startsWith(r.endsWith(mod.sep) ? r : r + mod.sep)
}

// ── Dónde viven los datos ──
// Estructura actual: todo dentro de la carpeta del proyecto (el clon):
//   <proyecto>/data      → base de datos, archivos, .env, logs, navegador, WhatsApp   (BACKOFFICE_HOME)
//   <proyecto>/workspaces → carpetas de trabajo de cada workspace: workspaces/default, workspaces/<id> (BACKOFFICE_ROOT)
// Estructura vieja: ~/.agentos y ~/AgentOS. Si existe la vieja y todavía no la nueva, se sigue usando la vieja
// (nada desaparece antes de migrar con scripts/migrate-to-project-folder.mjs).
// Hooks y MCP corren desde la copia del plugin en ~/.claude/plugins/cache: ahí no hay proyecto y mandan las variables
// BACKOFFICE_HOME/BACKOFFICE_ROOT que el instalador pone en ~/.claude/settings.json.
const REPO_FROM_HERE = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..')

/** Carpeta del proyecto (clon) si este código corre desde él; null si corre desde la caché de plugins. */
export function repoRoot(dir = REPO_FROM_HERE) {
  return existsSync(path.join(dir, '.claude-plugin', 'marketplace.json')) ? dir : null
}

export const legacyHome = () => path.join(homedir(), '.agentos')
export const legacyRoot = () => path.join(homedir(), 'AgentOS')

function pick(envValue, legacy, sub, repo) {
  if (envValue) return envValue
  if (!repo) return legacy
  const fresh = path.join(repo, sub)
  return existsSync(legacy) && !existsSync(fresh) ? legacy : fresh
}

/** Datos de Back Office (antes ~/.agentos). */
export const backofficeHome = ({ env = process.env, repo = repoRoot() } = {}) => pick(env.BACKOFFICE_HOME, legacyHome(), 'data', repo)
/** Carpetas de trabajo de los proyectos (antes ~/AgentOS). */
export const backofficeRoot = ({ env = process.env, repo = repoRoot() } = {}) => pick(env.BACKOFFICE_ROOT, legacyRoot(), 'workspaces', repo)

// ── Carpeta de cada workspace ──
// Estructura nueva (BACKOFFICE_ROOT = <proyecto>/workspaces): default = <root>/default, los demás = <root>/<id>.
// Estructura vieja sin migrar (BACKOFFICE_ROOT = ~/AgentOS): default = ~/AgentOS, los demás = ~/AgentOS/workspaces/<id>.
// Así a quien no ha migrado no se le mueve nada.
export function isLegacyLayout(root = backofficeRoot()) {
  return pathInside(root, legacyRoot()) && pathInside(legacyRoot(), root)
}
export const defaultWorkspaceRoot = (root = backofficeRoot()) => isLegacyLayout(root) ? root : path.join(root, 'default')
export const workspaceDir = (id, root = backofficeRoot()) => isLegacyLayout(root) ? path.join(root, 'workspaces', id) : path.join(root, id)
