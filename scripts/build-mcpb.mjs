#!/usr/bin/env node
// Builds dist/backoffice.mcpb: the Back Office desktop extension for Claude Desktop (Settings → Extensions → Install extension).
// MCPB format (https://github.com/anthropics/mcpb): a zip with manifest.json + the server files. Zero dependencies: the
// zip is written with the server's own zip.mjs. The extension is a thin launcher (scripts/mcpb/server/index.mjs) that runs
// the stdio MCP of the Back Office folder the person picks, so it only needs rebuilding when the launcher or manifest change.
// One extension per company: with BACKOFFICE_COMPANY in data/.env it builds dist/backoffice-<slug>.mcpb named
// `backoffice-<slug>` / «Back Office · <Empresa>», its folder preset to THIS folder, so several coexist in Claude Desktop
// (the launcher reads the folder's data/.env for its ports). Without a company: dist/backoffice.mcpb as before.
// Usage: node scripts/build-mcpb.mjs [--out <file>]   (prints the path of the file it wrote)
import { readFileSync, mkdirSync, createWriteStream, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { zipStream } from '../plugins/backoffice/server/src/zip.mjs'
import { companyOf, portsOf } from './company.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(REPO, 'plugins', 'backoffice', '.claude-plugin', 'plugin.json'), 'utf8'))

/** Extension file name for this install: backoffice-<slug>.mcpb with a company, backoffice.mcpb without. */
export const mcpbName = (company) => (company ? `backoffice-${company.slug}.mcpb` : 'backoffice.mcpb')

/** The manifest; `company` = scripts/company.mjs companyOf() or null; `port` = this install's server port. */
export function buildManifest({ company = null, port = 4780, repo = REPO } = {}) {
  return {
    manifest_version: '0.3',
    name: company ? `backoffice-${company.slug}` : 'backoffice',
    display_name: company ? `Back Office · ${company.name}` : 'Back Office',
    version,
    description: company
      ? `Conecta Claude (Chat y Cowork) con el Back Office de ${company.name}: tareas, archivos, leads y Boards de sus equipos de agentes.`
      : 'Conecta Claude (Chat y Cowork) con tu Back Office local: tareas, archivos, leads y Canvas de tus equipos de agentes.',
    long_description:
      `Extensión de Back Office para Claude Desktop${company ? ` (empresa: ${company.name})` : ''}. Corre en tu computadora y habla con el servidor local de Back Office de la carpeta que elijas (127.0.0.1:${port}; el puerto sale de data/.env de esa carpeta); si está apagado lo intenta encender. Usa el código de tu carpeta de Back Office, así que se actualiza con ./bin/backoffice update. Nada sale de tu computadora.`,
    author: { name: 'Back Office' },
    repository: { type: 'git', url: 'https://github.com/SandPalace/backoffice.git' },
    homepage: 'https://github.com/SandPalace/backoffice',
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
        title: company ? `Carpeta de Back Office de ${company.name}` : 'Carpeta de Back Office',
        description: company
          ? `La carpeta de Back Office de ${company.name} (ya viene puesta: ${repo}).`
          : 'La carpeta donde instalaste Back Office (la que tiene install.sh y bin/backoffice). Normalmente Documentos/AgentOS.',
        default: company ? repo : '${DOCUMENTS}/AgentOS',
        required: true,
      },
    },
    keywords: ['backoffice', 'agents', 'canvas', 'tasks'],
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
const company = companyOf(REPO)
export const manifest = buildManifest({ company, port: portsOf(REPO).port })
const i = process.argv.indexOf('--out')
const OUT = resolve(i > 0 && process.argv[i + 1] ? process.argv[i + 1] : join(REPO, 'dist', mcpbName(company)))

// Files only: no folder entries (the mcpb CLI's unpacker fails on them, and Claude Desktop may share it).
const file = (name, path) => ({ name, mtime: statSync(path).mtime, stream: Readable.from([readFileSync(path)]) })
const entries = [
  { name: 'manifest.json', stream: Readable.from([Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]) },
  file('server/index.mjs', join(REPO, 'scripts', 'mcpb', 'server', 'index.mjs')),
]

if (isMain) {
  mkdirSync(dirname(OUT), { recursive: true })
  await pipeline(Readable.from(zipStream(entries)), createWriteStream(OUT))
  console.log(OUT)
}
