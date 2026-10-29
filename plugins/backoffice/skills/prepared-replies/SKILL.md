---
name: prepared-replies
description: Takes an incoming message pasted by the person (WhatsApp, Instagram, Facebook, Meta lead form, email), extracts the prospect's data, scores it, drafts 1-2 reply options and a next follow-up date, and keeps one Leads-Kanban lead per prospect. Use it whenever the person pastes a message from a prospect or says "me escribió alguien".
allowed-tools: mcp__plugin_backoffice_backoffice, mcp__plugin_backoffice_meta-ai
---

# Prepared replies

The agent prepares, the person answers. Nothing is sent or auto-replied.
With the Meta-AI gateway connected (see `meta-connector`), you may read the full thread with `get_conversation_history`
instead of asking the person to paste it, and send an option only after the person approves that exact message
(`send_message`, inside Meta's 24-hour window; the hook asks again). Otherwise the person sends.
Stages and lead format: `../pipeline-stages.md` (read it first).

## Procedure

1. Read `ventas/criterios-de-calificacion.md`, `ventas/oferta.md`, `ventas/tono-y-reglas.md` (and `cliente-ideal.md`). If `ventas/` is missing, stop and hand back to `sales-setup`.
2. **Extract** only what the message says: name, contact, channel, interest, quantity, budget, timing, location, questions asked. Quote key phrases. Anything else is `[NO DATA: …]`.
3. **Find the prospect:** `backoffice_lead_list` with `query` = name or contact. Found = update that lead; not found = create.
4. **Qualify** with the rubric: score per criterion, total /100, label caliente/tibio/frío, one line of why, and the list of missing data. Unconfirmed data never earns full points.
5. **Draft 1–2 reply options** in the business voice (WhatsApp-short unless email): each answers what they asked and ends with ONE next discovery question (the most valuable missing one, from the rubric's list). Prices, availability and terms only from `oferta.md`; otherwise ask or write `[NO DATA: …]` and flag it for the person. Respect «Nunca prometer» and «Cuándo escalar» (if triggered, say so and make the draft hand-off style).
6. **Next follow-up date:** propose one (hot: today/tomorrow; warm: +2–3 days; cold: +7), computed with `date`.
7. **Save files** with `backoffice_file_write` in `ventas/prospectos/<slug>/`: `ficha.md` (data table with status confirmed/`[NO DATA]`, score table, why, missing, history of messages with dates) and `respuestas.md` (the draft options, labelled BORRADOR). On a repeat message append to both; do not lose history.
8. **Lead:** `backoffice_lead_create` (`name`, `contact`, `source`, `interest`, `stage` `new`, `score`, `next_contact_at`, `notes` in the `pipeline-stages.md` format, `files` `ventas/prospectos/<slug>/`) or `backoffice_lead_update` (same fields; stage `contacted` once a draft is ready). Never set `won`; `lost` only with the reason in `notes`. If the person must decide or give data, write the question in `notes` («Esperando a la persona»).
9. Reply to the person in Spanish with: ficha summary (3–5 lines), score + why, the draft(s) ready to copy, the next date, and where it lives («pestaña Leads → columna <stage>» and «Archivos → ventas/prospectos/<slug>/»).
10. Several messages pasted at once: process each one separately, one lead each, then give a table (prospect · score · next step).

## Never

- Invent data, prices, availability, promotions or deadlines.
- Create a second lead for the same prospect, or set `won`.
- Send, schedule or auto-reply to anything; every message is a draft.
- Store sensitive data the prospect did not need to give.

## Why

Customers go cold in minutes. A ready, on-voice draft that already asks the right next question lets the person reply fast without inventing, and the Kanban shows who is waiting for whom.
