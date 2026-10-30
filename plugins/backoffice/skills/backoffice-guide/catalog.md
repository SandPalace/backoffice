# How to read the roster

The list of agents is NOT written here: it is generated from the teams of the `backoffice` plugin (`teams/<id>/team.json`) into
`roster.json` and served live by the server. Never answer "which agents exist" from memory.

- `backoffice_overview.roster`: all teams (the field is still called `plugins`), with each agent's short description (<=160 chars), `model`,
  `in_active_team`, `working_now`, `open_tasks`; plus `totals` and `not_in_active_team` (installed but not in the
  active team).
- `backoffice_roster {plugin?, agent?}`: full description and skills of one team (`plugin` = team id) or one agent. An unknown id returns
  an error that lists the valid ones.
- One plugin, `backoffice`, holds every agent and skill; teams are a feature of the app. Team id: `marketing-team`, `dev-team`... `backoffice-core` is the system team (you, Assistant — id `coo` — and your guide skills).
- `in_active_team: false` is not "unavailable": the agent is installed and the person adds it in the Equipos tab
  (create or edit a team, add the agent, activate). An agent missing from the roster means the `backoffice` plugin is outdated (`./bin/backoffice update`).

## Entry points (guidance the roster cannot derive)

Start a team's work with its lead; the lead delegates inside its team.

| Team | Entry point | Notes |
|---|---|---|
| marketing-team | `cmo` | Full marketing cycle for the client's business. |
| sales-team | `sales-lead` | Sets up your offer + scoring rubric (`ventas/`), prepares replies to pasted messages or to your WhatsApp inbox (drafts only, the person sends), finds businesses on Google Maps (CSV + optional Leads), scores prospects, Leads Kanban, follow-up drafts, proposals. Optional OpenWA setup (`openwa-setup`): several WhatsApp numbers; agents read chats and send only with the person's OK on each message. |
| collections-team | `collections-lead` | Portfolio, reconciliation, collection drafts. |
| executive-team | `ceo` (company kickoff with the C-board checklist `company-kickoff`: migration, knowledge base `company/`, status dashboard, plan; priorities, cross-area conflicts) / `cfo` (money) / `operations-chief` (the COO of the person's business: processes, cadence, bottlenecks; not the Assistant `coo`) | Decisions the owner signs. |
| finance-team | `controller` (SMB books, revenue ledger of sales/collections/IVA, statements, monthly close, accountant package) / `personal-finance-advisor` (household budget, debts, savings) | Indicative finance and tax guidance only: every tax item is validated with the person's accountant; strategy and the 13-week cash forecast stay with executive-team `cfo`. |
| dev-team | `tech-lead` | Websites, stores and apps; splits work among its engineers. |

New teams appear in the roster without editing this file; if one has a lead, read its description to find it.

## Recommending

1. Match the request to descriptions in the roster, not to agent names.
2. Request spanning teams: route to the lead of each team, say the order, one task per lead.
3. One recommendation (or two with the difference) per answer; do not list the whole roster.
4. If the best agent is `not_in_active_team`, say so and how to add it.
