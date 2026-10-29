#!/usr/bin/env node
// Builds dist/backoffice.mcpb: the Back Office desktop extension for Claude Desktop (Settings → Extensions → Install extension).
// MCPB format (https://github.com/anthropics/mcpb): a zip with manifest.json + the server files. Zero dependencies: the
// zip is written with the server's own zip.mjs. The extension is a thin launcher (scripts/mcpb/server/index.mjs) that runs
// the stdio MCP of the Back Office folder the person picks, so it only needs rebuilding when the launcher or manifest change.
// Usage: node scripts/build-mcpb.mjs [--out <file>]   (prints the path of the file it wrote)
import { readFileSync, mkdirSync, createWriteStream, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { zipStream } from '../plugins/backoffice/server/src/zip.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--out')
const OUT = resolve(i > 0 && process.argv[i + 1] ? process.argv[i + 1] : join(REPO, 'dist', 'backoffice.mcpb'))
const { version } = JSON.parse(readFileSync(join(REPO, 'plugins', 'backoffice', '.claude-plugin', 'plugin.json'), 'utf8'))

export const manifest = {
  manifest_version: '0.3',
  name: 'backoffice',
  display_name: 'Back Office',
  version,
  description: 'Conecta Claude (Chat y Cowork) con tu Back Office local: tareas, archivos, leads y Canvas de tus equipos de agentes.',
  long_description:
    'Extensión de Back Office para Claude Desktop. Corre en tu computadora y habla con el servidor local de Back Office (127.0.0.1:4780); si está apagado lo intenta encender. Usa el código de tu carpeta de Back Office, así que se actualiza con ./bin/backoffice update. Nada sale de tu computadora.',
  author: { name: 'Back Office' },
  repository: { type: 'git', url: 'https://github.com/SandPalace/agentos.git' },
  homepage: 'https://github.com/SandPalace/agentos',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs'],
      env: { BACKOFFICE_DIR: '${user_config.backoffice_folder}' },
    },
  },
  user_config: {
    backoffice_folder: {
      type: 'directory',
      title: 'Carpeta de Back Office',
      description: 'La carpeta donde instalaste Back Office (la que tiene install.sh y bin/backoffice). Normalmente Documentos/AgentOS.',
      default: '${DOCUMENTS}/AgentOS',
      required: true,
    },
  },
  keywords: ['backoffice', 'agents', 'canvas', 'tasks'],
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
}

// Files only: no folder entries (the mcpb CLI's unpacker fails on them, and Claude Desktop may share it).
const file = (name, path) => ({ name, mtime: statSync(path).mtime, stream: Readable.from([readFileSync(path)]) })
const entries = [
  { name: 'manifest.json', stream: Readable.from([Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]) },
  file('server/index.mjs', join(REPO, 'scripts', 'mcpb', 'server', 'index.mjs')),
]

mkdirSync(dirname(OUT), { recursive: true })
await pipeline(Readable.from(zipStream(entries)), createWriteStream(OUT))
console.log(OUT)
