// Best-effort, read-only listing of the owner's OpenAI Codex desktop threads.
// Layout (undocumented): <CODEX_HOME or ~/.codex>/state_<n>.sqlite, table `threads`. Opened read-only; never throws.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { isInside } from './desktop-sessions.mjs'

const MAX_SESSIONS = 300
const UUID = /^[0-9a-f-]{36}$/i

export function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

function stateDb(dir) {
  let best = null, bestN = -1
  try {
    for (const n of readdirSync(dir)) {
      const m = n.match(/^state_(\d+)\.sqlite$/)
      if (m && Number(m[1]) > bestN) { best = n; bestN = Number(m[1]) }
    }
  } catch { /* no dir */ }
  return best ? join(dir, best) : null
}

const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const tmpCwd = (c) => /^(\/private)?\/tmp(\/|$)/.test(c)
const toMs = (v) => (typeof v === 'number' && v > 0 ? (v < 1e11 ? v * 1000 : v) : null)

export function codexSessions({ dir = codexHome(), workspaceRoot = null } = {}) {
  let db
  try {
    const file = stateDb(dir)
    if (!file) return { available: false, sessions: [] }
    db = new DatabaseSync(file, { readOnly: true })
    const cols = new Set(db.prepare('PRAGMA table_info(threads)').all().map((c) => c.name))
    if (!cols.has('id')) return { available: false, sessions: [] }
    const pick = (n) => (cols.has(n) ? n : 'NULL')
    const rows = db.prepare(`SELECT id, ${pick('title')} AS title, ${pick('name')} AS name, ${pick('first_user_message')} AS first, ${pick('cwd')} AS cwd,
      ${pick('archived')} AS archived, ${pick('source')} AS source, ${pick('created_at_ms')} AS created_ms, ${pick('updated_at_ms')} AS updated_ms,
      ${pick('recency_at_ms')} AS recency_ms, ${pick('updated_at')} AS updated_s, ${pick('created_at')} AS created_s FROM threads`).all()
    const out = []
    for (const r of rows) {
      const id = String(r.id ?? '')
      if (!UUID.test(id) || r.archived) continue
      const source = typeof r.source === 'string' ? r.source : ''
      if (source.includes('"subagent"') || source === 'exec' || source.includes('"exec"')) continue
      const cwd = oneLine(r.cwd, 500)
      if (tmpCwd(cwd)) continue
      const title = oneLine(r.name, 120) || oneLine(r.title, 120) || oneLine(r.first, 120)
      const lastActivityAt = toMs(r.recency_ms) ?? toMs(r.updated_ms) ?? toMs(r.updated_s) ?? toMs(r.created_ms) ?? toMs(r.created_s)
      const s = { id, title, cwd, lastActivityAt, archived: false, source: oneLine(source, 60) }
      if (workspaceRoot) s.inProject = isInside(cwd, workspaceRoot)
      out.push(s)
    }
    out.sort((x, y) => (y.lastActivityAt ?? 0) - (x.lastActivityAt ?? 0))
    return { available: true, sessions: out.slice(0, MAX_SESSIONS) }
  } catch {
    return { available: false, sessions: [] }
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}
