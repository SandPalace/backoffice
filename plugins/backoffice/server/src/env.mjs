// Compat shim for the AgentOS → Back Office rename (one release): every BACKOFFICE_* variable falls back to its old
// AGENTOS_* name (NEXT_PUBLIC_AGENTOS_* too). Code reads only the BACKOFFICE_* names; the old ones are folded in at the
// edges: process.env (on import of this module, which paths.mjs imports, so every entry point gets it), data/.env and
// the `env` blocks read from Claude's settings.json / Desktop config. A BACKOFFICE_* value that is set always wins.
// Remove after one release, together with the agentos_* MCP tool aliases (mcp.mjs) and the x-agentos-* headers.
export const OLD_PREFIX = 'AGENTOS_'
export const NEW_PREFIX = 'BACKOFFICE_'

/** The BACKOFFICE_* name for an old AGENTOS_* (or NEXT_PUBLIC_AGENTOS_*) name; null for any other name. */
export function newName(k) {
  if (k.startsWith(OLD_PREFIX)) return NEW_PREFIX + k.slice(OLD_PREFIX.length)
  if (k.startsWith(`NEXT_PUBLIC_${OLD_PREFIX}`)) return `NEXT_PUBLIC_${NEW_PREFIX}` + k.slice(`NEXT_PUBLIC_${OLD_PREFIX}`.length)
  return null
}

/** Copies every AGENTOS_* value whose BACKOFFICE_* name is unset (or empty) into it. Mutates and returns `env`. */
export function withLegacyEnv(env) {
  if (!env || typeof env !== 'object') return env
  for (const k of Object.keys(env)) {
    const n = newName(k)
    if (n && (env[n] === undefined || env[n] === '') && env[k] !== undefined) env[n] = env[k]
  }
  return env
}

withLegacyEnv(process.env)
