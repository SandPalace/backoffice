# Storage and workspaces

Back Office has two related features: **workspaces** (several accounts/projects in one install) and **file storage**,
a web-native file layer: the person and the agents work with files by *key* (`files/marketing/acme/facts.md`),
never by disk path. Storage is a single **built-in local store**: plain files in a folder on this computer. There is
nothing to install (no Docker, no database server, no cloud account) and the server stays zero-dependency.

## Architecture

```
Claude session --hooks/MCP--> Back Office server :4780 --SQLite (<project>/data/backoffice.db)
                                   |-- blobstore.mjs --> local store: ~/.agentos/store/<bucket>/<key>
web :4781 --/api/*, /api/files/* (SSE with ?workspace=)--> server           (web never touches the disk directly)
```

| Piece | Port | Notes |
|---|---|---|
| Back Office server | 4780 | binds `127.0.0.1` only; `BACKOFFICE_PORT` |
| Web | 4781 | |

Source files: `blobstore.mjs` (key validation + local store), `files.mjs` (virtual namespace, list/move/trash/zip plan,
virtual deliveries), `transfer.mjs` (import-disk job), `zip.mjs` (store-only ZIP writer), `outputs-storage.mjs` (copy of
disk-path deliveries into the store), `db.mjs` (migrations 5-9), `store.mjs`, `server.mjs`, `mcp.mjs`.

## Storage

On disk: `<BACKOFFICE_HOME or ~/.agentos>/store/<bucket>/<key>`, one bucket (folder) per workspace, `ws-<workspace id>`.

| | |
|---|---|
| Data | the file itself at `store/<bucket>/<key>`; files dropped in by hand also work (content type by extension) |
| Metadata | sidecar `store/.meta/<bucket>/<key>.json` (content type, size, sha256, mtime); a stale sidecar is ignored |
| Writes | temp file in `store/.tmp` + `rename` (atomic), files created `0600` |
| Safety | every key segment is checked with `lstat`: symlinks are refused (403) and never listed |
| Backup | copy the `store/` folder (and `backoffice.db` for tasks/teams). Restore = put it back |

`GET /api/storage/status` -> `{ backend: 'local', root, usage: {files, bytes}, import, limits }`. `usage` counts the files in
all workspaces (trash and folder markers excluded); `root` is the store folder (what to back up); `import` is the state of the
last import-disk job; `limits` are `max_file_bytes`, `max_read_bytes`, `max_list_page`. No credentials exist anywhere.

## Workspaces

A workspace = an account/project. Teams (and their `active` flag), tasks, deliveries, sessions, events, the COO
config and files are scoped to one. `default` (name "Default") holds everything created before
workspaces existed. Layout (`paths.mjs`: `workspaceDir()` / `defaultWorkspaceRoot()`): new installs and migrated ones use `<project>/workspaces/default` and `<project>/workspaces/<id>/`
(`BACKOFFICE_ROOT` = `<project>/workspaces`); a legacy install not yet migrated (`BACKOFFICE_ROOT` = `~/AgentOS`) keeps `default` = `~/AgentOS` and others in `~/AgentOS/workspaces/<id>/`.

**Session to workspace** (hooks and MCP), first match wins:
1. `BACKOFFICE_WORKSPACE` (hook payload `env.BACKOFFICE_WORKSPACE` / `backoffice_workspace` / `X-BackOffice-Workspace` header, or the MCP process env), if that workspace exists.
2. The workspace with the **longest `root` that is a path prefix of the cwd** (so `<project>/workspaces/acme/x` is `acme`, not `default`). Matching is by path segment (`acme` does not match `acme-otro`).
3. `default`.

The MCP server sends `X-BackOffice-Workspace` (if `BACKOFFICE_WORKSPACE` is set) or `X-BackOffice-Cwd` (its cwd) on every call,
and the server then treats the request as *strict*: tasks/teams of other workspaces do not exist for it (404).
`backoffice_overview`, `backoffice_team_context` and the COO/team context text mention the workspace.

**COO config** is per workspace (`workspace_agents`). A workspace without its own row uses blank values
(it does **not** inherit another account's COO context, to avoid leaking one client's text into another).

Deleting a workspace **archives** the row (`archived_at`). Tasks, DB rows, files on disk and bucket objects are never
deleted. Re-creating an archived id revives it.

## Env vars

| Variable | Meaning |
|---|---|
| `BACKOFFICE_PORT` | server port (default 4780) |
| `BACKOFFICE_DB` | SQLite path (default `<home>/backoffice.db`) |
| `BACKOFFICE_HOME` | folder for the database, the log and the local store at `<home>/store` (default `~/.agentos`) |
| `BACKOFFICE_ROOT` | parent folder of all workspace folders (default `<project>/workspaces`; legacy `~/AgentOS` if not migrated); also an allowed root for disk fallback serving |
| `BACKOFFICE_WORKSPACE` | force the workspace of a session / MCP process |

## Key layout

Bucket per workspace: `ws-<workspace id>` (lowercase, 3-63 chars). Top-level areas:
- `files/<path>`: the working files of the person and the agents, e.g. `files/marketing/inmobiliaria/facts.md`. Folders are implicit
  (key prefixes); `files/<dir>/.keep` is an empty-folder marker, hidden from listings.
- `outputs/<task_id>/...`: deliveries (below).
- `trash/<ts>/<original key>`: soft-deleted objects (nothing is ever erased); hidden from listings unless `include_trash=1`
  or an explicit `trash/` prefix.

Key rules: at most 1024 chars, no leading `/`, no `..`/`.` segments, no empty segments or trailing `/`, no backslash,
NUL or control characters, segments up to 240 bytes. The web may only modify `files/` (writes elsewhere: 403).

**Agent paths** are workspace-relative (`marketing/acme/facts.md` = key `files/marketing/acme/facts.md`). Legacy text keeps working:
`~/AgentOS/x`, `~/AgentOS/workspaces/<this workspace>/x`, the absolute workspace root, and a leading `/` are all normalized to `x`.

Delivery keys:
- file: `outputs/<task_id>/<file name>`
- folder: `outputs/<task_id>/<folder name>/<relative path>`; the output row stores the prefix in `storage_key` and
  `files` = `{ files: [{rel, key, size, content_type, sha256}], skipped: [{rel, reason}] }`.
- name collision inside one task: `outputs/<task_id>/<output id>/...`.

Disk-folder copy skips: `node_modules`, `.git`, `.next`, `dist`, symlinks, files over 50 MB, files beyond 500 per folder
(each recorded in `skipped` with a reason). Output columns: `storage_key, size, content_type, sha256, files` are in use; `bucket`, `uploaded_at` and `storage_error` are legacy (kept in the schema, `storage_error` is only set when a copy fails).
Links (`kind=link`) are never copied.

**Virtual deliveries** (`files: [...]`, below) have no disk path: the output row has `path = null` (stored as `''` in SQLite;
`virtual: true`, `exists` = stored), `storage_key` = the object under `outputs/<task_id>/`, and nothing is read from disk: the object is
copied inside the store (a folder becomes a folder output with `files.files[]`).

## API

Workspace selection on every endpoint under `/api/`: `?workspace=<id>` or header `X-BackOffice-Workspace`
(also `X-BackOffice-Cwd` for MCP). None = `default`. Unknown id = 404 `workspace_not_found`. For by-id routes (tasks,
teams, outputs) an explicit workspace that does not own the object gives 404; without it the lookup is lenient.

| Route | Notes |
|---|---|
| `GET /api/workspaces` | list with `counts` and `bucket` |
| `POST /api/workspaces` `{name, id?}` | slugifies the id, creates the root folder; 409 if the id exists |
| `GET /api/workspaces/:id`, `PATCH /api/workspaces/:id` `{name?, root?}` | |
| `DELETE /api/workspaces/:id[?force=1]` | archive only; refuses `default` (403) and non-empty without `force` (409) |
| `GET /api/workspaces/resolve?cwd=` | `{workspace}` by the longest-root rule |
| `GET /api/workspaces/:id/files?prefix=&recursive=1&limit=&cursor=&include_trash=1` | listing `{workspace, bucket, backend: 'local', prefix, folders:[{prefix,name}], files:[{key,name,size,last_modified,content_type}], next_cursor, truncated}`. Not recursive: one level (`name` relative to the prefix folder). Recursive: every file below, plus all folders (incl. empty ones); `name` is relative to `prefix`. `limit` 1-5000 (default 5000); `cursor` = previous `next_cursor` |
| `GET /api/workspaces/:id/object?key=[&download=1]` | stream one object (any key) |
| `PUT /api/workspaces/:id/object?key=files/...[&overwrite=0]` | raw-body upload, max 50 MB (413). Content type from the header, or from the extension when it is missing/generic. 201 created / 200 replaced `{key,size,sha256,content_type,created,overwritten}`; 409 if `overwrite=0` and it exists |
| `DELETE /api/workspaces/:id/object?key=files/...` | soft delete of a file or a whole folder -> `trash/<ts>/<key>`; `{key,kind,trashed,trash_prefix}` |
| `POST /api/workspaces/:id/move` `{from,to}` | rename/move a file or folder (keys under `files/`); 409 if the destination exists, 400 into itself. **Restore from trash** is a move whose source is `trash/<ts>/files/...` and whose destination is under `files/` |
| `POST /api/workspaces/:id/folder` `{prefix:'files/a/b'}` | creates `files/a/b/.keep` (hidden marker); 201 `{prefix:'files/a/b/'}` |
| `GET /api/workspaces/:id/zip?prefix=files/a` | streams `a.zip` (store-only, streamed, max 5,000 files / 1 GiB) for "Download folder" |
| `POST /api/workspaces/:id/import-disk` `{root?}` `[?wait=1]` | one-time ingestion of the workspace root (or an allowed `root`) as `files/<relative path>`; idempotent, never overwrites existing keys; skips `node_modules .git .next dist`, symlinks, `.DS_Store`, files > 50 MB, other workspaces' roots; caps 5,000 files / 2 GiB |
| `GET /api/storage/status` | `{backend:'local', root, usage:{files,bytes}, import, limits}` (see Storage) |
| `GET /api/files/:outputId[?file=<rel>][&download=1]` | stream a deliverable (stored copy, or the disk path inside an allowed root as a fallback) |
| `GET /api/outputs/:id/files` | files of a folder output `{kind, files:[{rel,size,content_type,stored}], skipped}` |
| `GET/POST /api/tasks`, `GET/PATCH /api/tasks/:id`, `POST /api/tasks/:id/outputs` | deliver uploads to storage and returns the task with storage fields |
| `GET /api/overview`, `GET /api/context?agent=`, `GET/PATCH /api/system[/coo]`, `/api/teams*`, `/api/sessions`, `/api/events`, `/api/outputs`, `POST /api/checkin` | per workspace |
| `GET /api/stream?workspace=` | SSE; snapshot `{workspace, workspaces, sessions, tasks, teams, system}`; events: `session`, `task`, `teams`, `system`, `workspaces` (global), `files` (workspace-scoped: `{workspace_id, op:'put'\|'delete'\|'move'\|'folder'\|'import', key?, from?, to?, count}`) |
| `POST /api/tasks/:id/outputs` | `{files:[...]}` (virtual) and/or `{path, kind, title}` (disk). See below |

Agent-facing routes (what the MCP tools call; workspace from `X-BackOffice-Workspace` / `X-BackOffice-Cwd` like every other route):
`POST /api/files/write`, `GET /api/files/read?path=&max_bytes=`, `GET /api/files/list?prefix=&recursive=1&cursor=`, `POST /api/files/delete`, `POST /api/files/move`.
Writes and reads are refused with a clear error above the limits. All mutating routes reject a foreign `Origin` header (403).

Served files carry `X-Content-Type-Options: nosniff`; HTML/SVG also get `Content-Security-Policy: sandbox allow-scripts`.
The disk fallback resolves `realpath` and requires it to sit inside a workspace root, `~/AgentOS` or `BACKOFFICE_ROOT`
(symlink escapes and `..` rejected). Range requests are not supported.

## MCP tools

All scoped to the session's workspace (`BACKOFFICE_WORKSPACE`, else the cwd rule). Paths are workspace-relative.

| Tool | Arguments | Result |
|---|---|---|
| `backoffice_file_write` | `path`, `content` (utf-8) or `content_base64`, `content_type?`, `overwrite?` (default true) | `{path,size,sha256,content_type,created,overwritten}` |
| `backoffice_file_read` | `path`, `max_bytes?` | text: `{path,size,content_type,encoding:'utf-8',content,truncated}`; binary: `encoding:'base64', content_base64`. Over 5 MB: error (unless `max_bytes` asks for the beginning of a text file) |
| `backoffice_file_list` | `prefix?`, `recursive?`, `cursor?` | `{prefix, folders:[{path,name}], files:[{path,name,size,mtime,content_type}], next_cursor, truncated}`; trash excluded |
| `backoffice_file_delete` | `path` (file or folder) | `{path,kind,trashed,trash_prefix}`; soft delete |
| `backoffice_file_move` | `from`, `to` | `{from,to,kind,moved}`; error if `to` exists |
| `backoffice_task_deliver` | `id`, `files?: [{path} \| {name, content\|content_base64, content_type?} (+ title?, kind?)]`, `path?`, `kind?`, `title?` | the task with outputs. `path` (disk) is for code projects that must run on disk |

The SessionStart/SubagentStart context, `backoffice_team_context` and `backoffice_overview.files_hint` carry a short note telling agents to use these
tools, never ask for disk paths, and deliver with `files`.

## Importing existing disk content

`POST /api/workspaces/:id/import-disk` (see API) ingests a workspace folder as `files/<relative path>`: idempotent, never overwrites
a key that already exists, throttled, with progress in `GET /api/storage/status` -> `import`. At boot the `default` workspace
folder (`~/AgentOS`) is imported once in the background (`settings` row `import.disk.default`; skipped while the folder does
not exist yet). In the web it is the "Importar carpeta del equipo" button of the storage card.

## Limits

| Limit | Value |
|---|---|
| One file (write, upload, delivery, disk copy) | 50 MB |
| `backoffice_file_read` | 5 MB |
| Listing page | 5,000 entries (scan cap 20,000 objects) |
| Folder delete / move / ZIP | 5,000 files; ZIP also 1 GiB (no ZIP64) |
| Files per delivery call | 100 |
| Import-disk | 5,000 files, 2 GiB, 50 MB per file |
| Key | 1024 chars, segment 240 bytes |

Configurable only in code (`createApp({limits})`, see `DEFAULT_LIMITS` in `files.mjs`).

## Migration (database)

Migrations 5-9 (`db.mjs`) are idempotent and self-contained (columns are added only if missing). They create
`workspaces` (seed `default`, root `~/AgentOS` or `BACKOFFICE_ROOT`), add `workspace_id TEXT NOT NULL DEFAULT 'default'`
to `sessions, tasks, outputs, teams, events` (so every existing row lands in `default`), create `workspace_agents`
and copy `system_agents` into it for `default`, and add the storage columns to `outputs` (`bucket`, `uploaded_at` and
`storage_error` are legacy and no longer meaningful); migration 9 adds the `settings` key/value table (one-time import flags).
`system_agents` is left untouched (unused now). Tested against a database built with the old schema. New migrations must be
appended at the end.

## Security notes

- The server binds 127.0.0.1; the `Host` header is checked against localhost (DNS rebinding).
- The web reads files through `/api/files` and `/api/workspaces/:id/object`, never the disk directly; no CORS keys needed.
- Mutating requests with a non-localhost `Origin` are refused; bodies are size-capped; HTML/SVG are served with `Content-Security-Policy: sandbox allow-scripts`.
- Local store: keys validated, symlinks refused at every segment, files created `0600`.

## Tests

`cd plugins/backoffice/server && node --test test/*.test.mjs`. `test/files.test.mjs` covers the blob store (put/get/list/copy/delete,
key validation, symlinks), the web API (upload/list/move/trash/restore/zip/import/SSE), the MCP file tools (workspace isolation, legacy
paths, limits) and virtual deliveries; the ZIP is checked with python3 `zipfile` and `unzip -t` when available.
`test/workspaces.test.mjs` covers workspace isolation, deliveries copied into the store and file security.
