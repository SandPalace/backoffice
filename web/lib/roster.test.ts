import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROSTERS, ROSTER_AGENTS } from './roster.ts'

const PLUGIN = join(import.meta.dirname, '..', '..', 'plugins', 'backoffice')

test('los ids de agentes son únicos en todo el roster', () => {
  const ids = ROSTER_AGENTS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('cada grupo del roster coincide con su equipo (plugins/backoffice/teams/<id>/team.json)', () => {
  const teams = readdirSync(join(PLUGIN, 'teams')).filter((d) => existsSync(join(PLUGIN, 'teams', d, 'team.json')))
  assert.deepEqual([...ROSTERS.map((g) => g.id)].sort(), teams.sort(), 'grupos del roster ≠ equipos del plugin')
  for (const g of ROSTERS) {
    const team = JSON.parse(readFileSync(join(PLUGIN, 'teams', g.id, 'team.json'), 'utf8')) as { name: string; agents: string[] }
    assert.equal(team.name, g.name, `${g.id}: el nombre del team.json debe ser el del roster`)
    for (const a of g.agents) assert.ok(existsSync(join(PLUGIN, 'agents', `${a.id}.md`)), `${g.id}: no existe agents/${a.id}.md`)
    assert.deepEqual([...g.agents.map((a) => a.id)].sort(), [...team.agents].sort(), `${g.id}: agentes del roster ≠ agentes del team.json`)
  }
})

test('cada agente tiene una cara válida (0–20, no la del jugador) y no hay dos agentes iguales (cara + color)', () => {
  for (const a of ROSTER_AGENTS) assert.ok(Number.isInteger(a.face) && a.face! >= 0 && a.face! <= 20 && a.face !== 10, `cara inválida: ${a.id} ${a.face}`)
  const looks = ROSTER_AGENTS.map((a) => `${a.face}|${a.color}`)
  assert.equal(new Set(looks).size, looks.length, 'dos agentes con la misma cara y el mismo color')
})
