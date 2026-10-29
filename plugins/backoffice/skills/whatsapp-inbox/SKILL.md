---
name: whatsapp-inbox
description: Handles the WhatsApp chats that wrote in and are still unanswered. Reads the inbox from Back Office, qualifies each lead with the business's own rubric and leaves ONE reply draft per chat for the person to approve and send from the web. Use it when the person says «atiende mis WhatsApp», «revisa mensajes pendientes» or «qué me escribieron por WhatsApp».
allowed-tools: mcp__plugin_backoffice_backoffice, mcp__plugin_backoffice_meta-ai
---

# WhatsApp inbox

The agent prepares, the person sends. A draft created here is NOT sent: the person reviews it and clicks Enviar in the web.
Stages and lead format: `../pipeline-stages.md`. Reply rules: the `prepared-replies` skill (same rules, but the messages come from Back Office instead of being pasted).

## Procedure

0. **Where the messages come from.** If the Meta-AI gateway is connected (`list_channels` answers; see `meta-connector`),
   prefer it: it covers WhatsApp, Messenger and Instagram. Read with `list_inbox_contacts` and, per contact,
   `get_conversation_history` (`channel_id` + `user_id`); treat each contact whose last message is theirs as unanswered.
   Otherwise use Back Office's inbox (step 1); OpenWA (`openwa-setup`) stays the fallback for WhatsApp.
1. Call `backoffice_whatsapp_inbox` with `only_unanswered: true` (default). If the tool errors or returns nothing, tell the person (Spanish) that WhatsApp is not connected and how to start it (`backoffice whatsapp`, guide `docs/WHATSAPP.md`); do not invent chats. Empty list = «No tienes mensajes pendientes».
2. Read `ventas/oferta.md`, `ventas/criterios-de-calificacion.md`, `ventas/tono-y-reglas.md` (and `cliente-ideal.md`) once. If `ventas/` is missing, stop and run `sales-setup` first, then come back.
3. For EACH chat in the inbox, one at a time:
   a. Get the lead: use the `lead_id` from the inbox; otherwise `backoffice_lead_list` with `query` = name or phone. No lead = `backoffice_lead_create` (`source` `whatsapp`, `stage` `new`, `contact` = the phone as given). Never create a second lead for the same person.
   b. Read `ventas/prospectos/<slug>/ficha.md` if it exists, so you know the history.
   c. Extract only what the messages say (interest, quantity, budget, timing, questions). Missing data is `[NO DATA: ...]`, never assumed.
   d. Qualify with the rubric (see `qualify-lead`): score /100, label, what is missing.
   e. Write ONE draft with `backoffice_whatsapp_draft` (`chat_id` from the inbox, `lead_id`, `text`). Draft rules below.
      Meta-AI chats: put the draft in the summary and in `respuestas.md` instead. Send it only if the person approves
      THAT message (show recipient and text), with `send_message` (`channel_id`, `to` = the contact's id, `type: "text"`,
      `text`); the hook asks once more. Only inside Meta's 24-hour window after their last message; outside it, say so
      (a pre-approved template is the person's decision).
   f. Update the lead with `backoffice_lead_update`: `score`, `notes` in the `pipeline-stages.md` format, `next_contact_at`, and `stage` `contacted` now that a draft is prepared (keep `qualified` or `proposal` if already there; never go back). Never `won`; `lost` only with the reason in `notes` and the person's OK.
   g. Append the exchange and the draft to `ventas/prospectos/<slug>/ficha.md` / `respuestas.md` (`backoffice_file_write`); do not lose history.
4. Draft rules (Mexican Spanish, in the business voice from `tono-y-reglas.md`):
   - WhatsApp-short: 1-4 lines, no walls of text, no bullet lists unless asked.
   - Answer what they asked, then ask ONE discovery question (the most valuable missing item from the rubric).
   - Prices, availability, deadlines and terms ONLY from `oferta.md`; otherwise ask or tell the person what you need. Respect «Nunca prometer» and «Cuándo escalar» (complaint, discount, legal, minor: write a hand-off style draft and flag it).
   - Maximum 1500 characters. Only chats that wrote in; no groups, no cold outreach.
5. Summarize to the person in Spanish: a table (chat · puntaje · etapa · borrador en una línea), then «Esperan tu aprobación en la web: pestaña Leads → el lead → WhatsApp, o la página /whatsapp», then «Necesito de ti:» (only data or decisions). Say «borrador listo», never «enviado».

## Never

- Say or imply a message was sent unless the person approved it and `send_message` returned success.
- Invent prices, availability, promotions or deadlines.
- Create more than one draft per chat in a run, or reply to a chat that did not write in.
- Set a lead to `won`, or contact anyone outside the inbox.

## Why

People writing on WhatsApp expect an answer in minutes. A reviewed, on-voice draft that already asks the right next question lets the person reply fast, and WhatsApp's anti-automation rules (and the person's reputation) require a human to press send.
