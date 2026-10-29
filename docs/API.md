# Back Office API (local)

Back Office runs on your computer only (`127.0.0.1`). Two ports:

| Port | What                                                                                     | Who uses it                                   |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| 4780 | Local server: REST (`/api/*`), live stream (SSE `/api/stream`), Claude hooks (`/hooks/*`), MCP over HTTP (`/mcp`) | Claude (plugin, hooks, extension), MCP clients, `curl` |
| 4781 | Web office (Next.js). It proxies `/api/*`, `/hooks/*` and `/health` to 4780              | Your browser (also Cowork's browser)          |

The browser only ever talks to 4781 (same origin, session cookie). Never call 4780 from a web page.

## MCP for any client (Codex, OpenCode, Cursor, ...)

- URL: `http://127.0.0.1:4780/mcp` (Streamable HTTP: `POST` with a JSON-RPC message or batch, JSON response; no SSE stream,
  `GET` answers 405).
- Auth: header `Authorization: Bearer <key>`. The key is in `data/mcp-key` inside your Back Office folder (created on the first
  server start, readable only by your user). `./bin/backoffice mcp-key` tells you where it is and how to copy it. Without the
  key, or with a wrong one, the answer is `401`. Do not paste the key in a chat or commit it.
- Optional headers: `X-BackOffice-Workspace: <project id>` (default project for calls without `workspace`) and
  `X-BackOffice-Agent: <agent id>` (who is calling, e.g. `cmo`; used when a tool needs your agent id and you omit it).
- Tools: the same `backoffice_*` tools as the Claude plugin (tasks, files, leads, Canvas, roster, profile...). `tools/list`
  describes each one. Back Office was called AgentOS until 2026-10-29: for one release the old tool names
  (`agentos_*`, not listed) and headers (`X-AgentOS-Workspace`, `X-AgentOS-Agent`) still work, so an existing client config keeps
  working; rename them when convenient.

The safest way to give the key to a client is an environment variable, so it never sits in a config file. In the terminal
where you start the client (macOS/Linux):

```bash
export BACKOFFICE_MCP_KEY="$(cat ~/Documents/AgentOS/data/mcp-key)"
```

Then, per client (formats as of 2026-10; check your client's MCP docs if one changed):

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.backoffice]
url = "http://127.0.0.1:4780/mcp"
bearer_token_env_var = "BACKOFFICE_MCP_KEY"
```

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "backoffice": {
      "type": "remote",
      "url": "http://127.0.0.1:4780/mcp",
      "headers": { "Authorization": "Bearer {env:BACKOFFICE_MCP_KEY}" }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "backoffice": {
      "url": "http://127.0.0.1:4780/mcp",
      "headers": { "Authorization": "Bearer ${env:BACKOFFICE_MCP_KEY}" }
    }
  }
}
```

**Any other client:** an HTTP (streamable) MCP server with that URL and the `Authorization` header.

Quick test from the terminal:

```bash
curl -s http://127.0.0.1:4780/mcp -H "Authorization: Bearer $BACKOFFICE_MCP_KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backoffice_overview","arguments":{}}}'
```

Claude itself does not need this: Claude Code uses the `backoffice` plugin, and Claude Desktop (Chat, Cowork) uses the plugin
added from Customize → Plugins or, as a fallback, the `dist/backoffice.mcpb` extension.

## REST (summary)

JSON in, JSON out. Requests from local processes (curl, hooks, MCP) need no session; requests from a browser need the
web session (see `docs/AUTH.md`). The project is chosen with `?workspace=<id>` or the header `X-BackOffice-Workspace`
(without it: `default`). Errors: `{ "error": "<code>", "message": "<Spanish text>" }`.

| Area           | Endpoints                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health         | `GET /health`                                                                                                                                                 |
| Live           | `GET /api/stream` (SSE: `snapshot`, then change events), `GET /api/sessions`, `GET /api/events`                                                               |
| Projects       | `GET /api/projects`, `GET/POST /api/workspaces`, `GET /api/workspaces/resolve?cwd=`, `/api/workspaces/:id/...` (files, objects, zip, canvas)                    |
| Tasks          | `GET/POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/outputs`; approval only by the person: `POST /api/human/tasks/:id/approve`                 |
| Files          | `POST /api/files/write`, `GET /api/files/read?path=`, `GET /api/files/list?prefix=`, `POST /api/files/delete`, `POST /api/files/move`, `GET /api/storage/status` |
| Canvas         | `POST /api/canvas/publish`, `GET /api/canvas`, `GET /api/canvas/:id`, `POST /api/canvas/:id/comments`; per project `GET /api/workspaces/:id/canvas[/home]`      |
| Leads          | `GET/POST /api/leads`, `PATCH /api/leads/:id`                                                                                                                 |
| Teams, roster  | `GET /api/overview`, `GET /api/roster`, `GET/POST /api/teams`, `GET /api/context?agent=`, `POST /api/checkin`                                                  |
| Profile        | `GET/PATCH /api/profile`, `POST /api/profile/insights`                                                                                                        |
| WhatsApp       | `GET /api/whatsapp/status|chats|messages|drafts`, `POST /api/whatsapp/drafts`                                                                                  |
| Issues         | `POST /api/issues` (returns a prefilled GitHub issue link)                                                                                                    |
| Claude hooks   | `POST /hooks/<Event>` (never blocks)                                                                                                                          |

Direct links into the web: `http://localhost:4781/canvas?ws=<project id>&artifact=<artifact id>` opens that project and
the artifact's card (`backoffice_artifact_publish` returns it as `link`).
