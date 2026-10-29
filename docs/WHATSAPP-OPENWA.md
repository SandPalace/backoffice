# WhatsApp via open-wa: verified facts for maintainers

Verified 2026-10-15 by reading the published packages (`@open-wa/wa-automate@5.6.2`, published the same day, plus
`@open-wa/{api,config,core,schema,mcp}` 5.x pulled by `npx`) and by running `npx -y @open-wa/wa-automate@latest` once
(no login, no QR scanned, process killed). Sources: https://github.com/open-wa/wa-automate-nodejs, https://openwa.dev
(CLI reference: https://openwa.dev/docs/guides/configuration-and-cli), the package README and `dist/` code.

## Gotchas that shaped the design

1. **`--help` is not implemented.** The v5 CLI treats it as "start the server" (default port 8080, dashboard 3000,
   it launches Chrome and prints a QR). Never run it as a dry check; read `dist/cli-runtime-*.cjs` (`parseCliArgs`).
2. **The v5 CLI does NOT register webhooks.** `--webhook/-w` is parsed but the CLI logs
   `Webhook configured (...) but v5 CLI webhook registration parity is not yet restored.` The CLI also never passes
   `plugins`/`pluginConfig` (the `@open-wa/integration-webhook` plugin only works when embedding `createClient`).
   `--ready-webhook`, `--tunnel`, `--stats`, Chatwoot/Twilio/BotPress flags are likewise unwired.
   The old v4 line (last release 4.76.0, 2025-02) has working `-w` but predates 20 months of WhatsApp Web changes; not used.
3. **Our workaround:** `scripts/whatsapp-bridge.mjs` (zero deps, started by the launcher) subscribes to open-wa's SSE
   stream and re-posts each message to Back Office as an EASY-API-style webhook (shape below).
4. Version is pinned (`WA_VERSION="5.6.2"` in both launchers and `scripts/whatsapp-dev.sh`) because the CLI changes
   between minors. Re-verify before bumping.

## CLI flags (v5.6.2, `parseCliArgs`)

| Need | Flag / env | Notes |
|---|---|---|
| Port | `--port`, `-p` (env `WA_PORT`) | default 8080 |
| Bind host | `--host`, `-h` (env `WA_HOST`) | default `localhost`; we pass `127.0.0.1` |
| Session id | `--session-id` (env `WA_SESSION_ID`) | we use `backoffice` |
| Session data dir | env `WA_SESSION_DATA_PATH` (config `sessionDataPath`) | no CLI flag; "directory or explicit .data.json filename; defaults to `{sessionId}.data.json` in the working directory". We set it to `~/.agentos/whatsapp` AND run with that cwd (open-wa also writes `.open-wa/` and a patches cache in cwd). Verified via `resolveConfig`. |
| API key | `--api-key`, `--key`, `-k` (env `WA_API_KEY`) | min 8 chars. The launcher uses the env var so the key does not show in `ps`. |
| Webhook | `--webhook`, `-w` | parsed, **not wired** (see above) |
| No dashboard | `--no-dashboard` | otherwise a dashboard sidecar starts on port 3000 |
| QR in terminal | default (`ezqr` on, QR printed in the foreground; refreshes about every 60 s) | `--no-ezqr` disables the `/qr` endpoint. Headless Chrome by default (`--headful` to show it). |
| License | `--license-key`, `-l` | NOT needed for what we use: schema marks `sendText`, `getConnectionState` and the `onMessage` event `license: "none"`. Per the `sendText` description, **starting a chat with a new number** needs a restricted/premium license. We only reply to people who wrote in. |
| Browser | needs installed Chrome/Chromium (found automatically; else interactive prompt to download; `--use-chrome`, `--use-chromium`, `--non-interactive`) | |
| Node | no `engines` field in the packages; Back Office already requires Node 22.13+/24 | bridge uses global `fetch` |

## HTTP API (Easy API) and auth

- Auth header: **`X-API-Key: <key>`** (also accepted, deprecated: `api_key`/`key` header or query param). Applies to `/api/*`
  and `/api/events`. `GET /health` is served without the key.
- Send text: `POST /api/sendText` (canonical `/api/messages/sendText`), JSON body either flat or wrapped:
  `{"args": {"to": "5218112345678@c.us", "content": "texto"}}` (flat `{"to","content"}` also works; `args` may also be a positional array).
  Success: `{"success": true, "data": "true_5218112345678@c.us_3EB0..."}` (serialized message id; confirms accepted, not delivered).
  Errors: `{"error","details"}` with a status; 503 + `Retry-After` while the session is not ready.
- Connection state: `GET /api/getConnectionState` (canonical `/api/session/getConnectionState`) returns the state string in `data`
  (e.g. `CONNECTED`). Cheaper readiness check without a key: `GET /health` -> `{"connected": true|false, "session": {"ready": bool, ...}, "qr": ...}`.
- Other: `GET /qr` (QR as data, if `ezqr`), `GET /api-docs/`, `GET /meta/swagger.json`.
- Rate limit on `/api/*`: 100 requests/min.

## Events

- `GET /api/events?topics=onMessage[,onAck,...]` (Server-Sent Events, `X-API-Key` header). Frame:
  `id: <n>\nevent: onMessage\ndata: {"id","event":"onMessage","payload":<Message>,"ts":<ms>,"sessionId":"backoffice"}\n\n`;
  keepalive comment every 20 s. No replay: events while disconnected are lost (the bridge reconnects every 3 s).
- Event names include `onMessage` (incoming only, not own messages), `onAnyMessage`, `onAck`, `onStateChanged`, `onLogout`, `onReaction`, `onIncomingCall`, ...
- `Message` payload fields (zod `MessageSchema`): `id, body, type, t, timestamp, notifyName, from, to, self, ack, isGroupMsg, isMedia, isNotification, fromMe, chat, chatId, author, sender, senderId, quotedMsg, mentionedJidList, caption, ...`.
  Chat ids look like `5218112345678@c.us` (person) / `...@g.us` (group; Back Office ignores groups).

## What Back Office receives (bridge output = EASY API webhook shape)

`POST http://127.0.0.1:4780/api/whatsapp/webhook?secret=<BACKOFFICE_WA_WEBHOOK_SECRET>`, `content-type: application/json`:

```json
{ "ws_id": "backoffice", "event": "onMessage", "data": { "id": "...", "body": "hola", "chatId": "5218112345678@c.us", "from": "5218112345678@c.us", "fromMe": false, "isGroupMsg": false, "notifyName": "Laura", "t": 1760000000, "sender": {"pushname": "Laura"} }, "ts": 1760000000000 }
```

4xx from the server = dropped (not retried); network errors retried 4 times (1, 2, 4, 8 s).
`data` is the open-wa Message exactly as received (so the server should read `chatId`, `body`, `notifyName`/`sender.pushname`,
`t`/`timestamp`, `fromMe`, `isGroupMsg`, `type`). The bridge only forwards `onMessage`.

## Env (all in `~/.agentos/.env`, mode 600)

`BACKOFFICE_WA_URL` (default `http://127.0.0.1:8002`), `BACKOFFICE_WA_API_KEY`, `BACKOFFICE_WA_WEBHOOK_SECRET` (both random 48 hex chars generated by
`backoffice whatsapp` on first run, existing keys untouched). Acceptance of the risk notice: `~/.agentos/whatsapp-accepted`.
Session + browser state: `~/.agentos/whatsapp/` (`backoffice whatsapp --reset` deletes it).

## Not verified (needs a real login, deliberately not done)

Real `onMessage` payload on a linked account, QR scan flow, session restore after restart, behaviour under WhatsApp anti-automation.
