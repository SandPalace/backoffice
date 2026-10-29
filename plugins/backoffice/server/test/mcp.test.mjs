import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.mjs'
import { createApp } from '../src/server.mjs'

// Habla con mcp.mjs como lo haría Claude: JSON-RPC por stdio, una línea por mensaje.
function mcpClient(port) {
  const child = spawn(process.execPath, [new URL('../src/mcp.mjs', import.meta.url).pathname], {
    env: { ...process.env, BACKOFFICE_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let buf = ''
  const waiters = new Map()
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      const msg = JSON.parse(line)
      waiters.get(msg.id)?.(msg)
    }
  })
  let n = 0
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++n
      waiters.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const tool = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args })
    return { isError: !!r.result.isError, data: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) }
  }
  return { rpc, tool, stop: () => child.kill() }
}

test('MCP: handshake, herramientas y flujo de una tarea con entregable', async () => {
  const app = createApp({ db: openDb(':memory:'), port: 0 })
  const port = await app.listen()
  const mcp = mcpClient(port)
  try {
    const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18' })
    assert.equal(init.result.serverInfo.name, 'backoffice')
    const list = await mcp.rpc('tools/list')
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      ['backoffice_task_create', 'backoffice_task_update', 'backoffice_task_deliver', 'backoffice_task_list', 'backoffice_lead_create', 'backoffice_lead_update', 'backoffice_lead_list', 'backoffice_whatsapp_inbox', 'backoffice_whatsapp_draft', 'backoffice_overview', 'backoffice_projects', 'backoffice_roster', 'backoffice_team_context', 'backoffice_checkin', 'backoffice_file_write', 'backoffice_file_read', 'backoffice_file_list', 'backoffice_file_delete', 'backoffice_file_move', 'backoffice_issue_report', 'backoffice_artifact_publish', 'backoffice_artifact_list', 'backoffice_artifact_get', 'backoffice_artifact_comment', 'backoffice_profile_read', 'backoffice_profile_update', 'backoffice_profile_note'],
    )

    const ro = await mcp.tool('backoffice_roster', { agent: 'coo' })
    assert.equal(ro.data.plugin, 'backoffice-core')
    assert.equal((await mcp.tool('backoffice_overview', {})).data.roster.totals.agents > 0, true)
    const unk = await mcp.tool('backoffice_roster', { plugin: 'nope' })
    assert.equal(unk.isError, true)
    assert.match(unk.data, /nope/)

    const dir = mkdtempSync(join(tmpdir(), 'backoffice-mcp-'))
    const file = join(dir, 'reporte.md')
    writeFileSync(file, '# Reporte')

    const { data: t } = await mcp.tool('backoffice_task_create', { title: 'Reporte semanal', agent: 'analyst' })
    const bad = await mcp.tool('backoffice_task_update', { id: t.id, status: 'review' })
    assert.equal(bad.isError, true)
    assert.match(bad.data, /output_dir|entregable/)

    const done = await mcp.tool('backoffice_task_update', { id: t.id, status: 'done' })
    assert.equal(done.isError, true) // sólo una persona

    const del = await mcp.tool('backoffice_task_deliver', { id: t.id, path: file, kind: 'markdown', title: 'Reporte' })
    assert.equal(del.data.outputs[0].exists, true)
    const rev = await mcp.tool('backoffice_task_update', { id: t.id, status: 'review', output_dir: dir })
    assert.equal(rev.data.status, 'review')

    const ci = await mcp.tool('backoffice_checkin', { agent: 'analyst', status: 'working', detail: 'Armando el reporte' })
    assert.equal(ci.data.status, 'working')
    assert.equal(ci.data.id, 'mcp:analyst')
  } finally {
    mcp.stop()
    await app.close()
  }
})
