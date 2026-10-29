import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIssue, createIssues } from '../src/issues.mjs'
import { openDb } from '../src/db.mjs'

const diag = { backoffice: '1.2.3', commit: 'abc1234', os: 'darwin 25 (arm64)', node: 'v24.0.0' }

test('issues: bug con pasos → enlace de GitHub prellenado con etiqueta y entorno', () => {
  const r = buildIssue({ kind: 'bug', title: 'No abre la sesión', description: 'Al pulsar E no pasa nada', steps: '1. Abrir oficina\n2. E', agent: 'coo' }, { repo: 'acme/agentos', diag })
  assert.equal(r.title, '[Bug] No abre la sesión')
  const u = new URL(r.url)
  assert.equal(`${u.host}${u.pathname}`, 'github.com/acme/agentos/issues/new')
  assert.equal(u.searchParams.get('labels'), 'bug')
  assert.equal(u.searchParams.get('title'), '[Bug] No abre la sesión')
  assert.match(u.searchParams.get('body'), /## Pasos para reproducirlo[\s\S]*Back Office: 1\.2\.3 \(abc1234\)[\s\S]*Reportado por el agente: coo/)
})

test('issues: idea, recorte de URL larga y validaciones', () => {
  const r = buildIssue({ kind: 'feature', title: 'Exportar leads', description: 'x'.repeat(4000), steps: 'y'.repeat(2000), actual: 'z'.repeat(1000), expected: 'w'.repeat(1000) }, { repo: 'acme/agentos', diag })
  assert.equal(new URL(r.url).searchParams.get('labels'), 'enhancement')
  assert.ok(r.url.length <= 7500, `URL de ${r.url.length}`)
  assert.throws(() => buildIssue({ kind: 'otro', title: 'a', description: 'b' }, { diag }), /kind/)
  assert.throws(() => buildIssue({ kind: 'bug', title: ' ', description: 'b' }, { diag }), /título/)
  assert.throws(() => buildIssue({ kind: 'bug', title: 'a', description: 'b' }, { repo: 'mal repo', diag }), /inválido/)
})

test('issues: se guardan en la base y se listan', () => {
  const iss = createIssues(openDb(':memory:'))
  const r = iss.report({ kind: 'bug', title: 'Falla', description: 'Detalle', agent: 'coo' }, 'default', { repo: 'acme/agentos', diag })
  assert.ok(r.id > 0); assert.match(r.note, /Submit new issue/)
  assert.deepEqual(iss.list().map((x) => [x.kind, x.title, x.agent]), [['bug', '[Bug] Falla', 'coo']])
})

test('issues: registra qué agente reportó (sin prefijo de plugin) en la tabla, en events y en el log', () => {
  const db = openDb(':memory:')
  const iss = createIssues(db)
  const lines = []
  const r = iss.report({ kind: 'feature', title: 'Idea', description: 'Algo', agent: 'backoffice:CFO' }, 'default', { repo: 'acme/agentos', diag }, (l) => lines.push(l))
  assert.equal(r.agent, 'cfo')
  assert.match(new URL(r.url).searchParams.get('body'), /Reportado por el agente: cfo/)
  const ev = db.prepare("SELECT event, tool, payload FROM events WHERE event = 'IssueReport'").get()
  assert.deepEqual(JSON.parse(ev.payload), { id: r.id, kind: 'feature', title: '[Idea] Idea', agent: 'cfo' })
  assert.match(lines[0], /^Reporte #\d+ \(feature\) de cfo en default: \[Idea\] Idea$/)
  assert.equal(iss.report({ kind: 'bug', title: 'x', description: 'y' }, 'default', { repo: 'acme/agentos', diag }).agent, 'desconocido')
})
