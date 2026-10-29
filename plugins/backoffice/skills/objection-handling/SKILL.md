---
name: objection-handling
description: Prepares a draft reply to a lead's objection (price, timing, trust, "I'll think about it", competition). Use it when a lead raises a doubt or resistance, without pressuring or offering unauthorized concessions.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Objection handling

## Procedure

1. Quote the lead's objection verbatim and classify it: price, timing, trust, authority ("I'll check with someone"),
   competition or other.
2. Identify what is behind it: is information missing, is trust missing, or does it truly not fit? Mark
   `confirmed` only what the lead said; everything else is assumed.
3. Reply in three moves: acknowledge, clarify with confirmed data, propose one small step.
4. Discounts, special terms or scope changes: do not offer them; flag them so the person
   decides.
5. If the lead is not a fit or says no, recommend closing politely and pausing the follow-up.
6. If asked to keep it, save the draft with `backoffice_file_write` in `ventas/reportes/<YYYY-MM-DD>-<task>/` and deliver it with `backoffice_task_deliver` (`files`).

## Exact output format

```markdown
Objection: "<verbatim quote>"  ·  Type: <type>
Reading: <what is behind it> (confirmed | assumed)
Reply (draft): "<acknowledge + clarify + small step>"
Needs the person's decision: <discount/term, or "none">
If they say no: <polite close>
```

## Example (sample data)

```markdown
Objection: "Me parece caro" (example)  ·  Type: price
Reading: has not seen what the price includes (assumed)
Reply (draft): "Te entiendo, es una decisión importante. Te detallo qué incluye cada concepto para que compares con calma. ¿Te lo mando por aquí?"
Needs the person's decision: any price adjustment
If they say no: "Gracias por tu tiempo; si más adelante te sirve, con gusto retomamos."
```

## Never

- Invent a discount, bonus or scarcity to close.
- Disparage the competition with data that is not confirmed.
- Keep pushing after a clear "no".

## Why

An objection is almost always an unanswered question; pressuring or inventing concessions destroys trust.
