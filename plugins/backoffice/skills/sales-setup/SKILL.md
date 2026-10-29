---
name: sales-setup
description: Short interview (8 questions max, one at a time, in Spanish) that saves the business's offer, ideal customer, scoring rubric and voice rules under ventas/ in Archivos. Use it first, whenever ventas/ is missing or incomplete, or when the person says their offer, prices or rules changed.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Sales setup

Every other sales skill reads these four files. The person is the only source of facts about their own business.

## Procedure

1. `backoffice_file_list` with prefix `ventas/`. Read any existing file of the four with `backoffice_file_read`; ask only what is missing or what changed.
   Also try `backoffice_profile_read` and `backoffice_file_list` for business facts the person already gave (e.g. `marketing/*/facts.md`): confirm them in one line instead of re-asking.
2. Create a task «Configurar ventas» (`backoffice_task_create`, `agent` = `sales-lead`) and `backoffice_checkin` working.
3. Interview in Mexican Spanish, **one question at a time**, at most 8, each with an example answer. Wait for the answer. Suggested order (merge or skip when already known):
   1. What do you sell (products/services)? 2. Prices and conditions (anticipo, envío, garantía), exactly as you state them. 3. Payment methods.
   4. Zone/coverage and schedule. 5. Who buys from you and why (ideal customer). 6. What signals a serious buyer (budget, urgency) and what are red flags.
   7. How do you talk to customers (tone, words you use or avoid) and what must never be promised. 8. When should the agent stop and hand the prospect to you (escalate)?
4. After the last answer, write the four files with `backoffice_file_write` (formats below). Each file starts with `Actualizado: <date>` and an `[NO DATA: …]` marker for every unanswered item.
5. **Existing files:** never overwrite blindly. Merge the new answers, then show a diff summary in Spanish (`+ agregado`, `~ cambiado: antes → ahora`, `= sin cambios`) and ask for the OK before writing.
6. Propose the rubric weights and thresholds as a draft built from answers 5–6 and let the person adjust them in one message.
7. `backoffice_task_deliver` the four files (`files`: paths), `backoffice_task_update` to `review`, checkin idle. Tell them: «Archivos → ventas/». Next step: paste a real message (skill `prepared-replies`).

## File formats

- `ventas/oferta.md`: table `| item | what it is | price/condition | status |` (status `confirmed` = said by the person; prices only as stated, never rounded), then sections Métodos de pago, Zona/cobertura, Horario.
- `ventas/cliente-ideal.md`: Quién compra · Por qué compra · Señales de presupuesto · Señales de urgencia · Banderas rojas.
- `ventas/criterios-de-calificacion.md`:
  - Rubric 0–100, 4–6 criteria with weights summing to 100 (typical: need fit, budget signal, urgency, decision power, zone/coverage fit), each with «what earns full / half / zero points».
  - Thresholds: `caliente` ≥ 70, `tibio` 40–69, `frío` < 40 (adjust to the person's answer).
  - 5–8 discovery questions (short, natural, in the business voice), each tagged with the criterion it uncovers.
- `ventas/tono-y-reglas.md`: Voz (3–5 traits + 2 sample phrases the person approves) · Palabras a evitar · Nunca prometer · Cuándo escalar a la persona · Firma.

## Never

- Invent prices, conditions, coverage or schedule: unanswered = `[NO DATA: …]`.
- Ask more than 8 questions or more than one at a time.
- Send anything: the files are for the agents and the person.

## Why

Prepared replies are only as good as the offer and rules they read. Without them the agent either invents or asks the same things in every conversation.
