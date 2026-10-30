# Back Office (installed copy) — install, update and repair runbook

This folder is a Back Office install: ONE Claude plugin (`backoffice-<slug>` for the company in `data/.env`, or the generic
`backoffice`), a local server and a web office on this folder's port pair (`BACKOFFICE_PORT`/`BACKOFFICE_WEB_PORT` in
`data/.env`; 4780/4781 when unset). Below, «4780/4781» means THIS folder's pair (`./bin/backoffice status` prints it).
Talk to the person in Mexican Spanish; these instructions stay in English. Use this file when they ask to install,
update, check or repair Back Office («revisa y repara mi Back Office», «actualiza Back Office», «algo no funciona»). For daily work
(sales, marketing...) follow each agent's own instructions. On Windows use `.\bin\backoffice.cmd` wherever it says
`./bin/backoffice`, and PowerShell equivalents (`curl.exe`, `Select-String`). Tell the person in one line what each step does.

## How Back Office works (read this first)

- **One Back Office = one company.** This folder is a copy of the public repo (agent and skill templates) that the person
  adapts to ONE company. There is no project selector: everything lives in the single workspace `default` (the name shown
  top-left is the company; «Renombrar» changes it). Another company = another clone in its own folder
  (`<project folder>/.backoffice`, e.g. `~/Documents/Acme/.backoffice`), its own data, its own CEO, its own plugin `backoffice-<slug>` and its own port pair
  (the installer picks the next free one: 4780/4781, 4782/4783, …). Several can run at the same time. Never copy one
  company's data into another's Back Office.
- **The pieces:** Claude (Desktop Chat/Cowork/Code or the terminal) runs the agents; the plugin `backoffice` gives them their
  instructions, skills and the `backoffice_*` tools; the local server keeps tasks, leads, files and Boards in `data/`; the web
  (http://localhost:4781) is where the person watches, reviews and approves.
- **Tabs:** Inicio (the company status page the CEO keeps current), Tareas (only the person marks `done`), **Boards**
  (artifacts agents publish for review: dashboards, reports, drafts; tools `backoffice_artifact_*`), Leads, Equipos (which
  teams are active), Archivos (the company's files and the knowledge base in `company/`).
- **Knowledge base:** `company/` in Archivos (`profile.md`, `facts.md`, `goals.md`, `rules.md`, `open-questions.md`), built
  by the CEO from the owner's own answers. Every agent reads it before working; facts without a source are not used.
- **Who starts:** after install (and migration), the person opens the CEO as the main agent (`claude --agent backoffice-<slug>:ceo`
  with a company plugin; `claude --agent backoffice:ceo` without one)
  and says «Arranca mi empresa con el checklist del C-board» (skill `company-kickoff`, section «Company kickoff» below).

## Fresh install («Instalación nueva», «instala Back Office para mi empresa»)

1. The folder must be a fresh clone of `https://github.com/SandPalace/backoffice.git` in `.backoffice` inside the
   company's project folder (e.g. `~/Documents/Acme/.backoffice`; Windows `$HOME\Documents\Acme\.backoffice`). If the target
   exists, stop and ask; never clone over it. If the project folder is a git repo, add `.backoffice/` to its `.gitignore`.
2. Run `./install.sh` (Windows `.\install.ps1`) from this folder. It asks the company name (saved as `BACKOFFICE_COMPANY` +
   slug in `data/.env`, with a free port pair) and the office user and password: THEY type them; never read or print
   `data/.env`. Without a terminal, ask the company name and pass it as `BACKOFFICE_COMPANY="<Empresa>" ./install.sh`.
   Accept its prompts to update Claude's config only after telling the person. It builds and installs the company plugin
   `backoffice-<slug>` (`dist/company-plugin/`) and offers to remove the generic `backoffice@backoffice` of this folder.
3. `./bin/backoffice start`, then the Health check below. Open the web port it prints (http://localhost:4781 for the first one).
4. Claude Desktop (Chat/Cowork): section «Connect Back Office to Chat and Cowork». Then «Bring data from AgentOS» if the
   person had AgentOS, and «Company kickoff».

## Bring data from AgentOS («Traer datos de AgentOS», «migra mi AgentOS»)

The old AgentOS Local (usually `~/Documents/AgentOS`, sometimes `~/AgentOS` + `~/.agentos`) may hold several projects.
This Back Office takes ONE of them (this company); the others go to their own Back Office later.

1. `node scripts/import-agentos.mjs --from "<old folder>" --list` → show the old projects and their counts; the person picks one.
2. `node scripts/import-agentos.mjs --from "<old folder>" --workspace <id>` → plan only; show it in plain Spanish.
3. With the person's explicit OK: `./bin/backoffice stop && node scripts/import-agentos.mjs --from "<old folder>" --workspace <id> --yes; ./bin/backoffice start`
   (it backs up this install first). It copies tasks, deliveries, leads, Boards, teams and agent contexts, WhatsApp drafts,
   the profile and the files; it never modifies, moves or deletes the old folder, and running it twice does not duplicate.
4. Health check, then show the person what arrived in the web. If the old clone still points to `SandPalace/agentos` or
   `kikirrins/agentos`, leave it alone: it is only read.

## Company kickoff (C-board checklist, «arranca mi empresa»)

Owned by the `ceo` agent, skill `company-kickoff` (`backoffice-<slug>:company-kickoff`; generic `backoffice:company-kickoff`),
run as the main agent so it can delegate (`claude --agent backoffice-<slug>:ceo`):
0 connection → 1 migration (delegated to `operations-chief`) → 2 configure (company name, ≤3 teams, profile) →
3 Q&A rounds → knowledge base `company/*.md` + area deep-dives (`cmo`, `sales-lead`, `cfo`) → 4 company status dashboard
published as the home (Inicio, also in Boards) → 5 step-by-step plan in `executive/<date>-plan/plan.md` + first-week tasks.
If someone asks another agent to «arrancar la empresa», point them to the CEO.

## Layout (everything inside this folder)

| What                                                                                                              | Where                                                 | Env var        |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------- |
| DB, files, `.env` (web login), logs, run/pid, browser profiles, WhatsApp, OpenWA                                  | `data/`                                               | `BACKOFFICE_HOME` |
| Work folders: `workspaces/default`, `workspaces/<id>`                                                             | `workspaces/`                                         | `BACKOFFICE_ROOT` |
| The Claude plugin: all agents (`agents/`), skills (`skills/`), teams (`teams/<id>/team.json`), server, hooks, MCP | `plugins/backoffice/`                                    |                |
| Launcher                                                                                                          | `./bin/backoffice start\|stop\|status\|update\|backup\|check\|mcp-key\|whatsapp` |                |
| Company name/slug and port pair (installer), web login                                                            | `data/.env`                                           | `BACKOFFICE_COMPANY`, `BACKOFFICE_PORT`, `BACKOFFICE_WEB_PORT` |
| Company plugin `backoffice-<slug>` (local marketplace), rebuilt by install and update                             | `dist/company-plugin/`                                |                |
| Claude Desktop extension (fallback for Chat/Cowork), rebuilt by install and update                                | `dist/backoffice-<slug>.mcpb` (no company: `dist/backoffice.mcpb`) |                |

- `data/` and `workspaces/` are git-ignored: never uploaded, never deleted by an update. Backups made before an update
  (`./bin/backoffice backup`) live in `backups/backoffice-<date>/` (git-ignored too; restore = stop, rename `data/` aside, copy the
  backup's `data/` back).

### Your work is safe («¿se borra mi trabajo si actualizo?»)

An update (`git pull --ff-only` + `./bin/backoffice update`) never overwrites the person's work. Everything they create
lives in `data/` (database, files, deliveries, web password, logs, WhatsApp) and `workspaces/` (every project folder,
including the `.claude/agents/<id>.md` copies the **Equipos** editor saves per project): both are ignored by git, so a
pull does not touch them, and the installer and `update` only add what is missing. The only risk is a file that comes
from the repo and the person edited (e.g. an agent in `plugins/backoffice/agents/`): `git status --porcelain` shows it. Then
STOP and ask: keep their version aside with `git stash push -m "mis cambios <fecha>"` (and `git stash pop` after the
update if they want it back), or keep it and skip the update. Never `git reset --hard`, `git clean`, `git checkout --
<file>`, `git pull --force`/`git fetch` + reset, or delete-and-reclone. If `git pull --ff-only` refuses («Not possible to
fast-forward», «would be overwritten by merge», «untracked working tree files would be overwritten»), explain it in one
line, show the files it names and ask; never force it.

- **One plugin per company.** With `BACKOFFICE_COMPANY` in `data/.env` the plugin is `backoffice-<slug>@backoffice-<slug>`, a
  copy of `plugins/backoffice` generated in `dist/company-plugin/` (git-ignored) by `scripts/build-company-plugin.mjs` on
  install and on every `./bin/backoffice update`: its agents are `backoffice-<slug>:<agent>`, its tools
  `mcp__plugin_backoffice-<slug>_backoffice__*`, its hooks post to this folder's port, and its `company.json` tells the MCP
  which folder and port are this company's (it wins over any `env`). Without a company: the generic `backoffice@backoffice`.
  Do not keep both for the same folder (every agent shows up twice): `claude plugin uninstall backoffice@backoffice`.
- **Generic plugin, `backoffice@backoffice`.** Teams (Marketing, Ventas, Cobranza, Dirección, Finanzas, Desarrollo web) are a
  feature of the app: the person builds teams in the **Equipos** tab from the roster. Versions before 2026-10-22 had 7
  plugins (`agentos-core`, `marketing-team`, `sales-team`, `collections-team`, `executive-team`, `finance-team`,
  `dev-team`); `./bin/backoffice update` migrates them automatically.
- Hooks and MCP run from Claude's plugin cache. A company plugin finds this folder through its `company.json`. The generic one
  finds it through `BACKOFFICE_HOME`/`BACKOFFICE_ROOT` in
  `~/.claude/settings.json` (`env`) and in Claude Desktop's `mcpServers.backoffice.env`; when those vars are missing (a plugin
  added from Claude Desktop, which Cowork uses) the MCP reads those same two files, then tries `~/Documents/AgentOS`.
  Claude's config is the ONLY thing Back Office touches outside this folder (no global command, no PATH change).
- **Hard rule for every agent: NEVER write to `data/` or the database (`data/backoffice.db`, `data/store/`) directly** (no
  `sqlite3`, no file writes there). Tasks, files and Boards artifacts are created ONLY with the Back Office tools
  (`backoffice_*`). If those tools are missing, STOP and tell the person how to connect them («Connect Back Office to Chat and
  Cowork» below); a hand-written row or file looks broken in the web.

## Health check («revisa mi Back Office»)

Run each from this folder; compare with the expected output. Stop at the first failure and go to Troubleshooting.

| #   | Command                                                                                                                                                                                                                                               | Expected                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `./bin/backoffice status`                                                                                                                                                                                                                                | `Servidor: corriendo (puerto 4780)` and `Oficina web: corriendo -> http://localhost:4781`                                |
| 2   | `curl -s http://localhost:4780/api/auth/status`                                                                                                                                                                                                       | `{"enabled":true,"configured":true,...}` (`authenticated:false` is normal from curl)                                     |
| 3   | `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4781/`                                                                                                                                                                                     | `200`                                                                                                                    |
| 4   | `claude plugin list`                                                                                                                                                                                                                                  | `backoffice-<slug>@backoffice-<slug>` (company) or `backoffice@backoffice` (no company), `Status: ✔ enabled`, NOT both for this folder, and NONE of the old `*@agentos` plugins |
| 5   | `grep -o '"mcp__plugin_backoffice_backoffice"' ~/.claude/settings.json`                                                                                                                                                                                     | `"mcp__plugin_backoffice_backoffice"` (only if the person allowed it at install; absent = Claude asks each time, not an error) |
| 6   | macOS: `grep -o 'plugins/backoffice/server/src/mcp.mjs' "$HOME/Library/Application Support/Claude/claude_desktop_config.json"` · Windows: `Select-String -Path "$env:APPDATA\Claude\claude_desktop_config.json" -Pattern 'plugins\\\\backoffice\\\\server'` | one match (Claude Desktop's `backoffice` MCP points to this folder)                                                         |
| 7   | `node scripts/build-roster.mjs`                                                                                                                                                                                                                       | `7 teams, 26 agents, 82 skills (1 plugin: backoffice)` (or «roster.json already up to date»)                                                                      |
| 8   | In a NEW Claude session: «¿qué herramientas de Back Office tienes?»                                                                                                                                                                                       | it lists `mcp__plugin_backoffice_backoffice__backoffice_*` tools (tasks, epics/stories/sprints, files, leads, boards, roster...)                     |
| 9   | `curl -s http://localhost:4781/api/auth/status`                                                                                                                                                                                                       | the same JSON as check 2 (the web proxies the API: the browser only talks to 4781)                                       |
| 10  | `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4780/mcp`                                                                                                                                                                          | `401`: the HTTP MCP for other clients is up and asks for its key (`./bin/backoffice mcp-key` says where the key is)          |
| 11  | Ask the person: Claude Desktop → Customize → Plugins shows `backoffice` installed (or, fallback, Settings → Extensions shows «Back Office» enabled); then in a NEW Cowork session: «¿Qué equipos y agentes tengo en Back Office?»                                  | Claude answers with their teams and agents (it called `backoffice_overview` or `backoffice_roster`)                             |

Check 8 from the terminal: `echo 'List your tools that start with mcp__plugin_backoffice_backoffice__ and print the count' |
claude -p --agent backoffice:sales-lead --allowedTools mcp__plugin_backoffice_backoffice` (prompt on stdin). With a company
plugin use `backoffice-<slug>` in the agent and `mcp__plugin_backoffice-<slug>_backoffice` in the tool prefix and allow rule
(checks 5 and 8); the Desktop entry of check 6 is `mcpServers["backoffice-<slug>"]`. Ports: use this folder's pair.
If 1–8 pass, Back Office is fine; ask the person what exactly looks wrong and use the table below.

## Connect Back Office to Chat and Cowork («conecta Back Office a Cowork», «Cowork no ve Back Office»)

A plugin installed from the terminal (`claude plugin install`, what `install.sh` and `update` do) is for Claude Code only;
Claude Desktop's Chat and Cowork load plugins from the person's account. Walk the person through it (you cannot click):

Also «Configurar el plugin y el MCP en Claude Desktop» (INSTALL.md has the Spanish step by step to show the person).
`<slug>`: `./bin/backoffice status` prints «Empresa: … (plugin backoffice-<slug>)»; no such line = generic plugin `backoffice`.

0. **Claude Code (terminal) first:** `claude plugin list` must show `backoffice-<slug>@backoffice-<slug>` enabled. If not:
   `node scripts/build-company-plugin.mjs --register` (builds `dist/company-plugin/`, `claude plugin marketplace add` +
   `install`). In `claude`: `/plugin` lists it; `/mcp` shows `plugin:backoffice-<slug>:backoffice` connected.
1. **Plugin (recommended: agents, skills, hooks and the Back Office tools).** Claude Desktop → **Customize** (Personalizar) →
   **Plugins** → **Add marketplace** → the folder `<this folder>/dist/company-plugin` → install **backoffice-<slug>**
   (generic: marketplace `SandPalace/backoffice` → **backoffice**). Restart Claude Desktop, open a NEW Cowork session and ask
   «¿Qué equipos tengo?». The server should be running (`./bin/backoffice start`); the tools try to start it themselves.
2. **Fallback: the desktop extension** (only the Back Office tools; also works in Chat). If step 1 is not possible or Cowork
   still has no Back Office tools: Claude Desktop → **Settings** (Ajustes) → **Extensions** → **Install extension…** → choose
   `dist/backoffice-<slug>.mcpb` in this folder (generic: `dist/backoffice.mcpb`; `./install.sh` and `./bin/backoffice update`
   build it; or `node scripts/build-mcpb.mjs`). It is named «Back Office · <Empresa>» and its «Carpeta de Back Office» is
   already this folder (generic: choose this folder). It reads this folder's ports from `data/.env`. Restart Claude Desktop.
   Several companies = several extensions side by side, one per folder.
3. **Check:** Health check 11. If a tool answers «Back Office está apagado…», run `./bin/backoffice start`. If it answers «No
   encuentro tu carpeta de Back Office…», fix the folder in Settings → Extensions → Back Office.
4. The web is http://localhost:4781 (also inside Cowork's browser: the page only talks to 4781). Agents return direct links
   such as `http://localhost:4781/canvas?ws=<project>&artifact=<id>` that open the project and the card.

### Other MCP clients (Codex, OpenCode, Cursor...)

They connect over HTTP: URL `http://127.0.0.1:4780/mcp`, header `Authorization: Bearer <key>`. `./bin/backoffice mcp-key`
says where the key file is and how to copy it to the clipboard; the person pastes it into the client's config. Never print
or paste the key in chat. Per-client examples: `docs/API.md`.

## Update («actualiza Back Office»)

**Use the `backoffice:update-backoffice` skill** (it loads with the plugin): it runs the read-only diagnosis
`node scripts/update-check.mjs` (folder, data and size, local vs latest version, edited files, old layout, Claude config,
office running), picks ONE plan from its decision table, backs up `data/` + `workspaces/` with `./bin/backoffice backup` (into
`backups/`, git-ignored, last 3 kept), runs the plan and checks health. The steps below are the fallback when the skill is
not available (old plugin, or the person asks to do it by hand); the rules are the same.

0. **Where is it?** If this folder is not inside `~/Documents` (e.g. `~/AgentOS-app`), offer «Moving Back Office to
   Documents» first (optional; an update works anywhere).
1. **Local changes.** `git status --porcelain`. An update never overwrites the person's work (see «Your work is safe»):
   `data/` and `workspaces/` never show up there. Files changed that come from the repo: do not discard them; show them
   and ask whether to keep them aside with `git stash push -m "mis cambios <fecha>"` or to stop. Never `git reset
--hard`, `git clean`, `git checkout -- <file>` or a forced pull.
2. **Pull first, then update.** `./bin/backoffice stop`, `git pull --ff-only`, then `./bin/backoffice update`. (Pull first: an
   old launcher is replaced while it runs.) If `git pull --ff-only` refuses, do not force it: explain, show the files it
   names, ask. `update` prints 4 steps: pull, stop, `npm ci` + web build, plugin. Step 4
   runs `node scripts/migrate-plugins.mjs`, which: uninstalls each old plugin (`agentos@agentos`, or the 7 `<team>@agentos`)
   and the old `agentos` marketplace, refreshes the `backoffice` marketplace (or re-registers it here if it pointed to
   another folder), installs or updates `backoffice@backoffice`, rewrites the old allow rules (`mcp__plugin_agentos_agentos`,
   `mcp__plugin_agentos-core_agentos` → `mcp__plugin_backoffice_backoffice`) and `AGENTOS_*` env keys → `BACKOFFICE_*` in
   `~/.claude/settings.json`, renames Claude Desktop's `agentos` MCP entry to `backoffice` pointing to
   `plugins/backoffice/server/src/mcp.mjs`, and fixes `BACKOFFICE_HOME`/`BACKOFFICE_ROOT` and saved project paths that still
   point to an old location of this folder (backups `*.backoffice-backup`; every other setting is kept). With a company in
   `data/.env` it skips the generic `backoffice` marketplace/plugin (never re-points it: it may be another company's) and
   instead regenerates `dist/company-plugin/` and installs or updates `backoffice-<slug>@backoffice-<slug>` (reinstalled when
   its version changes, e.g. new ports), then offers to remove this folder's generic plugin.
2b. **AgentOS → Back Office.** The first update after the rename also migrates this install in place (the folder stays
   where it is): it backs up `data/` + `workspaces/` first (into `backups/`; if the backup fails nothing changes), renames
   `data/agentos.db` → `data/backoffice.db` (only with the server stopped; otherwise on the next update — the server keeps
   using `agentos.db` meanwhile), updates agent copies edited in Equipos (`workspaces/*/.claude/agents/<id>.md`,
   `~/.claude/agents/<id>.md`) to the new tool names, and prints what is left by hand: restart Claude sessions; in Claude
   Desktop/Cowork remove the «agentos» plugin and add «backoffice» from the same marketplace; reinstall `dist/backoffice.mcpb`
   if the person used `agentos.mcpb`. `./bin/agentos …` keeps working for one release (it calls `./bin/backoffice`).
3. **Old launcher.** If the person ran an old `./bin/agentos update` directly, the migration still runs (that launcher calls
   the new `scripts/migrate-plugins.mjs` after the pull, and very old ones run it from the web install step) and they may
   see «Plugin "…" not found in marketplace» errors for the old plugins: expected, harmless.
4. **Stopped halfway?** Everything is idempotent; re-run what failed:
   - pull failed → fix the network or local changes, then `git pull --ff-only`;
   - `git pull` complains about the remote (the repo moved to `SandPalace/backoffice`; `SandPalace/agentos` is no longer it): `git remote set-url origin https://github.com/SandPalace/backoffice.git`, then pull again;
   - `npm ci`/build failed → `./bin/backoffice update` again (it repeats only what is needed);
   - plugin step failed or old plugins still listed → `node scripts/migrate-plugins.mjs` (safe to run any number of times);
   - by hand, last resort: `claude plugin uninstall <old>@agentos` for each old one, `claude plugin marketplace remove
agentos`, `claude plugin marketplace add "$PWD"`, `claude plugin install backoffice@backoffice`.
5. **Old folder layout** (before 2026-10-16 everything lived in `~/.agentos` and `~/AgentOS`; Windows
   `%USERPROFILE%\.agentos`, `%USERPROFILE%\AgentOS`). If either exists:
   - `node scripts/migrate-to-project-folder.mjs` (plan only) and show the plan;
   - with the person's OK: `./bin/backoffice stop`, then `node scripts/migrate-to-project-folder.mjs --yes`. It copies into
     `data/` and `workspaces/`, fixes paths in the DB, publishes `BACKOFFICE_HOME`/`BACKOFFICE_ROOT` to Claude and renames the old
     folders `*.migrado-<date>` (backup). If it says both layouts exist, copy nothing: explain which one has data (dates of
     `agentos.db`/`backoffice.db`) and ask which to keep.
   - No old layout but `~/.claude/settings.json` has no `BACKOFFICE_HOME` in `env`: re-run `./install.sh`
     (Windows `.\install.ps1`); it keeps what exists and only fills in what is missing.
6. **Leftovers of the old system-level install** (ask before deleting each): a symlink `~/.local/bin/agentos` or
   `/usr/local/bin/agentos` (delete only if `ls -l` shows it points to this folder's `bin/agentos`); an `export PATH=...`
   line AgentOS added to `~/.zshrc`/`~/.bashrc` (tell the person which one). Windows: `%USERPROFILE%\.agentos\bin` in the
   user PATH (explain how to remove it: Settings → Environment variables).
7. **Start and verify.** `./bin/backoffice start`, then the Health check. Ask the person to quit Claude Desktop completely and
   reopen it, open http://localhost:4781 and confirm their projects, tasks, leads and files are there, and that **Equipos**
   shows the teams.
8. **Backups.** Only after the person confirms everything works, suggest deleting `*.migrado-<date>` and `*.backoffice-backup`.
   Never delete them yourself.

## Moving Back Office to Documents («mueve Back Office a Documentos», «mi Back Office está en otra carpeta»)

For an install outside `~/Documents` (the Oct 15 version used `~/AgentOS-app`). Below, OLD = this folder's current path,
NEW = `<the company's project folder>/.backoffice` (ask which folder; if it is a git repo add `.backoffice/` to its
`.gitignore`; never `Documents/AgentOS`, which is the old AgentOS the person imports from; Documents may be in OneDrive). Explain the plan in two lines and get the person's OK first.
Moving keeps everything: the folder carries `data/` and `workspaces/` with it.

1. **Stop it.** From OLD: `./bin/backoffice stop`; an Oct 15 install may also have the global command: `backoffice stop`
   (if `command -v backoffice` finds it). Check nothing answers: `curl -s -m 2 http://localhost:4780/health` prints nothing.
2. **Move it** (never copy + delete). First `ls -ld "NEW"`: if it exists, STOP and ask (it may be a
   second copy; compare `git log -1 --format=%cd` and the date of `data/backoffice.db` in each; never merge or overwrite).
   Then `mv "OLD" "NEW"` (Windows `Move-Item -LiteralPath "OLD" "NEW"`). This session's folder no
   longer exists: from now on start every command with `cd "NEW" &&`.
3. **Re-install from NEW:** `./install.sh` (Windows `powershell -ExecutionPolicy Bypass -File .\install.ps1`). It keeps
   `data/` (login, database) and re-points Claude to NEW: the `backoffice` marketplace (removed and added again if it pointed
   to OLD) and `backoffice@backoffice`, Claude Desktop's `mcpServers.backoffice`, `BACKOFFICE_HOME`/`BACKOFFICE_ROOT` in
   `~/.claude/settings.json` and the project paths saved in the database (backups `*.backoffice-backup`). It ignores the old
   paths this session still carries (expected line: «Ignoro BACKOFFICE_HOME=… (es de otra ubicación de Back Office)»).
4. **Old layout?** If `~/.agentos` or `~/AgentOS` exist, run Update step 5 now: `node scripts/migrate-to-project-folder.mjs`
   (plan), then with the person's OK `node scripts/migrate-to-project-folder.mjs --yes`.
5. **Old launcher leftovers:** Update step 6 (symlink `~/.local/bin/agentos` → OLD, `PATH` line in `~/.zshrc`/`~/.bashrc`);
   ask before removing each. A symlink to OLD is broken now (`ls -l` shows the old target): it is safe to remove with OK.
6. **Leftover at OLD.** A Claude session opened before step 3 may have recreated `OLD/data` (an empty server log or
   database). `ls -A "OLD"`: if it holds only `data`/`workspaces`, tell the person it is an empty leftover and remove it
   only with their OK; anything else there, ask.
7. **Restart and check.** `./bin/backoffice stop` (it also stops a server started from the old path), `./bin/backoffice start`,
   then the Health check (check 6 must show NEW). Ask the person to quit Claude Desktop completely, reopen it, open NEW as
   the project in the Code tab (File → Open folder / choose NEW) and start a new session; old sessions
   still point to OLD. Then confirm in http://localhost:4781 that their projects, tasks, leads and files are there.

## Troubleshooting

| Symptom                                                                                               | Fix                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude plugin list` has no `backoffice@backoffice`, or still lists `agentos@agentos`/`agentos-core@agentos`/`*-team@agentos` | `node scripts/migrate-plugins.mjs`; then restart Claude. If the marketplace is missing: `claude plugin marketplace add "$PWD"` and run it again                                                                                                                                                                                                                                                |
| Cowork or Chat has no Back Office tools, or Boards does not show what an agent «made»                     | «Connect Back Office to Chat and Cowork». If an agent wrote straight into `data/` or the DB, say so: that work must be redone through the tools; never patch rows by hand |
| Agent says it has no Back Office tools (`mcp__plugin_backoffice_backoffice__*`)                                 | Health check 4 and 2; the server starts by itself on the first session, else `./bin/backoffice start`. Open a NEW session (tools load at start). Claude Desktop: check 6, then quit and reopen it. Agents listed in old project `.claude/agents/<id>.md` copies (Equipos → editor) may carry the old `mcp__plugin_agentos_agentos`/`mcp__plugin_agentos-core_agentos` in `tools` (the update renames them; by hand: replace with `mcp__plugin_backoffice_backoffice`) |
| «El puerto 4780/4781 está ocupado»                                                                    | `./bin/backoffice stop`; see who holds it: `lsof -nP -iTCP:4780 -sTCP:LISTEN` (Windows `Get-NetTCPConnection -LocalPort 4780`). Never kill a process you did not identify. Often it is ANOTHER company's Back Office: give this folder another pair in `data/.env` (`BACKOFFICE_PORT`, `BACKOFFICE_WEB_PORT`, ask first) and run `./bin/backoffice update` (rebuilds the web and the company plugin)                                                                                                                                             |
| Web shows 400 errors, a blank page or old screens after an update                                     | Rebuild and restart: `./bin/backoffice stop`, `(cd web && NEXT_PUBLIC_BACKOFFICE_PORT=<this folder's port> node node_modules/next/dist/bin/next build)`, `./bin/backoffice start`; reload the browser (Cmd/Ctrl+Shift+R)                                                                                                                                                                                                |
| Forgot the web password                                                                               | The person edits `data/.env` (`BACKOFFICE_USER=`, `BACKOFFICE_PASSWORD=`) in an editor: `open -e data/.env` (Windows `notepad data\.env`), or `./install.sh --reset-login` (Windows `-ResetLogin`). Never read, print or paste that file                                                                                                                                                             |
| Server does not start                                                                                 | `tail -50 data/logs/server.log` (Windows `data\logs\server.err.log`). Common: Node < 22.13 (`node -v`; install Node 24 LTS and re-run the installer), port busy (above), a path moved (re-run `./install.sh`)                                                                                                                                                                                  |
| Boards or Inicio is blank                                                                              | Normal for a new project. Ask the CEO: «arranca mi empresa» (or any agent: «arma el inicio»). Boards fills as agents publish deliverables for review                                                                                                                                                                                                                       |
| Built-in WhatsApp (`./bin/backoffice whatsapp`) shows no QR                                              | Use the supported option instead: ask the sales team «conecta mi WhatsApp con OpenWA» (skill `openwa-setup`, a step-by-step helper)                                                                                                                                                                                                                                                            |
| OpenWA stops answering / hangs while status says `ready`                                              | Ask the sales team «reinicia OpenWA», or: `BACKOFFICE_HOME="$PWD/data" node plugins/backoffice/skills/openwa-setup/scripts/openwa.mjs stop` then `... start`. Never expose OpenWA (port 2785) to the internet                                                                                                                                                                                        |
| Windows                                                                                               | Run in PowerShell from this folder; launcher `.\bin\backoffice.cmd start`; installer `powershell -ExecutionPolicy Bypass -File .\install.ps1`. OpenWA needs `patch` from Git for Windows: `$env:Path += ";C:\Program Files\Git\usr\bin"` in that terminal. Firewall asks about `node`: Allow (private networks); Back Office listens only on 127.0.0.1                                                |
| `~/.agentos` or `~/AgentOS` exists                                                                    | Old layout: Update step 5                                                                                                                                                                                                                                                                                                                                                                      |

If the same command fails twice the same way, stop: show the exact error and ask. Logs: `data/logs/`.

## Feature map (where it lives, who owns it)

- **Boards** (tab «Boards», formerly «Canvas»; per agent / team / company): agents publish drafts for the person to review with
  `backoffice_artifact_*`; procedure and templates in skill `backoffice:canvas-artifacts`, ideas per team in
  `plugins/backoffice/teams/<team>/canvas-ideas.md`. Only the person approves.
- **Inicio** (the company status page): built by the CEO in the kickoff, or any agent (`backoffice_artifact_publish`
  `home: true`); Assistant (`coo`) keeps it current.
- **Finanzas · revenue ledger** (sales, payments, IVA, CFDI data): `controller` agent, skill `revenue-ledger`
  (`plugins/backoffice/skills/revenue-ledger/`); tax content is indicative, always validated with the accountant.
- **WhatsApp with OpenWA** (optional, self-hosted under `data/openwa/`): sales team (`sales-lead`), skill `openwa-setup`;
  agents may send only after the person's OK for each message.
- **Payment reminders and notices** (upcoming, overdue N0-N3, payment received, plan installments): Cobranza
  (`collections-agent`), skill `payment-reminder`; drafts always, WhatsApp sends through OpenWA only with the person's OK per
  message, 9:00-19:00 Mon-Sat, 3-day cooldown per client, log in `collections/reminders-log.csv` (Archivos).
- **Vista oficina** (3D office): optional; toggled with the «Vista oficina» button in the header, remembered per browser.
- **Teams**: Equipos tab (the app); roster of agents per team in `plugins/backoffice/teams/*/team.json`.

## Report a bug or idea

Use the MCP tool `backoffice_issue_report` (kind `bug` or `feature`, your agent id, steps, expected vs actual; no secrets).
It saves the report and returns a prefilled GitHub issue URL for `SandPalace/backoffice`: give the person the link so THEY
review and submit it. Use it only for Back Office faults, not for problems of the person's computer.

## Never

- Delete `data/`, `workspaces/`, `backups/`, `*.migrado-*` or `*.backoffice-backup` unless the person asks.
- Write to `data/` or the database directly (sqlite, file writes): only through the Back Office tools.
- Show `data/mcp-key` (the HTTP MCP key).
- Show the contents of `data/.env` (it has the office password) or any key.
- Run `git clean`, `git reset --hard`, `git checkout -- <file>`, a forced pull or similar in this folder; copy + delete
  this folder instead of `mv`.
- Kill processes you did not identify as Back Office (check the port owner first).
- Edit Claude's config beyond what this runbook says (allow rule, `env`, Claude Desktop `mcpServers.backoffice`).
