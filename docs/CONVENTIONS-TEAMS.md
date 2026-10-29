# Conventions for writing agent teams (Back Office)

Back Office ships ONE Claude plugin, `plugins/backoffice/`. A **team** is a folder in `teams/` that groups agents and skills
living in the plugin's shared `agents/` and `skills/` folders. Teams are a feature of the app (Equipos tab), not plugins.

```
plugins/backoffice/
  agents/<id>.md                  one file per agent (kebab-case English id = roster id, unique across ALL teams)
  skills/<skill>/SKILL.md         one directory per skill (unique across all teams); shared knowledge as skills/<name>.md
  teams/<team-id>/team.json       { "id": "<team-id>", "name": "<Spanish UI name>", "description": "...",
                                    "agents": ["<id>", ...], "skills": ["<skill>", ...], "optional_skills": [...]? }
  teams/<team-id>/canvas-ideas.md Canvas artifact ideas per agent (template, source, what the owner validates)
  teams/<team-id>/SOURCE.md       where it came from (an earlier internal project, written from scratch...) and what was adapted
  teams/<team-id>/docs/           team docs (optional)
```

Every agent and skill belongs to exactly one team, and every id listed in a `team.json` exists: `node scripts/build-roster.mjs`
refuses to build the roster otherwise. `optional_skills` may be missing on disk (owner-local, not redistributable).
New team: add `teams/<team-id>/team.json`, the agents/skills, a group with the same id and name in `web/lib/roster.ts`,
then run the roster build and tests. Team ids are stored in workspace data: never rename one.

## Language policy
Everything you write for the model — frontmatter, instructions, file names, field names, statuses — is **English**.
Agents talk to the person in **Mexican Spanish by default** (or the language the person writes in), and deliverable
content (copy, messages, reports, proposals) is written in the person's language. Sample deliverables inside a
skill may stay Spanish. Mexican domain terms (IVA, CFDI, SAT, RFC, SPEI, CLABE) stay as they are.

Standard line for every agent: *Reply to the person in Mexican Spanish by default (or the language they write in).
Instructions, file names and field names stay in English; deliverable content is written in the person's language.*

## Agents (`agents/<id>.md`)
Frontmatter: `name` (= file id), `description` (when to use it, one or two sentences), `model` (`opus` for the one
who directs, `sonnet` for the one who executes), `tools`. **`tools` is a closed allowlist and must include `Skill`
and `mcp__plugin_backoffice_backoffice`**, plus the minimum else it needs.
Body, second person ("You are..."), with these sections:
1. Who you are and what you deliver (2–4 lines).
2. **Rules that override your judgment** (3–5 hard rules, each with its why).
3. **How you work** (numbered steps; name the skills you use by id).
4. **How you work with Back Office** (standard block below).
5. **What you never do**.
6. **You are done when…** (verifiable criterion).
Target length: 60–110 lines. Concrete, no filler.

### Standard "How you work with Back Office" block
- When starting multi-step work: `backoffice_task_create` (one-sentence title, `agent` = your id).
- Report status with `backoffice_checkin` (working / waiting / idle); when you need the person, `waiting`.
- Results are **files** in the working folder (`~/AgentOS/<team>/<YYYY-MM-DD>-<task>/`): register them with
  `backoffice_task_deliver` and move the task to `review` with `backoffice_task_update`.
- **Never mark `done`**: the person approves in the tasks tab.
- If you did not receive team context, ask for it with `backoffice_team_context` (your id).
- Anything that leaves the building (email, message, post, payment, charge) is a **draft** the person reviews and
  sends; you never send it.
- Canvas: before publishing an artifact, use the skill `backoffice:canvas-artifacts` and pick an idea from this
  team's `teams/<team-id>/canvas-ideas.md` (at the root of the `backoffice` plugin).

### Canvas (artifacts the person reviews)
- **When:** anything the person must look at and validate before it is used: drafts of posts, quotes, reports,
  designs, landing pages, tables. Not for intermediate notes or code projects.
- **How:** use the skill `backoffice:canvas-artifacts` before publishing and pick an idea from the team's
  `teams/<team-id>/canvas-ideas.md`; then `backoffice_artifact_publish` (`agent` = your id, `title`, a workspace file `path` or inline
  `{name, content}`, optional `task_id`; html, markdown, image, pdf, csv or text). Board (`scope_type`): `agent` (default,
  yours), `team` or `workspace` (the whole project).
- **Fixes:** publish again with `artifact_id` (a new version; nothing is overwritten). At start, and whenever a checkin
  returns `canvas_feedback`, run `backoffice_artifact_list` with `needs_action: true` and your `agent`, read the thread with
  `backoffice_artifact_get` and answer with `backoffice_artifact_comment` if needed.
- **Only the person approves or requests changes.** An approved artifact does not finish its task: deliver the task as
  usual (`backoffice_task_deliver` → `review`).

## Skills (`skills/<skill>/SKILL.md`)
Frontmatter: `name` (= directory), `description` (what it does and WHEN to use it — enough for Claude to pick it),
`allowed-tools` (minimum). Body: numbered procedure, exact output format (with a short example), **Never** and
**Why** sections. 40–90 lines. No Obsidian: skills work with Markdown/CSV/HTML files in the working folder.

## Cross-cutting rules (all skills and agents)
- **No fact without a source.** Figures, amounts, dates and names come from a file or from the person; if missing, ask
  or write `[NO DATA: ...]`. Never invent.
- Deliverables for Mexican clients: tú form, MXN currency ($1,250.00), dates like `15 oct 2026`.
- The person decides and signs; the agent prepares.
