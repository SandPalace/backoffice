import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'

// Several company plugins installed: each one's hooks reach every server. A server keeps only its own company's agents.
test('sesiones: un agente de otra empresa (backoffice-<otra>:…) no se registra; el propio y el genérico sí', async () => {
  const prev = process.env.BACKOFFICE_COMPANY_SLUG
  process.env.BACKOFFICE_COMPANY_SLUG = 'acme'
  const app = createApp({ db: openDb(':memory:'), port: 0 })
  const base = `http://127.0.0.1:${await app.listen()}`
  const hook = (body) => fetch(`${base}/hooks/SessionStart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    await hook({ session_id: 'mine', cwd: '/x', agent_type: 'backoffice-acme:ceo' })
    await hook({ session_id: 'other', cwd: '/x', agent_type: 'backoffice-beta:ceo' })
    await hook({ session_id: 'generic', cwd: '/x', agent_type: 'backoffice:cmo' })
    const ids = (await (await fetch(`${base}/api/sessions`)).json()).map((s) => s.id).sort()
    assert.deepEqual(ids, ['generic', 'mine'])
  } finally {
    await app.close()
    if (prev === undefined) delete process.env.BACKOFFICE_COMPANY_SLUG
    else process.env.BACKOFFICE_COMPANY_SLUG = prev
  }
})
