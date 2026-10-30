// Per-company plugin: scripts/build-company-plugin.mjs copies this plugin to dist/company-plugin/plugins/backoffice-<slug>/
// and bakes a `company.json` at its root: { name, slug, home, root, port, web_port, repo, plugin }. Several Back Offices
// (one folder per company) then coexist on one machine, each with its own plugin, port pair and data.
// When that file is present it WINS over every env var (the global ~/.claude/settings.json `env` belongs to the generic
// plugin, or to whichever company was installed last): it is applied to process.env on import, which paths.mjs does,
// so every entry point (stdio MCP, SessionStart hook) sees this company's folder and ports before anything reads them.
// The generic plugin (plugins/backoffice in the clone, or `backoffice@backoffice` in the cache) has no company.json: no-op.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Root of the plugin this code runs from (plugins/backoffice, or the cached copy of a company plugin). */
export const PLUGIN_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
export const COMPANY_FILE = 'company.json'

const port = (v) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null
}

/** The company.json at `root`, validated; null when absent or unusable (then the plugin behaves like the generic one). */
export function readCompany(root = PLUGIN_ROOT) {
  let c
  try {
    c = JSON.parse(readFileSync(join(root, COMPANY_FILE), 'utf8'))
  } catch {
    return null
  }
  if (!c || typeof c !== 'object' || typeof c.slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.slug)) return null
  if (typeof c.home !== 'string' || !c.home || !port(c.port)) return null
  return {
    name: typeof c.name === 'string' && c.name ? c.name : c.slug,
    slug: c.slug,
    home: c.home,
    root: typeof c.root === 'string' && c.root ? c.root : null,
    port: port(c.port),
    web_port: port(c.web_port),
    repo: typeof c.repo === 'string' && c.repo ? c.repo : null,
    plugin: typeof c.plugin === 'string' && c.plugin ? c.plugin : `backoffice-${c.slug}`,
  }
}

/** Copies the company's folder and ports into `env` (overriding). Returns the company, or null (nothing changed). */
export function applyCompanyEnv(env = process.env, c = readCompany()) {
  if (!c) return null
  env.BACKOFFICE_HOME = c.home
  if (c.root) env.BACKOFFICE_ROOT = c.root
  env.BACKOFFICE_PORT = String(c.port)
  if (c.web_port) env.BACKOFFICE_WEB_PORT = String(c.web_port)
  env.BACKOFFICE_COMPANY = c.name
  env.BACKOFFICE_COMPANY_SLUG = c.slug
  return c
}

export const company = applyCompanyEnv()
