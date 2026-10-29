// Roster global: los equipos del plugin `backoffice`, con sus agentes y skills (no depende del workspace).
// Un equipo = `teams/<id>/team.json` ({ id, name, description, agents: [ids], skills: [ids], optional_skills?, system? });
// los agentes viven en `agents/<id>.md` y las skills en `skills/<id>/SKILL.md`, compartidos por todo el plugin.
// Una sola implementación del escaneo: la usan scripts/build-roster.mjs y el fallback del servidor. Sin dependencias.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_DESC = 300
export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // plugins/backoffice (o su copia en la caché de Claude)
export const ROSTER_FILE = join(PLUGIN_ROOT, 'roster.json') // plugins/backoffice/roster.json

const trim = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…'
}

// Frontmatter plano (`key: value`, con continuaciones indentadas y comillas opcionales). Suficiente para agents/*.md y SKILL.md.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  if (!m) return out
  let key = null
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv && !/^\s/.test(line)) {
      key = kv[1]
      out[key] = kv[2].replace(/^(["'])(.*)\1$/, '$2').replace(/^[>|][-+]?$/, '')
    } else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim()
  }
  return out
}

const dirs = (p) => { try { return readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()).sort() } catch { return [] } }
const files = (p, ext) => { try { return readdirSync(p).filter((n) => n.endsWith(ext)).sort() } catch { return [] } }
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

const readAgent = (root, id) => {
  const f = join(root, 'agents', `${id}.md`)
  if (!existsSync(f)) return null
  const fm = parseFrontmatter(readFileSync(f, 'utf8'))
  return { id: String(fm.name || id).toLowerCase(), description: trim(fm.description, MAX_DESC), model: fm.model || null }
}
const readSkill = (root, id) => {
  const f = join(root, 'skills', id, 'SKILL.md')
  if (!existsSync(f)) return null
  const fm = parseFrontmatter(readFileSync(f, 'utf8'))
  return { id: String(fm.name || id), description: trim(fm.description, MAX_DESC) }
}
const teamFiles = (root) => dirs(join(root, 'teams')).map((d) => ({ dir: d, json: readJson(join(root, 'teams', d, 'team.json')) })).filter((t) => t.json)

// Equipos del plugin con sus agentes y skills resueltos. Forma de salida = la de siempre ({ id, description, agents, skills }
// por grupo) para que el servidor y la web no cambien. Un id listado que no existe se omite (validateTeams lo reporta);
// `optional_skills` son las que pueden faltar (p. ej. tesseract-motion, solo en la copia del dueño).
export function scanTeams(pluginRoot = PLUGIN_ROOT) {
  const teams = []
  for (const { dir, json } of teamFiles(pluginRoot)) {
    const pick = (ids, fn) => (Array.isArray(ids) ? ids : []).map((id) => { try { return fn(pluginRoot, String(id)) } catch { return null } }).filter(Boolean)
    const agents = pick(json.agents, readAgent).sort((a, b) => a.id.localeCompare(b.id))
    const skills = pick([...(json.skills ?? []), ...(json.optional_skills ?? [])], readSkill).sort((a, b) => a.id.localeCompare(b.id))
    teams.push({ id: String(json.id || dir), description: trim(json.description, MAX_DESC), agents, skills })
  }
  return teams.sort((a, b) => a.id.localeCompare(b.id))
}

// Errores de consistencia: cada agente y skill del plugin pertenece a exactamente un equipo, cada id listado existe,
// el id del equipo = su carpeta y el `name` del frontmatter = el nombre del archivo. [] = todo bien.
export function validateTeams(pluginRoot = PLUGIN_ROOT) {
  const errors = []
  const owner = new Map() // 'agent:x' | 'skill:x' -> [team ids]
  const seen = new Set()
  const ts = teamFiles(pluginRoot)
  if (!ts.length) errors.push(`no teams in ${join(pluginRoot, 'teams')}`)
  for (const { dir, json } of ts) {
    const id = String(json.id ?? '')
    if (id !== dir) errors.push(`teams/${dir}/team.json: id «${id}» must equal its folder`)
    if (seen.has(id)) errors.push(`duplicate team id «${id}»`)
    seen.add(id)
    if (!String(json.name ?? '').trim()) errors.push(`team ${id}: missing name`)
    for (const [kind, list, optional] of [['agent', json.agents, false], ['skill', json.skills, false], ['skill', json.optional_skills, true]]) {
      for (const x of Array.isArray(list) ? list : []) {
        const k = `${kind}:${x}`
        owner.set(k, [...(owner.get(k) ?? []), id])
        const f = kind === 'agent' ? join(pluginRoot, 'agents', `${x}.md`) : join(pluginRoot, 'skills', x, 'SKILL.md')
        if (!existsSync(f)) { if (!optional) errors.push(`team ${id}: ${kind} «${x}» does not exist (${kind === 'agent' ? `agents/${x}.md` : `skills/${x}/SKILL.md`})`); continue }
        const name = parseFrontmatter(readFileSync(f, 'utf8')).name
        if (name && String(name).toLowerCase() !== String(x)) errors.push(`${kind} «${x}»: frontmatter name «${name}» must equal the file name`)
      }
    }
  }
  for (const f of files(join(pluginRoot, 'agents'), '.md')) if (!owner.has(`agent:${f.replace(/\.md$/, '')}`)) errors.push(`agent «${f.replace(/\.md$/, '')}» belongs to no team`)
  for (const s of dirs(join(pluginRoot, 'skills'))) if (existsSync(join(pluginRoot, 'skills', s, 'SKILL.md')) && !owner.has(`skill:${s}`)) errors.push(`skill «${s}» belongs to no team`)
  for (const [k, owners] of owner) if (owners.length > 1) errors.push(`${k.replace(':', ' «')}» is in more than one team: ${owners.join(', ')}`)
  return errors
}

// Contenido del archivo sin `generated_at` (lo que se compara para saber si cambió).
export const rosterContent = (pluginRoot) => ({ plugins: scanTeams(pluginRoot) })

// Carga roster.json; si falta o está dañado, escanea los equipos del plugin. Nunca lanza.
export function loadRoster({ file = ROSTER_FILE, pluginRoot = PLUGIN_ROOT } = {}) {
  const j = readJson(file)
  if (j && Array.isArray(j.plugins)) return { generated_at: j.generated_at ?? null, plugins: j.plugins, source: 'roster.json' }
  try { return { generated_at: null, plugins: scanTeams(pluginRoot), source: 'scan' } } catch { return { generated_at: null, plugins: [], source: 'empty' } }
}
