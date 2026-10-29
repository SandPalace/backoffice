#!/usr/bin/env node
// Pasa una instalación vieja de Back Office (~/.agentos y ~/AgentOS) a la carpeta del proyecto:
//   ~/.agentos  → <proyecto>/data        ~/AgentOS → <proyecto>/workspaces (default = ~/AgentOS menos workspaces/ → workspaces/default; ~/AgentOS/workspaces/<id> → workspaces/<id>)
// Uso: node scripts/migrate-to-project-folder.mjs            (solo muestra el plan)
//      node scripts/migrate-to-project-folder.mjs --yes      (lo hace)
// Copia (no borra): las carpetas viejas quedan renombradas como respaldo (~/.agentos.migrado-<fecha>) para borrarlas a mano.
// Además reescribe las rutas guardadas en la base (workspaces.root, outputs.path, sessions.cwd) y publica BACKOFFICE_HOME/BACKOFFICE_ROOT
// en ~/.claude/settings.json y en el MCP `backoffice` de Claude Desktop (con respaldo .backoffice-backup). Sin dependencias.
import { existsSync, cpSync, renameSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const YES = process.argv.includes('--yes')
const PORT = Number(process.env.BACKOFFICE_PORT || 4780)
const OLD_HOME = join(homedir(), '.agentos'), OLD_ROOT = join(homedir(), 'AgentOS')
const NEW_HOME = join(REPO, 'data'), NEW_ROOT = join(REPO, 'workspaces')
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const say = (s) => console.log(s)

if (!existsSync(join(REPO, '.claude-plugin', 'marketplace.json'))) { say(`No parece la carpeta de Back Office: ${REPO}`); process.exit(1) }

const plan = []
if (existsSync(OLD_HOME)) plan.push(existsSync(NEW_HOME) ? `OJO: ya existen ${OLD_HOME} y ${NEW_HOME}; no copio datos (revisa a mano cuál conservar).` : `Copiar ${OLD_HOME} → ${NEW_HOME}`)
if (existsSync(OLD_ROOT)) plan.push(existsSync(NEW_ROOT) ? `OJO: ya existen ${OLD_ROOT} y ${NEW_ROOT}; no copio workspaces.` : `Copiar ${OLD_ROOT}/workspaces/<id> → ${NEW_ROOT}/<id> y el resto de ${OLD_ROOT} → ${NEW_ROOT}/default`)
if (!plan.length) { say('No hay estructura vieja (~/.agentos ni ~/AgentOS). Nada que migrar.'); process.exit(0) }
plan.push(`Reescribir rutas en la base: ${OLD_ROOT}/workspaces/ → ${NEW_ROOT}/ y ${OLD_ROOT} → ${NEW_ROOT}/default`)
plan.push(`Poner BACKOFFICE_HOME=${NEW_HOME} y BACKOFFICE_ROOT=${NEW_ROOT} en ~/.claude/settings.json y en Claude Desktop`)
plan.push('Renombrar las carpetas viejas a *.migrado-' + stamp + ' (respaldo; bórralas cuando todo funcione)')
say('Plan de migración de Back Office:'); for (const p of plan) say(`  · ${p}`)
if (!YES) { say('\nNo cambié nada. Para hacerlo: node scripts/migrate-to-project-folder.mjs --yes'); process.exit(0) }

// El servidor no debe estar escribiendo mientras se copia.
try { await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(500) }); say('\nEl servidor de Back Office está corriendo. Detenlo primero (./bin/backoffice stop) y vuelve a correr esto.'); process.exit(1) } catch { /* apagado: bien */ }

const moveHome = existsSync(OLD_HOME) && !existsSync(NEW_HOME)
const moveRoot = existsSync(OLD_ROOT) && !existsSync(NEW_ROOT)
if (moveHome) { cpSync(OLD_HOME, NEW_HOME, { recursive: true, preserveTimestamps: true }); say(`OK  ${OLD_HOME} → ${NEW_HOME}`) }
if (moveRoot) {
  const cp = (a, b) => cpSync(a, b, { recursive: true, preserveTimestamps: true })
  mkdirSync(join(NEW_ROOT, 'default'), { recursive: true })
  for (const e of readdirSync(OLD_ROOT)) {
    if (e === 'workspaces') { for (const id of readdirSync(join(OLD_ROOT, 'workspaces'))) cp(join(OLD_ROOT, 'workspaces', id), join(NEW_ROOT, id)) }
    else cp(join(OLD_ROOT, e), join(NEW_ROOT, 'default', e))
  }
  say(`OK  ${OLD_ROOT} → ${NEW_ROOT}`)
}

// Rutas absolutas guardadas en la base (solo las que estaban dentro de ~/AgentOS).
const dbFile = join(moveHome ? NEW_HOME : existsSync(NEW_HOME) ? NEW_HOME : OLD_HOME, 'backoffice.db')
if (existsSync(dbFile)) {
  const db = new DatabaseSync(dbFile)
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)
  let n = 0
  for (const [t, c] of [['workspaces', 'root'], ['outputs', 'path'], ['sessions', 'cwd']]) {
    if (!has(t, c)) continue
    const q = (sql, ...a) => Number(db.prepare(sql).run(...a).changes)
    // 1) ~/AgentOS/workspaces/<...> → <proyecto>/workspaces/<...>   2) el resto de ~/AgentOS → <proyecto>/workspaces/default
    const W = join(OLD_ROOT, 'workspaces')
    const a = q(`UPDATE ${t} SET ${c} = ? || substr(${c}, ?) WHERE ${c} = ? OR ${c} LIKE ?`, NEW_ROOT, W.length + 1, W, `${W}${sep}%`)
    const b = q(`UPDATE ${t} SET ${c} = ? || substr(${c}, ?) WHERE ${c} = ? OR ${c} LIKE ?`, join(NEW_ROOT, 'default'), OLD_ROOT.length + 1, OLD_ROOT, `${OLD_ROOT}${sep}%`)
    const r = { changes: a + b }
    n += Number(r.changes)
  }
  db.close()
  say(`OK  ${n} rutas actualizadas en ${dbFile}`)
}

// Variables para hooks y MCP (corren desde la caché de plugins y no saben dónde está el proyecto).
const env = { BACKOFFICE_HOME: NEW_HOME, BACKOFFICE_ROOT: NEW_ROOT }
const patchJson = (file, fn) => {
  let j = {}
  if (existsSync(file)) { copyFileSync(file, `${file}.backoffice-backup`); try { j = JSON.parse(readFileSync(file, 'utf8')) } catch { say(`AVISO: ${file} no es JSON válido; no lo toqué.`); return } }
  else mkdirSync(dirname(file), { recursive: true })
  if (fn(j) === false) return
  writeFileSync(file, JSON.stringify(j, null, 2) + '\n')
  say(`OK  ${file}`)
}
patchJson(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'), (j) => { j.env = { ...(j.env || {}), ...env } })
const desktop = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Claude')
  : process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude') : join(homedir(), '.config', 'Claude')
const desktopCfg = join(desktop, 'claude_desktop_config.json')
if (existsSync(desktopCfg)) patchJson(desktopCfg, (j) => { if (!j.mcpServers?.backoffice) return false; j.mcpServers.backoffice.env = { ...(j.mcpServers.backoffice.env || {}), ...env } })

// Respaldo de lo viejo: renombrado, no borrado. Así el servidor ya no lo elige.
if (moveHome) { renameSync(OLD_HOME, `${OLD_HOME}.migrado-${stamp}`); say(`OK  respaldo en ${OLD_HOME}.migrado-${stamp}`) }
if (moveRoot) { renameSync(OLD_ROOT, `${OLD_ROOT}.migrado-${stamp}`); say(`OK  respaldo en ${OLD_ROOT}.migrado-${stamp}`) }
say('\nListo. Reinicia Claude Desktop y corre: ./bin/backoffice start (desde la carpeta de Back Office). Cuando confirmes que todo está, borra los respaldos *.migrado-' + stamp + '.')
