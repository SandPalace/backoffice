---
name: team-status
description: Produces the status report of Back Office's active teams as brief Markdown - what needs the person first, what each agent is working on, risks and the next action. Use it when asked "where are we?", "what's next?", "what's stuck?", or at the start or end of the day.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Status report

## Procedure

1. Call `backoffice_projects`, then `backoffice_overview` for each project the report covers (`workspace` = its id; keep projects separate in the report). No response: say so and do not write the report.
2. For any task detail you need (titles, dates), use `backoffice_task_list`. Every figure in the report
   comes from one of these two tools; what is not there is "no data".
3. **Needs your attention** = `needs_you` (review, blocked; a task with `cancel_proposal` asks the person to cancel it) plus the
   agents with status `waiting` and `agile.sprints_in_review` (a sprint report waiting for «Completar sprint»). Order:
   pending review, blocked, waiting. Each item: task, agent, what is needed from the person. If `agile.active_sprint` exists,
   add one line: sprint name, goal, end date and progress (`progress.tasks.done`/`total`, percent).
4. **What each agent is doing**: only teams with `active: true`. Per member: name, status and their open task
   (or "no open tasks"). If `loose_sessions` brings sessions without a team, add them in one line.
   Optionally add `roster.working_now` agents that are not in the active team (they are working outside it).
5. **Risks**: only with a concrete signal (blocked task, `waiting` agent, a task in `doing` with no movement
   according to `backoffice_task_list`, an active team with no tasks). With no signal, write "No risks detected".
   Add a one-line "Installed but not in your team" with a few agent ids from `roster.not_in_active_team` ONLY if one clearly
   fits the open work or the person asked; never dump the list (`backoffice_roster` has the descriptions to check first).
6. **Next action**: just one, with who does it. Start with what is waiting on the person.
7. If the person asks to save it, write it with `backoffice_file_write` as `coo/<YYYY-MM-DD>-status/report.md` and tell them it is in the Archivos tab. You may add a line with recent files (`backoffice_file_list`) if they are relevant.

## Exact format

The report is deliverable content: write the headings and text in the person's language (Spanish by default,
as in the example). The structure is:

```
# Back Office status, <day month YYYY>
**Active team:** <name> · **Tasks:** <n> to do · <n> in progress · <n> blocked · <n> in review · <n> done

## Needs you first
- <task> (<agent>, <status>): <what is needed from you>
(or "Nothing is waiting on your decision.")

## What each agent is doing
- <agent>: <status>. <open task or "no open tasks">

## Risks
- <risk with its signal> (or "No risks detected.")

## Next action
<one action, who does it>
```

Example (fictional data, in Spanish):

```
# Estado de Back Office, 13 oct 2026
**Equipo activo:** Cobranza · **Tareas:** 1 por hacer · 1 en curso · 1 bloqueada · 2 en revisión · 4 hechas

## Te necesitan primero
- Antigüedad de saldos de septiembre (portfolio-analyst, en revisión): revisa el archivo y apruébalo.
- Recordatorios a clientes +60 días (collections-agent, bloqueada): falta la política de cobranza.

## Qué hace cada agente
- collections-lead: working. Priorizar cartera vencida.
- portfolio-analyst: waiting. Antigüedad de saldos de septiembre.
- collections-agent: waiting. Recordatorios a clientes +60 días.
- conciliador: idle. Sin tareas abiertas.

## Riesgos
- Cobros detenidos: la tarea de recordatorios está bloqueada y depende de tu respuesta.

## Siguiente acción
Tú: aprueba la antigüedad de saldos y dime los días de gracia de tu política de cobranza.
```

## Never
- Invent figures, statuses or dates, or round "by eye".
- List inactive teams as if they were working.
- Mark `done` or say something is approved.
- Go past 25 lines: offer the rest as detail.

## Why
The person wants to know in 30 seconds what is theirs to do; ordering by urgency and sourcing every figure keeps a blocker from getting lost among good news.
