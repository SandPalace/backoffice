# Boards ideas · sales-team

Artifacts this team can publish to the Boards with `backoffice_artifact_publish`. Titles are Spanish patterns
(`<prospecto>`, `<negocio>`, `<fecha>` are placeholders filled with real values). Templates come from the core skill
`backoffice:canvas-artifacts`. Scope: `team` for the Team board, `agent` for each agent's own board, `workspace`
only when the person asked for a project-level view. Leads still live in the Leads Kanban; the Boards is for what
the person must read and validate.

## Team board (scope `team`)

| Artifact (Spanish title pattern)    | Template         | Built from (which skill/output/data)                                                      | What the owner validates                      | When to publish                                    |
| ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Pipeline de ventas · <fecha>        | `dashboard.html` | `pipeline-report` over `backoffice_lead_list` (stage, score, next contact)                   | Whom to handle first and the cold-lead alerts | Start of day or when asked "¿cómo van las ventas?" |
| Prospectos priorizados · <fecha>    | `table.html`     | `pipeline-report` table (prospecto, etapa, puntaje, próximo paso, fecha)                  | The priority order                            | With the pipeline report                           |
| Borradores por enviar hoy           | `checklist.html` | Drafts from `prepared-replies`, `follow-up-sequence`, `whatsapp-inbox` with their channel | Each draft before the person sends it         | When there are drafts due today                    |
| Configuración comercial · <negocio> | `document.md`    | `sales-setup` files in `ventas/` (oferta, cliente ideal, criterios, tono y reglas)        | Offer, prices and voice rules the team uses   | After setup or when the offer changes              |
| Decisiones pendientes del equipo    | `checklist.html` | Escalations: discounts, exceptions, complaints, data the team lacks                       | Each yes/no or missing data point             | When an escalation is open                         |

## sales-lead

| Artifact (Spanish title pattern)    | Template       | Built from (which skill/output/data)                                                                 | What the owner validates             | When to publish                          |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| Reporte de pipeline · <fecha>       | `report.html`  | `pipeline-report` (prioritized table + cold-lead alerts)                                             | The summary and whom to attend first | When the person asks how sales are going |
| Mensajes atendidos · <fecha>        | `table.html`   | Several pasted messages run through `prepared-replies` (prospecto, puntaje, etapa, próximo contacto) | Scores and next steps per prospect   | After handling a batch of messages       |
| Opciones de respuesta · <prospecto> | `options.html` | `prepared-replies` (1-2 reply drafts, labelled BORRADOR)                                             | Which reply to send                  | When a prospect message arrives          |
| Escalación · <prospecto> · <tema>   | `options.html` | Case that needs the person (discount, exception, complaint), with the facts from `ventas/oferta.md`  | The decision on the exception        | When a case hits an escalation rule      |

## lead-qualifier

| Artifact (Spanish title pattern)           | Template         | Built from (which skill/output/data)                                                   | What the owner validates                               | When to publish                       |
| ------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| Ficha de calificación · <prospecto>        | `report.html`    | `qualify-lead` → `ventas/prospectos/<slug>/ficha.md` (criterio · dato (cita) · puntos) | The score, the `[NO DATA]` items and the next question | When a lead is qualified or re-scored |
| Prospección · <giro> en <ciudad> · <fecha> | `table.html`     | `google-maps-prospecting` CSV in `ventas/prospeccion/` (public business data)          | Which businesses to load as leads                      | Before asking to load them into Leads |
| Bandeja de WhatsApp · <fecha>              | `checklist.html` | `whatsapp-inbox` (one draft per chat via `backoffice_whatsapp_draft`)                     | Each draft before sending from the web                 | After attending the inbox             |
| Siguiente pregunta · <prospecto>           | `options.html`   | `qualify-lead` proposal of the one question that moves the score most                  | The question and its wording                           | With the ficha                        |

## proposal-writer

| Artifact (Spanish title pattern)         | Template         | Built from (which skill/output/data)                                                                | What the owner validates                                       | When to publish                     |
| ---------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| Propuesta comercial · <prospecto> · vN   | `document.md`    | `commercial-proposal` draft in `ventas/prospectos/<slug>/` with prices only from `ventas/oferta.md` | Scope, amounts, pending items; then the person signs and sends | When the draft is complete          |
| Desglose de precios · <prospecto>        | `table.html`     | Lines matched to the confirmed price list, totals with the math shown, IVA only if the list says so | Each line cites its price and the sum adds up                  | With the proposal                   |
| Alcances posibles · <prospecto>          | `options.html`   | Confirmed needs of the lead mapped to list lines (packages that fit)                                | Which scope to propose                                         | When more than one package fits     |
| Pendientes de la propuesta · <prospecto> | `checklist.html` | Items marked "no price: pending from the person", unconfirmed terms or validity                     | Gives the missing prices or terms                              | When the proposal has pending items |

## follow-up

| Artifact (Spanish title pattern)       | Template        | Built from (which skill/output/data)                                          | What the owner validates                                  | When to publish                      |
| -------------------------------------- | --------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| Secuencia de seguimiento · <prospecto> | `timeline.html` | `follow-up-sequence` → `sequence.md` (dated touches, closing, stop condition) | Cadence, channel and each touch                           | When a sequence is drafted           |
| Respuesta a objeción · <prospecto>     | `options.html`  | `objection-handling` draft replies (price, timing, trust, competition)        | Which reply to send; any concession stays with the person | When an objection arrives            |
| Prospectos por contactar esta semana   | `table.html`    | Leads with a past or due `next_contact_at`                                    | Who gets contacted and who moves to `lost` (with reason)  | Weekly, or when contacts are overdue |

## Rules

- Publish only real data: prices from `ventas/oferta.md`, prospect data quoted from what they said; gaps are
  `[NO DATA: ...]`. Never sample prospects or invented prices.
- One card per deliverable. A change is a new version of the same artifact (`artifact_id`), never a new card.
- Request review with one concrete question in the note (e.g. «¿Envío la propuesta con el paquete Básico?»).
- Every message on the Boards is a BORRADOR; approving it does not send it. Leads and tasks keep their own flow.
- Read `backoffice:canvas-artifacts` for the procedure, templates and scopes before publishing.
