---
name: follow-up-sequence
description: Drafts a 3-5 touch follow-up sequence with dates for a prospect who did not reply, got a proposal or went cold, and records the next contact date on the prospect's lead. Use it when a lead is waiting, after a proposal, or to reactivate a cold prospect.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Follow-up sequence

Stages and lead format: `../pipeline-stages.md`.

## Procedure

1. Read `ventas/tono-y-reglas.md` and `ventas/oferta.md` (missing = `sales-setup`). Find the lead with `backoffice_lead_list` and read its `ventas/prospectos/<slug>/` files. Do not create a second lead.
2. Identify situation (no first reply, proposal sent, cold), channel and last message.
3. Cadence: 3 to 5 touches, first as soon as sensible (same day for new), then growing intervals (e.g. +1, +3, +7, +14 days). Compute real dates with `date`; respect the business schedule.
4. Each touch is a draft that adds something new (answer, clarification, a concrete next step) with one question or call to action. Last touch is a friendly close; then the sequence pauses.
5. Stop conditions: replies, says no, asks not to be contacted. No false urgency; prices and terms only from `oferta.md`.
6. Save `sequence.md` with `backoffice_file_write` in `ventas/prospectos/<slug>/` (format below).
7. `backoffice_lead_update`: `next_contact_at` = date of the next touch, `notes` (with the line «Próximo contacto: <date> — toque N»), `stage` `contacted`, `files` folder. Prospect says no = propose `lost` with the reason; the person confirms.

## Output format (Spanish)

```markdown
# Secuencia: <prospecto> · Canal: <WhatsApp|email> · Situación: <...>
BORRADOR — la persona lo envía.
| # | fecha | mensaje |
|---|---|---|
| 1 | 2026-10-16 | "..." |
| N (cierre) | ... | "..." |
Se detiene si: responde / dice que no / pide no ser contactado / tras el toque N sin respuesta.
Pendiente para la persona: ...
```

## Never

- More touches than the sequence maximum (5) or continue after a "no".
- Invent urgency, quotas or deadlines.
- Send anything.

## Why

A timely follow-up rescues prospects that go cold; endless insistence burns the relationship.
