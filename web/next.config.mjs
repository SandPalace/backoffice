// Same origin: the page only talks to its own port (4781). Next proxies the API, the live stream (SSE, under /api) and the
// hooks to the local server on 127.0.0.1, so no browser (Cowork's embedded one included) has to call another port.
// The server keeps 4780 for MCP clients and Claude hooks. Rewrites are fixed at `next build`: build with the same
// BACKOFFICE_PORT (or NEXT_PUBLIC_BACKOFFICE_PORT, what bin/backoffice passes) the server listens on. The AGENTOS_* names
// are rename compat for one release: a launcher from before the rename builds with NEXT_PUBLIC_AGENTOS_PORT.
const e = process.env
const port = e.BACKOFFICE_PORT || e.NEXT_PUBLIC_BACKOFFICE_PORT || e.AGENTOS_PORT || e.NEXT_PUBLIC_AGENTOS_PORT || '4780'
const target = `http://127.0.0.1:${port}`

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Default proxy timeout is 30 s of silence; long uploads/exports (`?wait=1`) can be quieter than that.
  experimental: { proxyTimeout: 10 * 60 * 1000 },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/hooks/:path*', destination: `${target}/hooks/:path*` },
      { source: '/health', destination: `${target}/health` },
    ]
  },
}
