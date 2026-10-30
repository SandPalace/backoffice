---
name: company-kickoff
description: The C-board kickoff checklist for a new Back Office (one Back Office = one company). The CEO runs it as the main agent and orchestrates the other agents - verify the install, migrate the data of an old AgentOS Local, configure Back Office, interview the owner to start the company knowledge base, publish the company status dashboard in Boards (Inicio) and write the step-by-step plan. Use it right after installing, with «arranca mi empresa», «kickoff», «configura mi Back Office», «migra mi AgentOS», or when the company has no knowledge base (`company/` is empty).
allowed-tools: Bash, Task, Skill, mcp__plugin_backoffice_backoffice
---

# Company kickoff (C-board checklist)

One Back Office belongs to ONE company. Everything lives in this folder (`data/`, `workspaces/default`). If the person has
several companies, each one gets its own Back Office folder and its own kickoff; never mix two companies here.

You are the CEO and you run this as the main agent: you delegate with Task to `backoffice:operations-chief` (install checks and migration; it has Bash),
`backoffice:cfo`, `backoffice:cmo`, `backoffice:sales-lead`, `backoffice:collections-lead` (only teams the company uses).
Subagents report to you; you consolidate and talk to the person. Track the whole kickoff as ONE task
(`backoffice_task_create`, title «Arranque de <empresa>», `agent` = `ceo`) and keep this checklist in its description,
ticking items as they finish (`backoffice_task_update`). Check in with `backoffice_checkin` (`waiting` when you need the person).

## Checklist

### 0 · Back Office is connected
- [ ] `backoffice_overview` answers. If the Back Office tools are missing or say «Back Office está apagado», STOP and
      tell the person: «abre Claude en la carpeta de tu Back Office y di: revisa y repara mi Back Office». Never write to `data/` or the DB.

### 1 · Migration from the old AgentOS Local (skip if this is the person's first install)
- [ ] Ask: «¿Tenías AgentOS antes? ¿En qué carpeta?» (usually `~/Documents/AgentOS`). Never guess a path.
- [ ] Delegate to `backoffice:operations-chief` with Task, giving it exactly this procedure (run from THIS Back Office folder):
      1. `node scripts/import-agentos.mjs --from "<old folder>" --list` → show the person the old projects with their counts.
      2. The person picks the ONE project that is this company (the others go to their own Back Office later).
      3. Plan: `node scripts/import-agentos.mjs --from "<old folder>" --workspace <id>` → show the summary.
      4. With the person's OK, in one command: `./bin/backoffice stop && node scripts/import-agentos.mjs --from "<old folder>" --workspace <id> --yes; ./bin/backoffice start`
         (Windows: `.\bin\backoffice.cmd stop`, then the node command, then `.\bin\backoffice.cmd start`).
      5. Report the copied counts. The old folder is read-only for the script and is never deleted or moved.
- [ ] Verify with `backoffice_overview` + `backoffice_file_list` that tasks, leads and files arrived. Save the report in
      `company/migration.md`.

### 2 · Configure Back Office
- [ ] Company name: Back Office shows it at the top-left. If it still says «Back Office», ask the person to rename it there
      («Renombrar»); you cannot rename it yourself.
- [ ] Teams: from what the person sells and where the work hurts, recommend at most 3 teams (Marketing, Ventas, Cobranza,
      Finanzas, Dirección, Desarrollo web) with one line of why. The person activates them in **Equipos**; read
      `backoffice_roster` to confirm.
- [ ] The person's profile: `backoffice_profile_read`; fill gaps with `backoffice_profile_update` only with what they said.

### 3 · Q&A with the owner → company knowledge base
Interview in rounds of at most 5 questions, one topic per round, in plain Mexican Spanish. Write after EVERY round
(`backoffice_file_write`), so nothing is lost if the session ends. Rounds:
1. The business: what it sells, to whom, where, since when, team size, how it sells today.
2. Numbers the person knows: monthly sales range, average ticket, main costs, clients, overdue receivables (ranges are fine).
3. Channels and tools: social networks, WhatsApp, email, Excel/sheets, billing system, files they can upload in **Archivos**.
4. Pain and goals: the 3 tasks that eat the most time, what they want in 90 days, what must never happen.
5. Rules: tone, what agents may never say or promise, who approves what.

Knowledge base files (Spanish content, each fact with its source «dijo <persona>, <fecha>» or the file it came from):
- `company/profile.md` · who the company is (one page).
- `company/facts.md` · confirmed facts only (prices, schedules, addresses, offer). Unknown = `[SIN DATO: …]`.
- `company/goals.md` · 90-day goals and the 3 heaviest tasks.
- `company/rules.md` · tone, never-say list, approvals.
- `company/open-questions.md` · what is still missing, and who should answer it.
Then delegate the area deep-dives (Task, only active teams): `cmo` → skill `onboarding`; `sales-lead` → `sales-setup`;
`cfo` / `controller` → current cash and receivables picture. Give each one `company/*.md` as input; they write in their own
folders (`marketing/`, `ventas/`, `finance/`) and you link their files from `company/profile.md`.

### 4 · Company status dashboard (Boards → Inicio)
- [ ] Use the skill `backoffice:canvas-artifacts` (dashboard template) and publish the company home with
      `backoffice_artifact_publish` `home: true`, `agent` = `ceo`: one HTML page «Estado de <empresa>» with
      what the company is, active teams, open tasks / in review / blocked (from `backoffice_overview`), leads by stage
      (`backoffice_lead_list`), the known numbers WITH source and date, goals, top 3 priorities and open questions.
      No invented figures: missing = «sin dato».
- [ ] Tell the person: «Está en Inicio (y en Boards); coméntalo ahí». Re-publish (new version) at the end of every week.

### 5 · Step-by-step plan
- [ ] Write `executive/<YYYY-MM-DD>-plan/plan.md`: the next steps in order (2-4 weeks), each with: what, which agent,
      what the person must do or approve, and how we know it is done. At most 3 priorities at a time (CEO rule 4).
- [ ] Create one Back Office task per step of the first week (`backoffice_task_create`, `agent` = the owner agent, status `todo`).
- [ ] The plan becomes an epic (`backoffice_epic_create`) with one story per step (`backoffice_story_create`, acceptance criteria in `description`) and the first sprint (`backoffice_sprint_create` with goal and dates, `status: active`); create the first week's tasks with `story_id` so they land in that sprint.
- [ ] Deliver the kickoff task (`backoffice_task_deliver` with `company/*.md`, the plan and the migration report) and move it
      to `review`. The person approves it; never `done`.

## Output to the person (end of each step)

Three lines: what is ready (where to see it in the web), what you need from them (one action), what comes next.

## Never

- Mix two companies in one Back Office, or copy another company's data here.
- Run the migration with `--yes` without the person's OK, delete or move the old AgentOS folder, or edit `data/` / the DB by hand.
- Put a figure on the dashboard or in `company/` without its source.
- Ask for passwords, tokens or `.env` contents.

## Why

The CEO is the one agent that sees the whole company. If the knowledge base starts with the owner's own words, every
other agent works from the same facts instead of guessing; the dashboard and the plan make progress visible from day one.
