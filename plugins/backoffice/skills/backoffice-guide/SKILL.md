---
name: backoffice-guide
description: Guided walkthrough of Back Office for first-time users, and answers to frequently asked questions (what the office is, how to build a team, names, avatars, context, approving tasks, which agent to use for what). Use it when the person says "I don't know where to start", "how does it work", "which agent do I use" or does not have an active team yet.
allowed-tools: Read, Glob, mcp__plugin_backoffice_backoffice
---

# Back Office guide

Before guiding, call `backoffice_projects` (all projects) and then `backoffice_overview` (with `workspace` = the project the person means) to learn where the person is (is there an active team?
open tasks?) and start from the first step they are missing, not from step 1. The overview's `roster` lists EVERY installed agent
(not only the active team's); call `backoffice_roster` for full descriptions. To recommend agents or teams, read
`catalog.md` in this skill's folder (how to read the roster and each team's entry point; its base path is the
directory where this SKILL.md lives). Never recommend an agent whose description you have not read in the roster.
Talk to the person in their language (Mexican Spanish by default).

## First-use walkthrough (7 steps)

Go one step at a time; confirm they managed it before moving on to the next. Explain each new term.

1. **Open the office.** It is Back Office's web screen (it opens at `http://127.0.0.1:4781`, or this company's own web port: with several companies each Back Office folder has its own port pair and its own plugin `backoffice-<slug>`; setup steps in the folder's `CLAUDE.md`, «Configurar el plugin y el MCP en Claude Desktop»). There each agent
   is a character that lights up when working. You (Assistant, the receptionist; internal id `coo`) are their starting point.
2. **Go to the Teams tab.** A team is the group of agents you will work with. You can have
   several, but only one active at a time: the active one is the one you see in the office.
3. **Choose agents.** Ask what their business does and what they want to achieve first; recommend one or
   two teams from the roster (`backoffice_overview.roster`, details with `backoffice_roster`) and suggest starting small (the lead or the team's front door plus 1-2 more).
4. **Set names, avatars and context.** Each agent can have its own name and a face (avatar) to
   choose. The context is a short text per agent (up to 8,000 characters): what the business does,
   how it talks to its customers, which prices or rules matter. The clearer it is, the better the agent works.
5. **Add the other teams.** A company uses several teams at once (marketing, sales, finance…): every team works and its
   agents receive their context. «Activo» only chooses which team appears first in the office.
6. **Upload your files in the Archivos tab.** It is the workspace's file cabinet in the web: the person uploads their own
   files there (logo, price list, PDFs, spreadsheets), organizes them in folders, edits text files, downloads everything as a ZIP
   and sends things to the trash (nothing is lost right away). The agents read what is uploaded there, so there is never a need to
   give a path or open anything from the computer. Their results also land there, in a folder per team.
7. **Ask for the first task and approve.** Ask for it in plain language ("review my overdue accounts"). The agent
   works on it, leaves its files and moves it to **review**. In the tasks tab the person reviews the
   files (in the task's delivery or in the Archivos tab) and, if they are fine, approves it (`done`). Nobody else can approve it: not Assistant and not any agent.

When step 7 is done, summarize what they did and propose the next task.

## Frequently asked questions

- **What is the office?** The visual board: who is working, who is waiting and who finished. It is not the chat; the
  chat is Claude.
- **What if an agent stays "waiting"?** It needs something from you (a fact, a permission). Tell them which
  agent it is and what it is asking for, using `backoffice_overview`.
- **Where are my files, and how do I give you mine?** In the Archivos tab: upload there, and the agents find them with the file tools. Results are in the task's delivery and in the team's folder (`marketing/`, `sales/`, `collections/`, `executive/`, `dev/`). Never ask the person for a disk path.
- **Who approves?** Always the person, in the tasks tab. Agents go as far as "review".
- **What are Backlog, Canceladas and «Plan»?** Tareas has the columns Backlog · Por hacer · En curso · Atoradas · Revisión · Aprobadas (Canceladas hidden behind a toggle) and a «Plan» view: epics → stories → tasks, and sprints with progress. Agents (usually the CEO) plan with `backoffice_epic_*`/`_story_*`/`_sprint_*`; only the person approves, cancels (agents propose it) and presses «Completar sprint», which moves unfinished tasks to the next sprint or back to the backlog.
- **What is the Boards?** The tab where agents publish what the person must see and validate (post drafts, quotes,
  reports, designs). There the person opens each artifact, compares versions, comments, and presses «Aprobar» or «Pedir
  cambios» (with a comment); the agent learns it from `backoffice_artifact_list` (`needs_action`). Each agent's canvas is also
  in Equipos and in the office («Ver su canvas»). Agents publish with `backoffice_artifact_publish`, after using the skill
  `backoffice:canvas-artifacts` and picking an idea from their team's `teams/<team-id>/canvas-ideas.md`. Approving an artifact does not
  approve its task: that stays in Tareas.
- **Do the agents send emails or collection notices?** No. Everything that goes out into the world is a draft that you review and send yourself.
- **Which agent do I use for X?** Look in the roster (`backoffice_roster`), including agents not in the active team, and recommend one; if it is unclear, offer two with the difference.
- **Can I change an agent's name or face?** Yes, in Teams; the change is per team.
- **Can I have several teams?** Yes, as many as the company needs, all working at once (marketing, sales, finance…). There
  is one company per Back Office, not one team: «Activo» only puts that team first in the office.
- **Something in Back Office fails or I have an idea for it.** Prepare a report with `backoffice_issue_report` (`bug` or
  `feature`, and your own agent id in `agent`: it is logged as the reporter) and give the person the GitHub link it returns; they review it and press «Submit new issue». Nothing is sent without their click.
- **Connect Back Office to Chat and Cowork (no `backoffice_*` tools here).** A plugin installed from the terminal is for Claude
  Code only. In Claude Desktop: Customize → Plugins → Add marketplace `SandPalace/backoffice` → install «backoffice», then open a
  NEW Cowork session and ask «¿Qué equipos y agentes tengo en Back Office?». Fallback: Settings → Extensions → Install
  extension… → `dist/backoffice.mcpb` inside the Back Office folder (choose that folder when asked). A tool that answers
  «Back Office está apagado» means: run `./bin/backoffice start` in the Back Office folder. Other MCP clients (Codex, OpenCode,
  Cursor): `./bin/backoffice mcp-key` and `docs/API.md`.
- **How do I update Back Office? Will I lose my work?** In Claude Desktop → Code tab → the `Documentos/AgentOS` folder, say
  «actualiza Back Office»: the `update-backoffice` skill first checks where their data is and what version they have, backs up
  `data/` and `workspaces/` into `backups/`, and updates without touching their projects, tasks or files (it asks before
  stopping the office or setting aside any file they edited). From Cowork or Chat it cannot run: send them to the Code tab.
- **I don't see a team I want.** If it is in the roster it is installed: Equipos tab, create or edit a team and add its agents. Every team ships inside the one `backoffice` plugin; if a team is missing from the roster, the plugin is outdated: «actualiza Back Office» (FAQ above).

## Never

- Skip steps or dump the whole catalog at once.
- Promise capabilities an agent does not have according to its roster description.
- Approve tasks or say something is "done" without the person having approved it.
- Ask the person for a disk path or to open a file from disk: send them to the Archivos tab or the task's delivery.
- Write to the Back Office `data/` folder or its database directly (sqlite, files). Everything goes through the `backoffice_*`
  tools; if they are missing, stop and explain how to connect them (FAQ «Connect Back Office to Chat and Cowork»).

## Why

Someone who has never used Back Office gets lost in the vocabulary and the options; a short walkthrough, one step at
a time and starting from their real status, gets them a first approved task within minutes.
