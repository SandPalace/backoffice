import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { codexSessions } from '../src/codex-sessions.mjs'

const T = 1_700_000_000_000
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'backoffice-codex-'))
  const root = join(dir, 'proj'); mkdirSync(root)
  const db = new DatabaseSync(join(dir, 'state_5.sqlite'))
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, name TEXT, first_user_message TEXT, preview TEXT, cwd TEXT, archived INTEGER, source TEXT, created_at_ms INTEGER, updated_at_ms INTEGER, recency_at_ms INTEGER)')
  const ins = db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  ins.run(U(1), 'Normal', null, 'hola', '', join(root, 'sub'), 0, '"vscode"', T, T+5, T+9)
  ins.run(U(2), 'Archivada', null, '', '', '/x', 1, '"vscode"', T, T+6, T+6)
  ins.run(U(3), 'Guardian review', null, '', '', '/x', 0, '{"subagent":{"other":"guardian"}}', T, T+7, T+7)
  ins.run(U(4), 'Exec', null, '', '', '/x', 0, '"exec"', T, T+7, T+7)
  ins.run(U(5), 'Temporal', null, '', '', '/private/tmp/foo', 0, '"vscode"', T, T+7, T+7)
  ins.run(U(6), '', null, '  primera\n línea   del mensaje ', '', '/y', 0, '"cli"', T, T+3, null)
  db.close()
  return { dir, root }
}

test('codex sessions: filtros, orden, título de respaldo e inProject', () => {
  const { dir, root } = fixture()
  const r = codexSessions({ dir, workspaceRoot: root })
  assert.equal(r.available, true)
  assert.deepEqual(r.sessions.map((s) => s.id), [U(1), U(6)])
  assert.equal(r.sessions[0].inProject, true)
  assert.equal(r.sessions[0].lastActivityAt, T + 9)
  assert.equal(r.sessions[1].title, 'primera línea del mensaje')
  assert.equal(r.sessions[1].inProject, false)
})

test('codex sessions: sin carpeta, sin base o CODEX_HOME no falla', () => {
  assert.deepEqual(codexSessions({ dir: join(tmpdir(), 'no-existe-codex-xyz') }), { available: false, sessions: [] })
  const empty = mkdtempSync(join(tmpdir(), 'backoffice-codex-'))
  assert.equal(codexSessions({ dir: empty }).available, false)
  const { dir } = fixture()
  process.env.CODEX_HOME = dir
  try { assert.equal(codexSessions().sessions.length, 2) } finally { delete process.env.CODEX_HOME }
})

test('sessionLinks: la ref completa codex://threads/<id> liga el hilo', async () => {
  const { openDb } = await import('../src/db.mjs')
  const { createStore } = await import('../src/store.mjs')
  const store = createStore(openDb(':memory:'))
  store.createTeam({ name: 'Dev', members: [{ agent_id: 'tech-lead', session_ref: `codex://threads/${U(1)}` }] })
  assert.equal(store.sessionLinks()[`codex://threads/${U(1)}`][0].agent, 'tech-lead')
})
