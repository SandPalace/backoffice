// Definiciones editables de agentes (archivos .md de Claude). Dos copias posibles por agente:
//   global   → <claude home>/agents/<id>.md   (vale para cualquier carpeta; sirve de plantilla)
//   project  → <raíz del workspace>/.claude/agents/<id>.md   (solo sesiones abiertas en ese proyecto)
// Lo que se muestra cuando no hay copia: proyecto → global → plugin. El plugin nunca se edita desde aquí.
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AppError } from './store.mjs'
import { PLUGIN_ROOT, parseFrontmatter, scanTeams } from './roster.mjs'

export const MAX_DEF_BYTES = 64 * 1024
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export const claudeHome = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

const read = (f) => { try { return statSync(f).size <= MAX_DEF_BYTES ? readFileSync(f, 'utf8') : null } catch { return null } }

export function createAgentDefs({ pluginRoot = PLUGIN_ROOT, home = claudeHome() } = {}) {
  // id → equipo que lo trae. Solo se pueden editar agentes que existen en el plugin.
  const owners = () => {
    const m = new Map()
    for (const p of scanTeams(pluginRoot)) for (const a of p.agents) if (!m.has(a.id)) m.set(a.id, p.id)
    return m
  }
  // Todos los agentes viven en <plugin>/agents/<id>.md (los equipos solo los agrupan).
  const pluginFile = (id) => {
    const f = join(pluginRoot, 'agents', `${id}.md`)
    return existsSync(f) ? f : null
  }
  const checkId = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError('bad_request', 'Id de agente inválido', 400)
    const plugin = owners().get(id)
    if (!plugin) throw new AppError('not_found', `No conozco al agente «${id}»`, 404)
    return plugin
  }
  const fileOf = (id, scope, root) => {
    if (scope === 'global') return join(home, 'agents', `${id}.md`)
    if (scope !== 'project') throw new AppError('bad_request', 'scope debe ser project o global', 400)
    if (!root) throw new AppError('bad_request', 'Este proyecto no tiene carpeta', 400)
    return join(root, '.claude', 'agents', `${id}.md`)
  }

  function get(id, { scope, root = null }) {
    const plugin = checkId(id)
    const file = fileOf(id, scope, root)
    const own = read(file)
    if (own != null) return { id, plugin, scope, file, exists: true, source: scope, content: own }
    const g = scope === 'project' ? read(fileOf(id, 'global')) : null
    if (g != null) return { id, plugin, scope, file, exists: false, source: 'global', content: g }
    const pf = pluginFile(id)
    return { id, plugin, scope, file, exists: false, source: 'plugin', content: (pf && read(pf)) ?? '' }
  }

  function list({ scope, root = null }) {
    return [...owners()].map(([id, plugin]) => ({ id, plugin, exists: existsSync(fileOf(id, scope, root)) })).sort((a, b) => a.plugin.localeCompare(b.plugin) || a.id.localeCompare(b.id))
  }

  function put(id, { scope, root = null, content }) {
    checkId(id)
    if (typeof content !== 'string' || !content.trim()) throw new AppError('bad_request', 'El archivo está vacío', 400)
    if (Buffer.byteLength(content) > MAX_DEF_BYTES) throw new AppError('bad_request', 'El archivo pasa de 64 KB', 400)
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(content)) throw new AppError('bad_request', 'Falta el encabezado (frontmatter) entre líneas ---', 400)
    // El nombre es como Claude y la oficina reconocen al agente: no se cambia aquí.
    if (String(parseFrontmatter(content).name ?? '').trim().toLowerCase() !== id) throw new AppError('bad_request', `El encabezado debe decir name: ${id}`, 400)
    const file = fileOf(id, scope, root)
    mkdirSync(join(file, '..'), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, content.endsWith('\n') ? content : `${content}\n`)
    renameSync(tmp, file)
    return get(id, { scope, root })
  }

  function remove(id, { scope, root = null }) {
    checkId(id)
    const file = fileOf(id, scope, root)
    try { unlinkSync(file) } catch (e) { if (e.code !== 'ENOENT') throw e }
    return get(id, { scope, root })
  }

  return { get, list, put, remove }
}
