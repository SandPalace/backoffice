// Back Office desktop extension (.mcpb) for Claude Desktop (Chat + Cowork): a thin launcher, the FALLBACK when the plugin
// cannot be added from Customize → Plugins. It runs the stdio MCP of the person's own Back Office folder
// (<folder>/plugins/backoffice/server/src/mcp.mjs), so `./bin/backoffice update` updates it too: the extension never goes stale.
// The folder comes from the extension setting `backoffice_folder` (env BACKOFFICE_DIR). Zero dependencies.
// If the folder is wrong or too old, it still answers MCP with a clear Spanish message (never a silent failure).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

// AGENTOS_DIR: rename compat (one release). A folder not updated yet still has plugins/agentos.
const dir = String(process.env.BACKOFFICE_DIR || process.env.AGENTOS_DIR || '').trim()
const mcp = dir && [join(dir, 'plugins', 'backoffice', 'server', 'src', 'mcp.mjs'), join(dir, 'plugins', 'agentos', 'server', 'src', 'mcp.mjs')].find((f) => existsSync(f))

let problem = null
if (!mcp) {
  problem = `No encuentro tu carpeta de Back Office${dir ? ` en «${dir}»` : ''}. En Claude Desktop abre Ajustes → Extensiones → Back Office → Configurar y elige la carpeta donde instalaste Back Office (normalmente Documentos/AgentOS). Luego reinicia Claude Desktop.`
} else {
  try {
    const mod = await import(pathToFileURL(mcp).href)
    if (typeof mod.runStdio === 'function') mod.runStdio()
    else problem = 'Tu carpeta de Back Office es de una versión anterior a esta extensión. Abre tu carpeta de Back Office y corre ./bin/backoffice update; luego reinicia Claude Desktop.'
  } catch (e) {
    problem = `No pude cargar Back Office desde «${dir}»: ${e?.message ?? e}. Abre tu carpeta de Back Office y corre ./bin/backoffice update.`
  }
}

// Fallback: a minimal MCP that explains what to fix instead of disappearing from Claude.
if (problem) {
  const rl = createInterface({ input: process.stdin })
  const tool = { name: 'backoffice_overview', description: 'Estado de Back Office (la extensión no pudo conectarse: llama esta herramienta para ver cómo arreglarlo).', inputSchema: { type: 'object', properties: {} } }
  rl.on('line', (line) => {
    let m
    try { m = JSON.parse(line) } catch { return }
    if (m?.id === undefined) return
    const ok = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n')
    if (m.method === 'initialize') ok({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'backoffice', version: '0.0.0' }, instructions: problem })
    else if (m.method === 'tools/list') ok({ tools: [tool] })
    else if (m.method === 'tools/call') ok({ isError: true, content: [{ type: 'text', text: problem }] })
    else if (m.method === 'ping') ok({})
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Método no soportado: ${m.method}` } }) + '\n')
  })
}
