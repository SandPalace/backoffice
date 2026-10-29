# Web sign-in (local authentication)

The web office asks for a username and password. They are **not created in the web**: the owner writes them in a file
on their own computer, and the sign-in form checks them.

## Set it up

Create `~/.agentos/.env` (the folder can be moved with `BACKOFFICE_HOME`):

```
BACKOFFICE_USER=your-user
BACKOFFICE_PASSWORD=a-long-password
```

then `chmod 600 ~/.agentos/.env`. Template: `plugins/backoffice/server/.env.example`.

Other sources, per key, first one found wins: environment variables `BACKOFFICE_USER` / `BACKOFFICE_PASSWORD` →
`~/.agentos/.env` → `~/.agentos/config.json` (`{"user": "…", "password": "…"}`).

- The file is re-read on every sign-in: editing it needs no restart. Changing the user or password signs out every open session.
- Without credentials the web shows "Falta configurar tu acceso" and nobody gets in. The server logs a hint at startup, and
  warns when the file is readable by other users.
- `BACKOFFICE_AUTH=off` turns sign-in off (development only).

## What it protects (and what it does not)

- **Protected:** every request from a browser (it carries `Origin` or `Sec-Fetch-Site`) to `/api/*` needs a session:
  HttpOnly cookie `backoffice_session`, `SameSite=Lax`, 30 days. Only the token's SHA-256 is stored (`auth_sessions`).
  Five wrong attempts lock sign-in for a minute.
- **Not gated:** local processes without those headers: Claude hooks (`/hooks/*`), the MCP server, `curl`. They run as the
  same OS user, who can already read `~/.agentos`. The server listens only on `127.0.0.1`.
- The password is plain text in the owner's own file, by design. Never commit it.

The web and the server must be opened with the same hostname (`localhost` with `localhost`, or `127.0.0.1` with
`127.0.0.1`): the web derives the server URL from its own hostname so the cookie stays same-site.
