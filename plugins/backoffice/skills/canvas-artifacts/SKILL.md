---
name: canvas-artifacts
description: Builds a Canvas artifact from a ready-made template (report, options, dashboard, checklist, timeline, gallery, table, document) filled only with real data, self-checks it and publishes it to the right board (agent, team or project) with a review question. Use it before publishing anything to the canvas with backoffice_artifact_publish, when the person requested changes on an artifact you published, and to build or update the project home shown in the Inicio tab (normally the project's lead agent) («arma el inicio», «actualiza el inicio»).
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Canvas artifacts

Never start an artifact from a blank page. Every artifact starts from one of the templates in the `templates/`
folder next to this file (the skill's base directory is shown when it loads). They are single-file, offline,
light/dark, mobile and print friendly, with Spanish labels and `{{TOKEN}}` placeholders. The Canvas shows html in a
sandbox with no network: anything external (fonts, CDN, images by URL, fetch) simply does not load.

## Templates

| Id | Use it for | How to fill |
|---|---|---|
| `report.html` | One-pager: summary, 3-6 key points, findings, sources | Tokens; repeat the marked blocks |
| `options.html` | A decision: 2-4 options side by side (pros, cons, cost, risk) + recommendation | Tokens; class `recommended` on ONE option |
| `dashboard.html` | KPI cards + bar/line charts + table | Header tokens + the JSON block `id="data"` only |
| `checklist.html` | Approval checklist: Listo / Pendiente / Bloqueado, owner, notes | Tokens; one `<tr>` per item; update the counters |
| `timeline.html` | Plan / roadmap: phases or weeks, dates, milestones, dependencies | Tokens; phase class `done` / `now` / `next` |
| `gallery.html` | Creative review: images, videos or copy variants A/B/C with channel | Tokens; media as `data:` URIs or copy text |
| `table.html` | Sortable, filterable data table with totals | Header tokens + the JSON block `id="data"` only |
| `document.md` | Letter, email, proposal, policy draft with header and «Pendiente de validar» | Tokens; delete sections that do not apply |

Each template starts with an HTML comment with its exact rules. Read it before filling.

## Procedure

1. **Check the ideas first.** Your team's ideas live in the `backoffice` plugin at `teams/<team-id>/canvas-ideas.md`
   (`${CLAUDE_PLUGIN_ROOT}/teams/<team-id>/canvas-ideas.md`; team ids: `marketing-team`, `sales-team`,
   `collections-team`, `executive-team`, `finance-team`, `dev-team`). If you do not know where the plugin is:
   `find ~/.claude/plugins -path '*teams/<team-id>/canvas-ideas.md' 2>/dev/null | head -1`. It says which
   artifacts your team publishes and with which template. For project-level artifacts use **Project board ideas**
   below; if your team has no file, use **Team board ideas (generic)**.
2. **Pick ONE template** for ONE deliverable. Two deliverables = two artifacts. If nothing fits, `report.html`
   (html) or `document.md` (text the person will send) is the default.
3. **Copy, then fill only with real data.**
   `mkdir -p "$TMPDIR/backoffice-work/<task-id>" && cp "<skill dir>/templates/<id>" "$TMPDIR/backoffice-work/<task-id>/<short-name>.<ext>"`
   Fill it from the task, its files (`backoffice_file_read`) and tool results. Every number, price, date, name or
   phone must come from one of those. Anything missing is written `[NO DATA: what is missing]`, never estimated.
   Delete optional blocks you did not use instead of leaving them empty. Content in the person's language
   (Mexican Spanish by default).
4. **Self-check** before publishing (all must pass; fix and re-run):
   - `grep -n '{{' <file>` prints nothing (no placeholder left).
   - `grep -nE 'https?:|<link|@import|fetch\(' <file>` prints nothing (works offline, nothing external).
   - Every figure has its source in the page (Fuentes / footer / KPI note); `grep -c 'NO DATA' <file>` is known
     and those gaps are named in your review question.
   - Text is in Spanish, accents included; the title follows the board etiquette below.
   - For `dashboard`/`table`: the JSON block still parses (the page shows a red error box when it does not).
5. **Publish** with `backoffice_artifact_publish`: `agent` = your id, `title`, `scope_type` (see etiquette; leave
   `scope_id` empty to use the default), inline `name` + `content` (the file text), `task_id` when there is a task,
   `request_review: true`, and `description` = **one line with the question for the owner** about what to validate
   (e.g. «¿Confirmas los montos de cobranza contra tu banco? Faltan 2 datos marcados [NO DATA].»). Then deliver the
   task as usual (`backoffice_task_deliver`): approving the artifact does not finish the task. Give the person the `link`
   from the result (`http://localhost:4781/canvas?ws=<project>&artifact=<id>`): it opens that project and card.
6. **On feedback** (`backoffice_artifact_list` with `needs_action: true` and your `agent`, at the start of your work):
   read it with `backoffice_artifact_get`, edit the SAME working file, re-run step 4 and publish a **new version of the
   same artifact** (`artifact_id`, no new card), with `note` = what changed in one line
   («Cambié la opción B por renta mensual y agregué la fuente del costo»). Answer questions with
   `backoffice_artifact_comment`. If the work folder is gone, recreate it from the latest version's content.

## Board etiquette

- **One card per deliverable.** A new version, never a second card for the same thing.
- **Title in Spanish:** `<Qué> · <para quién / periodo>`, e.g. «Reporte de cobranza · octubre 2026»,
  «Opciones de CRM · Inmobiliaria Norte», «Posts de lanzamiento · Instagram».
- **Agent board** (`scope_type: agent`, the default): your work in progress and personal outputs.
- **Team board** (`team`): consolidated outputs and the team's status; usually published by the lead.
- **Project board** (`workspace`): what the owner or the client must see for the whole project. Only finished,
  reviewed material; few cards, each one current.

## Project board ideas (scope `workspace`)

| Artifact | Template | Content |
|---|---|---|
| Estado del proyecto semanal | `report.html` | Avance, lo que se terminó, lo que sigue, lo que espera al dueño |
| Decisiones pendientes del dueño | `options.html` | Una tarjeta por decisión abierta, con recomendación |
| Roadmap del proyecto | `timeline.html` | Fases con fechas acordadas, hitos y dependencias |
| Riesgos y bloqueos | `checklist.html` | Cada riesgo con estado, responsable y qué lo destraba |
| Resumen ejecutivo para el cliente | `report.html` | Lo que el cliente debe saber, sin detalle interno |
| Entregables aprobados | `table.html` | Entregable, fecha, quién aprobó (solo aprobaciones reales del Canvas) |
| Presupuesto vs real | `dashboard.html` | KPIs y barras por rubro con montos de los archivos del proyecto |
| KPIs del proyecto | `dashboard.html` | Las métricas acordadas, con su fuente y fecha de corte |
| Minuta de reunión | `document.md` | Asistentes, acuerdos, responsables y fechas dichas en la reunión |
| Checklist de lanzamiento | `checklist.html` | Todo lo que debe estar listo antes de salir, con evidencia |

## Project home (Inicio tab)

The Inicio tab shows the project's home: ONE living page per project. Building it is the job of the agent in charge of the
project (the lead of its team, e.g. `cmo`, `sales-lead`, `controller`); Assistant or any other agent may build or update it
when asked. It is never reviewed or approved; the person comments on it and you publish a new version.

1. **When:** the project has no home yet (Inicio is blank; `backoffice_artifact_list` has no `is_home: 1`), the person asks
   («arma el inicio», «actualiza el inicio»), or something important changed (team, approval, blocker, owner decision).
   Read the person's comments on the home first (`backoffice_artifact_get` with your own `agent` id).
2. **Gather real data** for that project only (`workspace` = its id): `backoffice_overview` (teams, agents, who is working),
   `backoffice_task_list` (in progress, in review, blocked), `backoffice_artifact_list` (approved deliverables, `in_review`),
   `backoffice_file_list` (a brief or objective file, if any) and `backoffice_profile_read` (the person's goals).
3. **Template:** `report.html` by default; `dashboard.html` when the project has numbers worth charting. Sections, in this
   order: **Objetivo** (only if stated in a file or by the person), **Equipos y agentes**, **Tareas en curso / por revisar**,
   **Entregables aprobados** (only real Canvas approvals or approved tasks), **Próximos pasos** (each with who does it),
   **Decisiones pendientes del dueño**. A gap is `[NO DATA: ...]`; never invent a goal, figure or date. Title in Spanish,
   e.g. «Inicio · <project name>». No Bash? Read the template with Read, fill it in memory and publish it inline.
4. **Self-check** (step 4 above), then publish: `backoffice_artifact_publish` with your own `agent` id, `home: true`, `workspace`,
   inline `name: "inicio.html"` + `content`, `note` = what changed in one line. No `artifact_id` or `scope_type` needed:
   `home: true` adds a new version if the home exists, else creates it. Tell the person it is in the Inicio tab.

## Team board ideas (generic, for teams without `canvas-ideas.md`)

| Artifact | Template |
|---|---|
| Estado del equipo de la semana | `report.html` |
| Propuesta o borrador para enviar | `document.md` |
| Comparativo antes de decidir | `options.html` |
| Plan del mes | `timeline.html` |
| Números del área | `dashboard.html` or `table.html` |
| Piezas para revisar (posts, anuncios, correos) | `gallery.html` |
| Lista de pendientes para aprobar | `checklist.html` |

## Never

- Never publish a template with `{{` left, sample data, or invented prices, phones, dates, reviews or approvals.
- Never add external URLs, fonts, scripts, CDNs or `fetch`: the sandbox blocks them and the page breaks.
- Never open a new card for a fix: new version with `artifact_id` and a `note`.
- Never set an artifact to approved or changes requested, nor say it is approved: only the person decides.
- Never put secrets, passwords or tokens in an artifact.

## Why

The owner reviews many cards: the same look, a clear title and a single question make each one a 30-second
decision. Templates remove layout work and the self-check keeps the facts rule (`[NO DATA]`) visible on the page.
