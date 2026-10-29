# Canvas ideas · executive-team

Artifacts this team can publish to the Canvas with `backoffice_artifact_publish`. Titles are Spanish patterns
(`<periodo>`, `<tema>`, `<fecha>` are placeholders filled with real values). Templates come from the core skill
`backoffice:canvas-artifacts`. Scope: `team` for the Team board, `agent` for each agent's own board. Executive
overviews that span every team (dashboard, quarter plan) may go to `workspace` when the person wants them there.

## Team board (scope `team`)

| Artifact (Spanish title pattern) | Template         | Built from (which skill/output/data)                                                   | What the owner validates              | When to publish                              |
| -------------------------------- | ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| Tablero ejecutivo · <fecha>      | `dashboard.html` | `executive-dashboard` (one page of KPIs, source and date per figure)                   | That each figure is right and current | Before a review or when asked "¿cómo vamos?" |
| Cierre de semana · <semana>      | `report.html`    | `weekly-review` (achievements, commitments met and overdue, blockers, next priorities) | Next week's priorities                | Every Friday or Monday                       |
| Plan del trimestre · <trimestre> | `timeline.html`  | `quarterly-plan` (3-5 objectives with measures, target, owner and date)                | Objectives, targets and owners        | At the start or close of a quarter           |
| Decisiones por firmar            | `checklist.html` | Open `decision-memo` files and escalations from ceo, cfo and operations-chief          | Each decision they must sign          | Whenever a memo is waiting                   |
| Prioridades activas (máx. 3)     | `table.html`     | CEO priorities with what is "later" or "no"                                            | The three active priorities           | When priorities change                       |

## ceo

| Artifact (Spanish title pattern)  | Template         | Built from (which skill/output/data)                                                          | What the owner validates                  | When to publish                                         |
| --------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Memo de decisión · <tema>         | `options.html`   | `decision-memo` (options, risks, recommendation, what the person signs)                       | The option they choose and sign           | When a decision involves money, people or clients       |
| Memo completo · <tema>            | `document.md`    | Same memo as text, with every figure's source and "what would change my mind"                 | The reasoning and the sources             | With the options card, when the memo is long            |
| Plan trimestral · <trimestre>     | `timeline.html`  | `quarterly-plan`                                                                              | Objectives, owners and dates              | Quarter start or close                                  |
| Prioridades entre áreas · <fecha> | `table.html`     | Team deliverables (`marketing/`, `sales/`, `collections/`, `executive/`) + `backoffice_overview` | The priority order and what is sacrificed | When areas compete for resources                        |
| Tablero ejecutivo · <fecha>       | `dashboard.html` | `executive-dashboard` with finance figures from the cfo                                       | The overview                              | Before a decision that needs numbers from several areas |

## cfo

| Artifact (Spanish title pattern)               | Template         | Built from (which skill/output/data)                                                | What the owner validates                            | When to publish                                      |
| ---------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Flujo de efectivo a 13 semanas · desde <fecha> | `dashboard.html` | `cash-flow-forecast` (opening balance, collections, payments, week of minimum cash) | The assumptions and the minimum cash week           | When asked "¿nos alcanza?" or before a large expense |
| Supuestos de la proyección · <fecha>           | `table.html`     | Assumptions list of the forecast, each marked data or estimate with source          | Which estimates to correct                          | With the forecast                                    |
| Evaluación de gasto · <concepto>               | `options.html`   | Spending review: total cost, return, payback, cheapest alternative                  | Approve, approve with follow-up, or the alternative | When a spending request arrives                      |
| Real vs presupuesto · <periodo>                | `table.html`     | Actual against budget with variances over 10% (or their threshold) flagged          | The explanation of each variance                    | Weekly or monthly                                    |
| Notas fiscales para el contador · <tema>       | `checklist.html` | Data vs general tax rule, with "indicativo; valídalo con tu contador"               | What to take to the accountant                      | When a tax topic comes up                            |

## operations-chief

| Artifact (Spanish title pattern)      | Template         | Built from (which skill/output/data)                                         | What the owner validates                           | When to publish                      |
| ------------------------------------- | ---------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| Cuello de botella principal · <fecha> | `report.html`    | Diagnosis of where work waits longest, who it waits for, what it blocks      | The diagnosis and the proposed fix                 | When a bottleneck is found           |
| Proceso · <nombre>                    | `document.md`    | SOP: numbered steps with owner, input, output and "done when" (one page)     | The steps and owners                               | When a process is written or changed |
| KPIs de entrega · <periodo>           | `dashboard.html` | On-time, cycle time, backlog, rework from team tasks (`executive-dashboard`) | That the KPIs reflect reality                      | With the weekly cadence              |
| Capacidad vs compromisos · <periodo>  | `table.html`     | Committed work against available people and time; what to defer              | What gets deferred (priority call goes to the ceo) | When work does not fit               |
| Seguimiento a proveedores · <fecha>   | `checklist.html` | Commitments due, who owes them, follow-up message drafts                     | Each draft before sending                          | When commitments are due             |

## Rules

- Publish only real data: every figure comes from a file, another team's deliverable or the person; gaps are
  `[NO DATA: ...]`. Calculations come from a saved script, never from memory.
- One card per deliverable. A change is a new version of the same artifact (`artifact_id`), never a new card.
- Request review with one concrete question in the note (e.g. «¿Firmas la opción B del memo de contratación?»).
- Approving a card is not signing a contract or moving money; the person executes. Tax topics carry the accountant notice.
- Read `backoffice:canvas-artifacts` for the procedure, templates and scopes before publishing.
