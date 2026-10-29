# Pipeline stages (shared by every sales skill)

Prospects live as **one lead per prospect** in the Back Office «Leads» Kanban (tools `backoffice_lead_create`,
`backoffice_lead_update`, `backoffice_lead_list`). The column is the stage. Detail (ficha, drafts, sequences) lives in
Archivos under `ventas/prospectos/<slug>/` and is referenced in the lead's `files`. Tasks (`backoffice_task_*`) are only
for real work items such as «Preparar propuesta para X».

| Stage (`stage`) | Column | Meaning | Typical trigger |
|---|---|---|---|
| `new` | Nuevo | Message received, not yet worked | `prepared-replies` first contact |
| `contacted` | En conversación | We are qualifying or following up; a reply draft or sequence exists | draft prepared, person replied |
| `qualified` | Calificado | Scored warm/hot with the key data confirmed | `qualify-lead` result >= tibio |
| `proposal` | Propuesta | A proposal/quote draft exists or was sent by the person | `proposal-writer` delivered |
| `won` | Ganado | Sale closed | **only the person**, from the web. Agents never set it |
| `lost` | Perdido | Closed without sale | agent proposes, reason REQUIRED in `notes` |

## Rules

- Lead fields: `name` (required), `company`, `contact` (as given, else omit), `source` (whatsapp|instagram|facebook|meta_form|email|web|referral|other),
  `interest`, `stage`, `score` (0-100 from `ventas/criterios-de-calificacion.md`), `next_contact_at` (YYYY-MM-DD), `value` (ONLY if the person stated it),
  `notes` (markdown ficha), `files` (`ventas/prospectos/<slug>/`).
- One lead per prospect. Before creating, `backoffice_lead_list` (use `query` with name/contact); if found, `backoffice_lead_update` it, never duplicate.
- `notes` format (rewrite whole on update, short):
  ```
  Interés: ... · Score: <n>/100 (caliente|tibio|frío) · Por qué: ...
  Falta: <missing data or [NO DATA: ...]>
  Próximo contacto: <YYYY-MM-DD> — <what to do>
  Esperando a la persona: <question, or "nada">
  ```
- **Lost:** `stage: lost` and first line of `notes` = `PERDIDO: <reason, date>`. If unsure, keep the stage and ask the person.
- **Won:** never set. Tell the person «márcalo Ganado en la pestaña Leads».
- `<slug>`: lowercase ASCII with hyphens from the name (`maria-lopez`); if unknown `<source>-<YYYYMMDD>-<n>`.
- Dates are computed with `date`, never from memory.
