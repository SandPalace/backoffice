// Reportes de la plataforma (bugs e ideas). Se guardan en la base local y se devuelve un enlace de GitHub Issues
// prellenado: la persona lo revisa y lo envía (los agentes nunca publican nada externo). Sin dependencias.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { platform, release, arch } from 'node:os'
import { AppError } from './store.mjs'
import { repoRoot } from './paths.mjs'
import { PLUGIN_ROOT } from './roster.mjs'

export const DEFAULT_ISSUES_REPO = 'SandPalace/agentos'
const KINDS = { bug: { prefix: 'Bug', label: 'bug' }, feature: { prefix: 'Idea', label: 'enhancement' } }
const MAX_URL = 7500 // GitHub corta URLs muy largas; el cuerpo se recorta antes
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
// Id del agente que reporta, sin prefijo de plugin («backoffice:cfo» → «cfo»). El MCP no sabe quién lo llama: lo dice el agente.
export const reporterOf = (v) => clean(v, 80).replace(/^[\w-]+:/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || null

// Versión y entorno, sin rutas ni nombres de usuario.
export function diagnostics({ repo = repoRoot(), pluginRoot = PLUGIN_ROOT } = {}) {
  let version = null, commit = null
  try { version = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null } catch { /* sin manifiesto */ }
  if (repo) try { commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch { /* no es git */ }
  return { backoffice: version, commit, os: `${platform()} ${release()} (${arch()})`, node: process.version }
}

export function buildIssue(input, { repo = process.env.BACKOFFICE_ISSUES_REPO || DEFAULT_ISSUES_REPO, diag = diagnostics() } = {}) {
  const kind = input?.kind
  if (!KINDS[kind]) throw new AppError('bad_request', 'kind debe ser "bug" o "feature"', 400)
  const title = clean(input.title, 120)
  const description = clean(input.description, 4000)
  if (!title) throw new AppError('bad_request', 'Falta el título', 400)
  if (!description) throw new AppError('bad_request', 'Falta la descripción', 400)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new AppError('bad_request', 'Repositorio de reportes inválido', 400)
  const parts = [`## ${kind === 'bug' ? 'Qué pasa' : 'Qué se necesita'}\n\n${description}`]
  const steps = clean(input.steps, 2000), expected = clean(input.expected, 1000), actual = clean(input.actual, 1000)
  if (steps) parts.push(`## Pasos para reproducirlo\n\n${steps}`)
  if (expected) parts.push(`## Qué esperaba\n\n${expected}`)
  if (actual) parts.push(`## Qué pasó en cambio\n\n${actual}`)
  const d = diag
  parts.push(`## Entorno\n\n- Back Office: ${d.backoffice ?? '?'}${d.commit ? ` (${d.commit})` : ''}\n- Sistema: ${d.os}\n- Node: ${d.node}${input.agent ? `\n- Reportado por el agente: ${clean(input.agent, 80)}` : ''}`)
  const fullTitle = `[${KINDS[kind].prefix}] ${title}`
  let body = parts.join('\n\n')
  const make = (b) => `https://github.com/${repo}/issues/new?${new URLSearchParams({ title: fullTitle, body: b, labels: KINDS[kind].label })}`
  let url = make(body)
  while (url.length > MAX_URL && body.length > 200) { body = `${body.slice(0, Math.floor(body.length * 0.85))}\n\n…(recortado)`; url = make(body) }
  return { kind, title: fullTitle, body, url, repo }
}

export function createIssues(db) {
  const ins = db.prepare('INSERT INTO issue_reports (workspace_id, kind, title, body, url, agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const logEvent = db.prepare('INSERT INTO events (ts, session_id, event, tool, payload, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
  const list = db.prepare('SELECT id, workspace_id, kind, title, url, agent, created_at FROM issue_reports ORDER BY id DESC LIMIT ?')
  return {
    report(input, ws, opts, log = () => {}) {
      const agent = reporterOf(input?.agent) ?? 'desconocido'
      const r = buildIssue({ ...input, agent }, opts)
      const ts = Date.now()
      const id = Number(ins.run(ws, r.kind, r.title, r.body, r.url, agent, ts).lastInsertRowid)
      // Bitácora: quién reportó qué (eventos de la base + log del servidor).
      logEvent.run(ts, null, 'IssueReport', 'backoffice_issue_report', JSON.stringify({ id, kind: r.kind, title: r.title, agent }), ws)
      log(`Reporte #${id} (${r.kind}) de ${agent} en ${ws}: ${r.title}`)
      return { id, agent, ...r, note: 'Borrador listo. Dale a la persona el enlace: lo abre, revisa y pulsa «Submit new issue» en GitHub. Nada se envía sin su clic.' }
    },
    list: (limit = 50) => list.all(Math.min(Math.max(Number(limit) || 50, 1), 200)),
  }
}
