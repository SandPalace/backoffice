# Boards ideas · collections-team

Artifacts this team can publish to the Boards with `backoffice_artifact_publish`. Titles are Spanish patterns
(`<cliente>`, `<corte>`, `<fecha>` are placeholders filled with real values). Templates come from the core skill
`backoffice:canvas-artifacts`. Scope: `team` for the Team board, `agent` for each agent's own board, `workspace`
only when the person asked for a project-level view. Client data on a card is used only for collecting.

## Team board (scope `team`)

| Artifact (Spanish title pattern)  | Template         | Built from (which skill/output/data)                                                      | What the owner validates                            | When to publish                        |
| --------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| Cartera vencida · corte <fecha>   | `dashboard.html` | `aging-report` buckets (current, 1-30, 31-60, 61-90, 90+) with the sum check              | That the total matches their portfolio              | Each new cutoff                        |
| Plan de cobranza · <fecha>        | `report.html`    | `collections-plan.md` (summary, priority order, drafts, pending decisions)                | The priority order and the pending decisions        | When the lead delivers the plan        |
| Mensajes de cobranza por enviar   | `checklist.html` | `collection-drafts.md` (one per client, channel, level, suggested time)                   | Each draft before the person sends it               | When drafts are ready                  |
| Decisiones pendientes de cobranza | `checklist.html` | Escalations: disputes, key clients, payment plans, discounts, no reply after final notice | Each decision                                       | Whenever a case is escalated           |
| Política de cobranza · <negocio>  | `document.md`    | `collections-policy` → `collections-policy.md`                                            | Contact rules, tone, what needs their authorization | First time, or when the policy changes |

## collections-lead

| Artifact (Spanish title pattern)         | Template        | Built from (which skill/output/data)                                              | What the owner validates           | When to publish                 |
| ---------------------------------------- | --------------- | --------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| Plan de cobranza priorizado · <fecha>    | `report.html`   | `collections-plan.md` built from aging + reconciliation                           | The plan as a whole                | When the plan is ready          |
| Orden de prioridad de clientes · <fecha> | `table.html`    | Priority table (cliente, monto, días, motivo del orden)                           | The order and the reasons          | With the plan                   |
| Caso a decidir · <cliente>               | `options.html`  | Escalated case with options (wait, payment plan, refer to a lawyer) and the facts | The option to take                 | When a case needs the person    |
| Avance de cobranza · <periodo>           | `timeline.html` | Reminders sent by the person, promises, payments confirmed by `reconciler`        | That the follow-up dates are right | Weekly while the plan is active |

## portfolio-analyst

| Artifact (Spanish title pattern)             | Template         | Built from (which skill/output/data)                                                  | What the owner validates           | When to publish                 |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| Antigüedad de saldos · corte <fecha>         | `dashboard.html` | `aging-report.md` buckets + invoice count, with the python sum check in view          | Cutoff date and totals             | Each aging report               |
| Detalle de facturas vencidas · corte <fecha> | `table.html`     | Detail CSV (folio, cliente, emisión, vencimiento, saldo, días)                        | Due dates and balances per invoice | With the aging report           |
| Riesgos de la cartera · <fecha>              | `report.html`    | Risk flags: client >30% of portfolio, 90+ invoices, several overdue, growing balances | Which risks to act on              | When a risk is flagged          |
| Datos que faltan para la antigüedad          | `checklist.html` | Missing columns or dates (`[NO DATA: ...]`), unconfirmed cutoff                       | Provides the missing data          | When the aging cannot be closed |

## reconciler

| Artifact (Spanish title pattern)             | Template         | Built from (which skill/output/data)                                                  | What the owner validates                               | When to publish               |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| Conciliación de pagos · <cuenta> · <periodo> | `report.html`    | `payment-reconciliation` → `reconciliation.md` with the totals check                  | The proposed applications                              | Each reconciliation           |
| Depósitos y su aplicación · <periodo>        | `table.html`     | Each deposit: applied, partial, excess, no invoice, to confirm (differences in cents) | Each application before they record it in their system | With the reconciliation       |
| Pagos por confirmar · <periodo>              | `checklist.html` | Ambiguous deposits and "ya pagué" without a transaction, each with its question       | Answers each question                                  | When there are doubtful cases |
| Facturas que ya no se cobran · <fecha>       | `table.html`     | Invoices covered by confirmed deposits, passed to the lead                            | That they are removed from collection                  | Before any drafts go out      |

## collections-agent

| Artifact (Spanish title pattern)        | Template        | Built from (which skill/output/data)                                                    | What the owner validates                   | When to publish              |
| --------------------------------------- | --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- |
| Borradores de cobranza · <fecha>        | `document.md`   | `payment-reminder` → `collection-drafts.md` (one per client, all open invoices grouped) | Tone, amounts, folios and due dates        | When drafts are ready        |
| Calendario de envíos sugerido · <fecha> | `timeline.html` | Suggested send time per draft (9:00-19:00, Mon-Sat) and level                           | Send times                                 | With the drafts              |
| Tono por cliente · <fecha>              | `table.html`    | Level per client by days overdue (amable, recordatorio firme, aviso final)              | That the level fits each relationship      | With the drafts              |
| Propuesta de plan de pagos · <cliente>  | `options.html`  | `payment-plan` → `payment-plan-<client>.md`, marked pending authorization               | Whether to grant the plan and which option | When a client asks for terms |

## Rules

- Publish only real data: folios, amounts and dates from the portfolio file, the bank statement or the person; gaps are
  `[NO DATA: ...]`. A payment counts only if it is on the bank statement.
- One card per deliverable. A change is a new version of the same artifact (`artifact_id`), never a new card.
- Request review with one concrete question in the note (e.g. «¿Autorizas 3 parcialidades para <cliente>?»).
- Approving a draft on the Boards does not send it; the person sends it. No threats, interest or legal action unless a
  confirmed contract or pagaré backs it.
- Read `backoffice:canvas-artifacts` for the procedure, templates and scopes before publishing.
