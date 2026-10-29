import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'backoffice-root-')))
process.env.BACKOFFICE_ROOT = ROOT
const { openDb } = await import('../src/db.mjs')
const { createApp } = await import('../src/server.mjs')
const { rosterContent, loadRoster, validateTeams, scanTeams, ROSTER_FILE } = await import('../src/roster.mjs')

async function boot(opts = {}) {
  const app = createApp({ db: openDb(':memory:'), port: 0, extraRoots: [], ...opts })
  const base = `http://127.0.0.1:${await app.listen()}`
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null }
  }
  return { app, call }
}

const FAKE = {
  generated_at: 'x',
  plugins: [
    { id: 'alpha-team', description: 'Alpha. ' + 'x'.repeat(400), agents: [{ id: 'lead', description: 'L '.repeat(200), model: 'opus' }, { id: 'worker', description: 'Worker', model: 'sonnet' }], skills: [{ id: 's1', description: 'Skill one' }] },
    { id: 'beta-team', description: 'Beta', agents: [{ id: 'solo', description: 'Solo', model: 'haiku' }], skills: [] },
  ],
}

test('roster.json está al día (si falla: node scripts/build-roster.mjs)', () => {
  const file = JSON.parse(readFileSync(ROSTER_FILE, 'utf8'))
  assert.deepEqual({ plugins: file.plugins }, JSON.parse(JSON.stringify(rosterContent())), 'roster.json desactualizado: ejecuta `node scripts/build-roster.mjs` desde apps/backoffice')
  for (const p of file.plugins) for (const a of p.agents) assert.ok(a.description.length <= 300)
})

test('overview incluye roster con in_active_team según el equipo activo', async () => {
  const { app, call } = await boot({ roster: { ...FAKE, source: 'test' } })
  let o = (await call('GET', '/api/overview')).body
  assert.deepEqual(o.roster.totals, { plugins: 2, agents: 3, skills: 1 })
  assert.deepEqual(o.roster.not_in_active_team, ['lead', 'worker', 'solo'])
  assert.ok(o.roster.plugins[0].agents[0].description.length <= 160)
  const team = (await call('POST', '/api/teams', { name: 'A', members: [{ agent_id: 'lead' }] })).body
  await call('POST', `/api/teams/${team.id}/activate`)
  await call('POST', '/api/tasks', { title: 't', agent: 'alpha-team:worker' })
  o = (await call('GET', '/api/overview')).body
  const byId = Object.fromEntries(o.roster.plugins.flatMap((p) => p.agents).map((a) => [a.id, a]))
  assert.equal(byId.lead.in_active_team, true)
  assert.equal(byId.worker.in_active_team, false)
  assert.equal(byId.worker.open_tasks, 1)
  assert.deepEqual(o.roster.not_in_active_team, ['worker', 'solo'])
  const ctx = (await call('GET', '/api/context?agent=coo')).body.context
  assert.match(ctx, /3 agentes en 2 equipos/)
  assert.match(ctx, /backoffice_roster/)
  assert.match(ctx, /- beta-team \(1 agentes: solo\)/)
  await app.close()
})

test('GET /api/roster: plugin, agente y errores claros', async () => {
  const { app, call } = await boot({ roster: { ...FAKE, source: 'test' } })
  const all = (await call('GET', '/api/roster')).body
  assert.equal(all.plugins.length, 2)
  assert.ok(all.plugins[0].description.length > 300) // texto completo
  const p = (await call('GET', '/api/roster?plugin=alpha-team')).body
  assert.equal(p.skills[0].id, 's1')
  assert.equal(p.agents.length, 2)
  const a = (await call('GET', '/api/roster?agent=beta-team:solo')).body
  assert.equal(a.plugin, 'beta-team')
  assert.equal(a.agent.model, 'haiku')
  const bad = await call('GET', '/api/roster?plugin=nope')
  assert.equal(bad.status, 404)
  assert.match(JSON.stringify(bad.body), /nope.*alpha-team, beta-team/)
  assert.equal((await call('GET', '/api/roster?agent=ghost')).status, 404)
  await app.close()
})

// Plugin falso con la forma real: agents/ y skills/ planos, equipos en teams/<id>/team.json.
function fakePlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'backoffice-plugin-'))
  mkdirSync(join(dir, 'agents'), { recursive: true })
  mkdirSync(join(dir, 'skills', 'sk'), { recursive: true })
  mkdirSync(join(dir, 'teams', 'x-team'), { recursive: true })
  writeFileSync(join(dir, 'teams', 'x-team', 'team.json'), JSON.stringify({ id: 'x-team', name: 'X', description: 'X team', agents: ['boss'], skills: ['sk'], optional_skills: ['private-skill'] }))
  writeFileSync(join(dir, 'agents', 'boss.md'), '---\nname: boss\ndescription: Runs X\nmodel: opus\n---\nbody')
  writeFileSync(join(dir, 'skills', 'sk', 'SKILL.md'), '---\nname: sk\ndescription: Does sk\n---\n')
  return dir
}

test('fallback: sin roster.json escanea los equipos del plugin y nunca lanza', () => {
  const dir = fakePlugin()
  const r = loadRoster({ file: join(dir, 'missing.json'), pluginRoot: dir })
  assert.equal(r.source, 'scan')
  assert.deepEqual(r.plugins.map((p) => [p.id, p.description]), [['x-team', 'X team']])
  assert.equal(r.plugins[0].agents[0].id, 'boss')
  assert.deepEqual(r.plugins[0].skills.map((s) => s.id), ['sk'], 'una optional_skill ausente no aparece')
  const none = loadRoster({ file: join(dir, 'missing.json'), pluginRoot: join(dir, 'nope') })
  assert.deepEqual(none.plugins, [])
})

test('validateTeams: el plugin real está completo (cada agente y skill en exactamente un equipo)', () => {
  assert.deepEqual(validateTeams(), [])
  const ts = scanTeams()
  assert.deepEqual(ts.map((t) => t.id), ['backoffice-core', 'collections-team', 'dev-team', 'executive-team', 'finance-team', 'marketing-team', 'sales-team'])
  assert.equal(ts.reduce((n, t) => n + t.agents.length, 0), 26)
})

test('validateTeams: detecta huérfanos, duplicados e ids que no existen', () => {
  const dir = fakePlugin()
  assert.deepEqual(validateTeams(dir), [], 'una optional_skill ausente no es error')
  writeFileSync(join(dir, 'agents', 'stray.md'), '---\nname: stray\n---\n')
  mkdirSync(join(dir, 'skills', 'lost'))
  writeFileSync(join(dir, 'skills', 'lost', 'SKILL.md'), '---\nname: lost\n---\n')
  mkdirSync(join(dir, 'teams', 'y-team'))
  writeFileSync(join(dir, 'teams', 'y-team', 'team.json'), JSON.stringify({ id: 'y-team', name: 'Y', agents: ['boss', 'ghost'], skills: [] }))
  const errs = validateTeams(dir).join('\n')
  assert.match(errs, /agent «stray» belongs to no team/)
  assert.match(errs, /skill «lost» belongs to no team/)
  assert.match(errs, /agent «boss» is in more than one team: x-team, y-team/)
  assert.match(errs, /team y-team: agent «ghost» does not exist/)
})

test('aislamiento: in_active_team de un workspace no se filtra a otro', async () => {
  const { app, call } = await boot({ roster: { ...FAKE, source: 'test' } })
  await call('POST', '/api/workspaces', { name: 'Acme' })
  const A = { 'x-backoffice-workspace': 'acme' }
  const team = (await call('POST', '/api/teams', { name: 'A', members: [{ agent_id: 'solo' }] }, A)).body
  await call('POST', `/api/teams/${team.id}/activate`, null, A)
  const inA = (await call('GET', '/api/overview', null, A)).body.roster
  const inD = (await call('GET', '/api/overview')).body.roster
  assert.ok(!inA.not_in_active_team.includes('solo'))
  assert.ok(inD.not_in_active_team.includes('solo'))
  assert.equal(inA.totals.agents, inD.totals.agents) // el roster es global
  await app.close()
})
