import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentDefs } from '../src/agent-defs.mjs'

const def = (id, body = 'Original.') => `---\nname: ${id}\ndescription: Prueba\ntools: Read, Skill\n---\n\n${body}\n`

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'backoffice-defs-'))
  const plugin = join(dir, 'backoffice'), home = join(dir, 'claude'), root = join(dir, 'proj')
  mkdirSync(join(plugin, 'teams', 'sales-team'), { recursive: true })
  writeFileSync(join(plugin, 'teams', 'sales-team', 'team.json'), JSON.stringify({ id: 'sales-team', name: 'Ventas', agents: ['lead-qualifier'], skills: [] }))
  mkdirSync(join(plugin, 'agents'))
  writeFileSync(join(plugin, 'agents', 'lead-qualifier.md'), def('lead-qualifier', 'Del plugin.'))
  mkdirSync(root)
  return { defs: createAgentDefs({ pluginRoot: plugin, home }), home, root }
}

test('agent defs: proyecto toma del global y, si no hay, del plugin', () => {
  const { defs, root } = fixture()
  let d = defs.get('lead-qualifier', { scope: 'project', root })
  assert.equal(d.source, 'plugin'); assert.equal(d.exists, false); assert.match(d.content, /Del plugin/)
  defs.put('lead-qualifier', { scope: 'global', content: def('lead-qualifier', 'Global.') })
  d = defs.get('lead-qualifier', { scope: 'project', root })
  assert.equal(d.source, 'global'); assert.match(d.content, /Global/)
  d = defs.put('lead-qualifier', { scope: 'project', root, content: def('lead-qualifier', 'Del proyecto.') })
  assert.equal(d.source, 'project'); assert.equal(d.exists, true)
  assert.ok(existsSync(join(root, '.claude', 'agents', 'lead-qualifier.md')))
  d = defs.remove('lead-qualifier', { scope: 'project', root })
  assert.equal(d.source, 'global', 'al borrar la copia vuelve a la plantilla')
})

test('agent defs: global en <home>/agents y lista con exists', () => {
  const { defs, home } = fixture()
  assert.deepEqual(defs.list({ scope: 'global' }), [{ id: 'lead-qualifier', plugin: 'sales-team', exists: false }])
  defs.put('lead-qualifier', { scope: 'global', content: def('lead-qualifier') })
  assert.match(readFileSync(join(home, 'agents', 'lead-qualifier.md'), 'utf8'), /name: lead-qualifier/)
  assert.equal(defs.list({ scope: 'global' })[0].exists, true)
})

test('agent defs: valida id, encabezado y nombre', () => {
  const { defs, root } = fixture()
  assert.throws(() => defs.get('../x', { scope: 'project', root }), /inválido/)
  assert.throws(() => defs.get('nadie', { scope: 'project', root }), /No conozco/)
  assert.throws(() => defs.put('lead-qualifier', { scope: 'project', root, content: 'sin encabezado' }), /frontmatter/)
  assert.throws(() => defs.put('lead-qualifier', { scope: 'project', root, content: def('otro') }), /name: lead-qualifier/)
  assert.throws(() => defs.get('lead-qualifier', { scope: 'project', root: null }), /no tiene carpeta/)
  assert.throws(() => defs.get('lead-qualifier', { scope: 'x' }), /scope/)
})
