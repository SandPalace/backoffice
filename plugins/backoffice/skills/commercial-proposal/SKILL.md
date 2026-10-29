---
name: commercial-proposal
description: Drafts a proposal or quote using prices taken only from the list the person confirmed. Use it when a qualified lead asks for a price, scope or a formal proposal.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Commercial proposal

## Procedure

1. Gather the lead's profile (confirmed needs) and the confirmed price list, with its date (`backoffice_file_list` / `backoffice_file_read`; the person uploads the list in the web "Archivos" tab).
   No confirmed list: stop and ask for it.
2. Match each need to a line on the list. Anything not on the list: "no price:
   pending from the person".
3. Calculate subtotals and total using only figures from the list; show the math. MXN; IVA only if the list
   specifies it.
4. Terms (payment, validity, delivery, availability): include them only if the person confirmed them;
   otherwise they stay under "pending".
5. Write the draft and the pending list with `backoffice_file_write` in `ventas/prospectos/<slug>/propuesta.md`. The person reviews, signs and sends.

## Exact output format

```markdown
# Proposal for <client> — <15 Oct 2026>
DRAFT — do not send without the person's review and signature.
Price list used: <file, confirmation date>

## What we understood
- <confirmed need, with a short quote>

## Proposal
| item | quantity | price (list) | subtotal |
|---|---|---|---|
| ... | ... | $X.00 | $X.00 |
TOTAL: $X.00 MXN

## Terms
- <only confirmed ones, or "pending from the person">

## Pending for the person
- <missing data or signature>
```

## Example (sample data)

```markdown
# Proposal for Example Client — 15 Oct 2026
DRAFT — do not send without the person's review and signature.
Price list used: example-prices.md, confirmed 14 Oct 2026 (example)

## What we understood
- "Quiero promocionar mi propiedad en redes" (example)

## Proposal
| item | quantity | price (list) | subtotal |
|---|---|---|---|
| Example service A | 1 | $1,000.00 | $1,000.00 |
| Example service B | 2 | $500.00 | $1,000.00 |
TOTAL: $2,000.00 MXN

## Terms
- Payment method: pending from the person

## Pending for the person
- Confirm validity and payment method; sign.
```

## Never

- Put in a price that is absent from the list, or estimate, round or "match the competition".
- Invent discounts, dates, capacity or warranties.
- Use validity or urgency that is not confirmed.

## Why

A proposal with an invented price binds the person legally and commercially; a visible "pending" is better.
