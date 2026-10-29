import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.mjs'

test('migración: los ids de agentes viejos (español) pasan a inglés en equipos, sesiones y tareas', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'backoffice-rename-')), 'a.db')
  let db = openDb(path)
  const last = 8 // índice de la migración de renombrado (ya no es la última: se agregan al final)
  const now = Date.now()
  db.prepare('INSERT INTO teams (id, name, active, created_at, updated_at) VALUES (?,?,?,?,?)').run('t1', 'Ventas', 1, now, now)
  const mem = db.prepare('INSERT INTO team_members (team_id, agent_id, context) VALUES (?,?,?)')
  mem.run('t1', 'calificador', 'ctx'); mem.run('t1', 'jefe-de-ventas', ''); mem.run('t1', 'cmo', '')
  db.prepare('INSERT INTO tasks (id, title, agent, created_at, updated_at) VALUES (?,?,?,?,?)').run('T-1', 'x', 'analista', now, now)
  db.prepare('DELETE FROM _migrations WHERE n = ?').run(last) // vuelve a correr la última (renombrado)
  db.close()

  db = openDb(path)
  const ids = db.prepare('SELECT agent_id FROM team_members ORDER BY agent_id').all().map((r) => r.agent_id)
  assert.deepEqual(ids, ['cmo', 'lead-qualifier', 'sales-lead'])
  assert.equal(db.prepare("SELECT context FROM team_members WHERE agent_id = 'lead-qualifier'").get().context, 'ctx')
  assert.equal(db.prepare("SELECT agent FROM tasks WHERE id = 'T-1'").get().agent, 'analyst')
  db.close()
})
