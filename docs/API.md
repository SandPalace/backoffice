# Back Office API (local)

Back Office runs on your computer only (`127.0.0.1`). Two ports:

| Port | What                                                                                     | Who uses it                                   |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| 4780 (default; per folder `BACKOFFICE_PORT` in `data/.env`) | Local server: REST (`/api/*`), live stream (SSE `/api/stream`), Claude hooks (`/hooks/*`), MCP over HTTP (`/mcp`) | Claude (plugin, hooks, extension), MCP clients, `curl` |
| 4781 (default; `BACKOFFICE_WEB_PORT`) | Web office (Next.js). It proxies `/api/*`, `/hooks/*` and `/health` to 4780              | Your browser (also Cowork's browser)          |

The browser only ever talks to 4781 (same origin, session cookie). Never call 4780 from a web page.

## MCP for any client (Codex, OpenCode, Cursor, ...)

- URL: `http://127.0.0.1:<BACKOFFICE_PORT>/mcp` (4780 by default; with several companies each folder has its own port: `./bin/backoffice mcp-key` and `./bin/backoffice status` print it). Examples below use 4780. (Streamable HTTP: `POST` with a JSON-RPC message or batch, JSON response; no SSE stream,
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
| Agile          | `GET/POST /api/epics`, `/api/stories`, `/api/sprints`, `GET/PATCH /api/<kind>/:id`; the person (browser only): `POST/PATCH/DELETE /api/human/<kind>[/:id]`, `POST /api/human/sprints/:id/complete` (see below) |
| Files          | `POST /api/files/write`, `GET /api/files/read?path=`, `GET /api/files/list?prefix=`, `POST /api/files/delete`, `POST /api/files/move`, `GET /api/storage/status` |
| Canvas         | `POST /api/canvas/publish`, `GET /api/canvas`, `GET /api/canvas/:id`, `POST /api/canvas/:id/comments`; per project `GET /api/workspaces/:id/canvas[/home]`      |
| Leads          | `GET/POST /api/leads`, `PATCH /api/leads/:id`                                                                                                                 |
| Teams, roster  | `GET /api/overview`, `GET /api/roster`, `GET/POST /api/teams`, `GET /api/context?agent=`, `POST /api/checkin`                                                  |
| Profile        | `GET/PATCH /api/profile`, `POST /api/profile/insights`                                                                                                        |
| WhatsApp       | `GET /api/whatsapp/status|chats|messages|drafts`, `POST /api/whatsapp/drafts`                                                                                  |
| Issues         | `POST /api/issues` (returns a prefilled GitHub issue link)                                                                                                    |
| Claude hooks   | `POST /hooks/<Event>` (never blocks)                                                                                                                          |

## Agile: statuses, epics, stories, sprints

**Task statuses:** `backlog` · `todo` · `doing` · `blocked` · `review` · `done` · `cancelled`. Agents set `backlog`..`review`
(create only in `backlog` or `todo`). Only the person sets `done` (approve) and `cancelled` (web). An agent that thinks a task
should be dropped sends `PATCH /api/tasks/:id {"propose_cancel": "<reason>"}`: the task goes to `review` with `cancel_proposal`
(no deliverable needed) and the person cancels it or sends it back. Agents cannot reopen a cancelled task.
`GET /api/tasks` filters: `?status=`, `?sprint_id=`, `?story_id=` (`none` = without). Tasks carry `story_id`, `sprint_id`
(nullable; a task created with `story_id` inherits that story's sprint). The person relinks with `PATCH /api/human/tasks/:id
{"status"?, "story_id"?, "sprint_id"?}`.

| Entity (id)    | Fields                                                                                           | Statuses (agents may set)                                  |
| -------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Epic (`E-…`)   | title, description, status, owner_agent                                                          | `planning`, `active` · person: `done`, `cancelled`          |
| Story (`S-…`)  | title, description (user story + acceptance criteria), epic_id, sprint_id, points (0-100), owner_agent | `backlog`, `todo`, `doing`, `review` · person: `done`, `cancelled` |
| Sprint (`SP-…`)| name, goal, start_date, end_date (YYYY-MM-DD), status, report                                    | `planning`, `active`, `review` (needs `report`) · person: complete |

- Same workspace scoping as tasks (`?workspace=` / `X-BackOffice-Workspace`); links across workspaces are rejected (`bad_link`).
- **One active sprint per workspace** (`409 sprint_active_exists`; also a partial unique index). A completed sprint takes no new work.
- Agents: `POST /api/<kind>`, `PATCH /api/<kind>/:id` (`403 human_only` for a person-only status or for editing something closed).
  `GET` returns counts: epics `stories` (by status, points) and `tasks` progress; stories `tasks` progress; sprints `progress`
  (`tasks`: total without cancelled, done, percent, by_status; `stories`: points). `GET /api/<kind>/:id` adds the children.
- The person: `/api/human/<kind>` writes accept only browser requests (Origin/Sec-Fetch-Site, plus the session when auth is
  on), like Canvas decisions; curl/MCP get `403 human_only`. `DELETE /api/human/<kind>/:id` only unlinks children (stories and
  tasks are never deleted with their epic/story/sprint).
- `POST /api/human/sprints/:id/complete {"rollover_to"?: "<sprint id>", "report"?}`: only an `active` or `review` sprint. Unfinished
  tasks and stories (not done/cancelled) move to `rollover_to`, or without it back to the backlog pool (`sprint_id = null`, status
  unchanged). Returns `{ sprint, rollover_to, moved_tasks, moved_stories }`.
- SSE: snapshot carries `epics`, `stories`, `sprints`; change events `epic`, `story`, `sprint` and `*_deleted`.
- `GET /api/overview` adds `agile`: `active_sprint` (with progress), `sprints_in_review`, `sprints_planned`, epic/story counts; `tasks` counts include `backlog` and `cancelled`.

MCP tools: `backoffice_epic_create|_list|_update`, `backoffice_story_create|_list|_update`, `backoffice_sprint_create|_list|_update`
(no tool completes, approves or cancels anything); `backoffice_task_create` accepts `status` (`todo`/`backlog`), `story_id`,
`sprint_id`; `backoffice_task_update` accepts `story_id`, `sprint_id` (null unlinks) and `propose_cancel`; `backoffice_task_list`
filters by `sprint_id`/`story_id`.

Direct links into the web: `http://localhost:4781/canvas?ws=<project id>&artifact=<artifact id>` opens that project and
the artifact's card (`backoffice_artifact_publish` returns it as `link`).
