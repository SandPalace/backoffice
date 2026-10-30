---
name: update-backoffice
description: Updates a Back Office install to the latest version without touching the person's data. First diagnoses (where the folder and the data are, their size, local vs latest version, local edits, old layout, Claude config), picks ONE plan from a fixed decision table, backs up data/ and workspaces/, runs the plan, checks health and reports before/after versions. Use it when the person says «actualiza Back Office», «hay versión nueva de Back Office», «pon al día mi Back Office», «update backoffice», «¿cómo actualizo Back Office?», or an agent says the plugin or server is outdated.
allowed-tools: Bash, Read
---

# Update Back Office

Talk to the person in Mexican Spanish, one plain line per step («Primero reviso dónde está tu Back Office…»). Their work lives in
`data/` and `workspaces/` (git-ignored); the update replaces only the code that comes from the repo. Every command below runs
from the Back Office folder (`A`). Windows: PowerShell, `.\bin\backoffice.cmd` instead of `./bin/backoffice`, `.\install.ps1` instead
of `./install.sh`.

## 0. Can you run it here?

You need the person's own computer shell (Bash tool) with `git` and `node`. If you have no Bash tool (e.g. you are the
Assistant agent), or the shell is a sandbox (Cowork/Chat: `$HOME` under `/sessions/`, no `git`, the Back Office folder is not
there), stop and say: «Para actualizar necesito la terminal de tu computadora. Abre Claude Desktop → pestaña **Code** →
elige la carpeta **Documentos/AgentOS** y escribe «actualiza Back Office».» Do not try to update from a sandbox.

## 1. Find the folder

The folder has `.claude-plugin/marketplace.json` and `plugins/backoffice/`. Walk up from the current directory; else try
`dirname` of `BACKOFFICE_HOME` in `~/.claude/settings.json` (`grep -o '"BACKOFFICE_HOME": *"[^"]*"' ~/.claude/settings.json`),
`~/Documents/AgentOS`, `~/AgentOS-app`. Several candidates → show them (path + `git log -1 --format=%cd` + date of
`data/backoffice.db`) and ask which one is theirs. From here on start each command with `cd "<A>" &&`.

## 2. Diagnose (read-only)

`node scripts/update-check.mjs` — prints folder, git state, versions (local → latest), data size, edited files, old layout,
Claude config, whether the office is running and from which folder, disk, Node, and **Plan recomendado**. For a detail,
`node scripts/update-check.mjs --json --no-fetch` (`facts.*`; no second fetch). Nothing is changed by it.
- Missing script (versions before 1.3.0): if `A/.git` exists, `git fetch origin main && git show
  origin/main:scripts/update-check.mjs > "${TMPDIR:-/tmp}/backoffice-update-check.mjs" && node "${TMPDIR:-/tmp}/backoffice-update-check.mjs" --dir "$PWD"`
  (same for `backup-backoffice.mjs` in step 4: `... --dir "$PWD"`). No `.git` → the plan is `not-a-clone-reinstall`.
- `fetch-failed` because the remote moved: `git remote set-url origin https://github.com/SandPalace/backoffice.git`, rerun.

## 3. Explain, then pick ONE plan

Tell the person in 4–6 lines: where Back Office is, where their data is and how big (data/, workspaces/, the database), version
now vs new, edited files if any, anything odd (old layout, old plugins, Claude pointing to another folder, office running
from another folder). Then name the plan the script chose and what it will do, and ask for OK before changing anything.
Use the script's plan; do not invent another. The first matching row wins:

| Plan                             | When (script reasons)                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `blocked`                        | Node < 22.13 or no `node:sqlite`, no git, low disk, offline, not a Back Office folder, a copy inside another git repo |
| `not-a-clone-reinstall`          | the folder has no `.git` (hand-copied or unzipped)                                     |
| `diverged-ask`                   | own commits AND new commits (`diverged`), another branch (`not-on-main`), another remote (`foreign-remote`) |
| `stash-then-update`              | files from the repo were edited (`tracked-changes`) or untracked files would be overwritten |
| `move-then-update`               | outside `Documents/AgentOS` (e.g. `~/AgentOS-app`)                                     |
| `migrate-old-layout-then-update` | `~/.agentos` or `~/AgentOS` (layout before 2026-10-16) still exists                    |
| `fast-forward`                   | clean and behind `origin/main`                                                         |
| `up-to-date`                     | nothing new to pull                                                                    |

`then` is the update after the preparatory plan (`fast-forward` or `up-to-date`). `repair: true` (old plugins, Claude pointing
elsewhere, web not built, or `pre-rename`: something still named AgentOS) adds `./bin/backoffice update` even when up to date.
`pre-rename` (AgentOS → Back Office, 2026-10-29): before the pull this folder only has `./bin/agentos` (after it, that name
still works and calls `./bin/backoffice`). The update migrates the install in place: backup first, `data/agentos.db` →
`data/backoffice.db` with the office stopped, Claude settings/Desktop/plugin, agent copies; tell the person the manual steps it
prints (restart Claude sessions; in Claude Desktop/Cowork swap the «agentos» plugin for «backoffice»; reinstall
`dist/backoffice.mcpb` if they used the extension). After finishing a preparatory plan, run step 2
again and continue with the new plan (at most 3 rounds; then stop and explain).

## 4. Back up first (every plan except `up-to-date` without repair, and `blocked`)

`./bin/backoffice backup` → `Respaldo listo: <A>/backups/backoffice-<fecha>/` (data/ + workspaces/; the database through SQLite's
online backup, so it is safe while Back Office runs; `backups/` is git-ignored; it keeps the 3 newest). Tell the person the
path. An older launcher without `backup` (it prints `Uso: …`): `git show origin/main:scripts/backup-backoffice.mjs >
"${TMPDIR:-/tmp}/backoffice-backup.mjs" && node "${TMPDIR:-/tmp}/backoffice-backup.mjs" --dir "$PWD"` (old layout: add
`--data ~/.agentos --workspaces ~/AgentOS`). If it fails (disk, permissions), stop: no update without a backup.

## 5. Stop the office (ask first)

If `office-running`: «¿Puedo detener la oficina unos minutos mientras actualizo?» → `./bin/backoffice stop`. `server-running-
elsewhere`/`web-running-elsewhere` = another Back Office folder holds the ports: say which one and, with OK, stop it from there
(`"<that folder>/bin/backoffice" stop`). Never kill a process by hand.

## 6. Run the plan

- **`fast-forward`**: `old-remote` note → `git remote set-url origin https://github.com/SandPalace/backoffice.git`. Then
  `git pull --ff-only origin main` → `./bin/backoffice update` (npm ci, web build, plugin migration, desktop extension) →
  `./bin/backoffice start`. If the pull refuses, stop, show its message and the files it names, rerun step 2.
- **`up-to-date`**: say so. With `repair`: after OK, `./bin/backoffice update` then `./bin/backoffice start`.
- **`stash-then-update`**: show `git status --short` and `git diff --stat`, say in plain words what each file is. Ask:
  (A) keep their version aside: `git stash push --include-untracked -m "mis cambios antes de actualizar <YYYY-MM-DD>"`,
  then `fast-forward` (or `up-to-date`); afterwards offer `git stash pop` only if they want those edits back; if it reports
  a conflict, stop: the stash entry stays (`git stash list`), show `git status`, ask. (B) keep them and skip the update.
- **`move-then-update`** (optional; an update works anywhere): get OK, then follow «Moving Back Office to Documents» in
  `A/CLAUDE.md` (stop, check `~/Documents/AgentOS` does not exist — `documents-taken` = stop and ask —, `mv` never copy +
  delete, `./install.sh` from the new path). Declined → run `then` in place.
- **`migrate-old-layout-then-update`**: run `then` first (pull + update brings the latest migration script), then
  `node scripts/migrate-to-project-folder.mjs` (plan only), show it, with OK `./bin/backoffice stop` and
  `node scripts/migrate-to-project-folder.mjs --yes` (copies, never deletes; old folders renamed `*.migrado-<date>`).
- **`diverged-ask`**: stop and show: branch, `git log --oneline -10 origin/main..HEAD` (their commits), how many new ones.
  Options: (A) merge, only if they are comfortable: `git pull --no-rebase --no-edit origin main`; on conflict
  `git merge --abort` (restores the exact previous state) and offer B. (B) fresh clone beside it (`not-a-clone-reinstall`
  steps; this folder stays untouched). (C) leave it. `not-on-main` with a clean tree: offer `git switch main`, rerun step 2.
- **`not-a-clone-reinstall`** (the 2026-10-23 owner case): OLD = this folder. With OK:
  1. Backup (`./bin/backoffice backup` if it exists; else after the clone, `node "<NEW>/scripts/backup-backoffice.mjs" --dir "<OLD>"`).
  2. Stop the office from OLD. If OLD is `~/Documents/AgentOS`, rename it: `mv "<OLD>" "$HOME/Documents/AgentOS-copia-<YYYYMMDD>"`.
  3. `git clone https://github.com/SandPalace/backoffice.git "$HOME/Documents/AgentOS"` (= NEW).
  4. Copy the person's files into NEW (copy, OLD stays as is): `cp -Rp "<OLD>/data" "<NEW>/data"`, same for `workspaces`,
     `.claude`, `CLAUDE.local.md` and `plugins/backoffice/skills/tesseract-motion` when they exist (Windows `Copy-Item -Recurse`).
  5. Show what OLD had changed by hand: `diff -rq "<OLD>" "<NEW>" -x data -x workspaces -x node_modules -x .next -x .git -x dist -x backups | head -40`; ask about each.
  6. `cd "<NEW>" && ./install.sh` (re-points Claude to NEW; keeps data/), then step 2 must say `up-to-date`.
  7. Leave OLD until the person confirms everything is there; never delete it yourself.
- **`blocked`**: explain the reason and the fix, change nothing: `node-too-old` → install Node 24 LTS (nodejs.org) and rerun;
  `no-git` → macOS `xcode-select --install`, Windows git-scm.com; `low-disk` → free the space it says; `fetch-failed` →
  internet or the remote (step 2); `not-backoffice-folder` → step 1; `inside-other-repo` → a development copy: not updated with
  this skill.

## 7. Health check

`./bin/backoffice status` (server and web running), `curl -s http://localhost:<port>/api/auth/status` (JSON; the port is `BACKOFFICE_PORT` in `data/.env`, 4780 by default — `./bin/backoffice status` prints it),
`claude plugin list` (the company plugin `backoffice-<slug>@backoffice-<slug>` enabled if `BACKOFFICE_COMPANY` is set in `data/.env`, else `backoffice@backoffice`; none of the 7 old ones), `node scripts/build-roster.mjs`,
`node scripts/update-check.mjs --no-fetch` (`up-to-date`, no repair). Any failure → the Troubleshooting table in `A/CLAUDE.md`.
Ask the person to quit and reopen Claude Desktop, open the office (http://localhost:4781, or this folder's `BACKOFFICE_WEB_PORT`) and confirm their projects, tasks and files.

## 8. Report (Spanish)

```
Listo: Back Office <versión antes> → <versión ahora>.
Plan: <plan> · Respaldo: <ruta> · Tus datos: data/ <tamaño>, workspaces/ <n> carpetas (sin cambios).
Hice: <pasos, uno por línea> · Revisión: <OK/qué falló>
Pendiente para ti: reiniciar Claude Desktop, revisar la oficina<, borrar respaldos viejos cuando confirmes>.
```

## Never

- `git reset --hard`, `git clean`, `git checkout -- <file>`, `git pull --force`, `git push --force`, `git fetch` + reset,
  `git branch -f`, or delete-and-reclone. Delete `data/`, `workspaces/`, `backups/`, `*.migrado-*`, `*.backoffice-backup` or an old copy.
- Update without a backup, or stop the office, move, stash or merge without the person's OK.
- Resolve a refused pull or a conflict by discarding anything: stop, show, ask.
- Read or print `data/.env`, `data/mcp-key` or any key; write to `data/` or the database by hand.
- Kill a process you did not identify; touch Claude's config beyond what `./install.sh` / `./bin/backoffice update` do.

## Why

A plain `git pull` fails in ways a student cannot read (edited files, a copied folder, a moved repo, the old layout) and the
wrong reflex (reset, reclone) destroys work. Diagnosing first, backing up, and picking from a fixed table makes every
update boring and reversible: the data never moves unless the person says so.
