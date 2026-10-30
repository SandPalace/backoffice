# Boards ideas · finance-team

Artifacts this team can publish to the Boards with `backoffice_artifact_publish`. Titles are Spanish patterns
(`<mes>`, `<periodo>`, `<proyecto>` are placeholders filled with real values). Templates come from the core skill
`backoffice:canvas-artifacts`. Scope: `team` for the Team board, `agent` for each agent's own board, `workspace`
only when the person asked for a project-level view. Personal finance never goes on the team or workspace board.

## Team board (scope `team`)

| Artifact (Spanish title pattern)        | Template         | Built from (which skill/output/data)                                                                              | What the owner validates                      | When to publish                                    |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Cierre mensual · <mes>                  | `checklist.html` | Controller's close steps (bank reconciliation, income/expenses vs CFDI, accruals, statements, accountant package) | What is closed and what is still open         | During and at the end of the monthly close         |
| Ventas, cobros y por cobrar · <periodo> | `dashboard.html` | `revenue-ledger` `summary` (Vendido, Cobrado, Por cobrar) + `collection-days`                                     | That the totals match their records           | Monthly, or when asked "¿cuánto vendí / me deben?" |
| Estados financieros · <mes>             | `report.html`    | `financial-statements` with the balance and cash checks                                                           | The three statements and the open differences | After the close                                    |
| Obligaciones fiscales próximas          | `timeline.html`  | `sat-tax-calendar` (next 3 months, "confírmalo con tu contador")                                                  | The dates to take to the accountant           | Monthly, before the 17th                           |
| Paquete para el contador · <mes>        | `checklist.html` | `accountant-handoff` (CFDI lists, statements index, expenses without CFDI, questions)                             | That the package is complete before sending   | At month end                                       |

## controller

| Artifact (Spanish title pattern)          | Template         | Built from (which skill/output/data)                                                                      | What the owner validates                                      | When to publish                          |
| ----------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| Cierre mensual · <mes>                    | `report.html`    | `financial-statements` (estado de resultados, balance general, flujo de efectivo) with checks to the cent | Statements and any shown difference                           | At the close                             |
| Resumen del libro de ingresos · <periodo> | `dashboard.html` | `revenue-ledger` `summary` + `collection-days` + verification block                                       | Sold, collected, receivable                                   | Monthly or on request                    |
| IVA por tratamiento · <periodo>           | `table.html`     | `revenue-ledger` `iva` report (by sale date, open question F1 visible)                                    | The figures before the accountant uses them                   | When the accountant asks or at month end |
| Cartera para cobranza · corte <fecha>     | `table.html`     | `revenue-ledger` `portfolio` export (input of collections `aging-report`)                                 | That the open balances are right before collections uses them | When collections needs the portfolio     |
| Paquete para el contador · <mes>          | `checklist.html` | `accountant-handoff` checklist + index CSV + email DRAFT                                                  | Contents and the draft email                                  | Before the 17th                          |
| Pendientes del cierre                     | `checklist.html` | `[NO DATA: ...]` items and who provides each                                                              | Provides or requests the missing data                         | When the close is blocked                |

## financial-analyst

| Artifact (Spanish title pattern)           | Template         | Built from (which skill/output/data)                                                             | What the owner validates                  | When to publish                                |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| Evaluación de proyecto · <proyecto>        | `report.html`    | `project-evaluation` (VPN, TIR, payback, ROI, discount-rate rationale, recomendación)            | The recommendation and its criteria       | When the analysis is ready                     |
| Escenarios · <proyecto>                    | `options.html`   | Base / optimista / pesimista scenarios + sensitivity of the 2 riskiest variables                 | Which scenario they believe               | With the evaluation                            |
| Razones financieras · <periodo>            | `dashboard.html` | `financial-ratios` (liquidez, apalancamiento, rentabilidad, eficiencia) with traffic lights      | Thresholds and the reading                | After the statements, or before a bank meeting |
| Punto de equilibrio y precios · <producto> | `table.html`     | `break-even-pricing` (margin, break-even in units and MXN, price for target margin, sin/con IVA) | The price they will use                   | When asked "¿cuánto debo cobrar?"              |
| Supuestos del análisis · <tema>            | `table.html`     | Assumptions table marked `data` or `estimate`, with source                                       | Which estimates to replace with real data | With any analysis                              |

## tax-compliance

| Artifact (Spanish title pattern)      | Template         | Built from (which skill/output/data)                                                                      | What the owner validates                                | When to publish                           |
| ------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Calendario fiscal · <mes> a <mes>     | `timeline.html`  | `sat-tax-calendar` (dates from the script, regime confirmed or `[NO DATA: régimen fiscal]`)               | The regime and the dates to confirm with the accountant | When asked "¿qué tengo que pagar?"        |
| Cruce de CFDI vs banco · <periodo>    | `table.html`     | CFDI issued/received vs bank deposits/payments, PPD without complemento, cancelled CFDI                   | Each finding before the accountant sees it              | After uploading CFDI lists and statements |
| Posibles riesgos fiscales · <periodo> | `report.html`    | Findings: what was seen, why it may be a risk, the document that resolves it, question for the accountant | Which questions go to the accountant                    | With the CFDI check                       |
| Documentos por juntar esta semana     | `checklist.html` | Missing CFDI, statements and Constancia de Situación Fiscal                                               | Gathers each document                                   | When documents are missing                |

## personal-finance-advisor (scope `agent` only; private to the person)

| Artifact (Spanish title pattern) | Template         | Built from (which skill/output/data)                                               | What the owner validates                | When to publish                        |
| -------------------------------- | ---------------- | ---------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| Presupuesto familiar · <mes>     | `dashboard.html` | `home-budget` (net income, fixed/variable expenses, 50/30/20 as reference)         | That the income and expenses are theirs | When the budget is built               |
| Plan para salir de deudas        | `options.html`   | `debt-payoff-plan` avalanche vs snowball simulation (interest, payoff date, order) | Which method to follow                  | After the budget, when there are debts |
| Calendario de pagos de deudas    | `timeline.html`  | Month-by-month payoff order from the simulation                                    | The monthly payment they can sustain    | With the chosen plan                   |
| Fondo de emergencia y metas      | `table.html`     | Emergency fund target (3-6 months) and monthly saving per goal with date           | Goals and dates                         | When goals are set                     |
| Primer paso de esta semana       | `checklist.html` | The plan's first action and the follow-up date                                     | That the step is doable                 | With each plan                         |

## Rules

- Publish only real data: figures from statements, the ledger, CFDI lists or the person, each computed by a saved python
  script; gaps are `[NO DATA: ...]`. Statements that do not close show the difference, never a plug figure.
- One card per deliverable. A change is a new version of the same artifact (`artifact_id`), never a new card.
- Request review with one concrete question in the note (e.g. «¿Confirmas que la diferencia de $1,240.00 es la comisión bancaria?»).
- Anything touching taxes or NIF carries "indicativo; valídalo con tu contador". Personal and business money never share a card.
- Read `backoffice:canvas-artifacts` for the procedure, templates and scopes before publishing.
