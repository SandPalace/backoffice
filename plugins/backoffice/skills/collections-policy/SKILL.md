---
name: collections-policy
description: Defines with the person the business's collections policy (when and how clients are contacted, what tone, what gets escalated, what requires their authorization) and puts it in writing. Use it the first time you work with a business or when there are doubts about contact rules, interest or discounts.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Collections policy

## Procedure

1. **Check** with `backoffice_file_list` whether `collections/collections-policy.md` already exists (read it with `backoffice_file_read`). If it does, read it and confirm
   with the person that it is still valid.
2. **Ask, one thing at a time**, and record only what they answer. Anything unanswered stays "no data":
   - usual credit terms (payment days) and collection methods (SPEI, cash, card);
   - what document backs the credit (contract, promissory note (pagaré), invoice only) and **whether it provides for late-payment
     interest or legal action**, with the verbatim clause;
   - channels and authorized contact per client; hours (default 9:00-19:00 Mon-Sat); minimum days between two
     messages to the same client (default 3; `payment-reminder` enforces it with its log);
   - key or sensitive clients that always go through them;
   - who authorizes discounts and payment plans (always the person).
3. **Set the contact calendar** by days overdue (upcoming, 1-7, 8-30, 31-60, 60+) and the tone of
   each level (see `payment-reminder`).
4. **Write the policy** with `backoffice_file_write` (`collections/collections-policy.md`) using the format below and ask for their sign-off. Without sign-off, it stays as a
   draft.

## Output format (`collections-policy.md`)

```markdown
# Collections policy — [Example Business] · status: DRAFT / APPROVED on 15 Oct 2026
Credit: 30 days · Methods: SPEI, cash, card · Backing: CFDI invoice (no promissory note)
Late-payment interest: none confirmed · Legal action: not mentioned in messages

| Days overdue | Action | Tone | Who authorizes sending |
|---|---|---|---|
| -3 to 0 days | reminder | friendly | person |
| 1-30 | reminder | friendly to firm | person |
| 31-60 | follow-up | firm | person |
| 60+ | call by the person | final notice, no threats | person |

Fixed rules: hours 9:00-19:00 Mon-Sat; at least 3 days between messages to the same client; only the client (never family or employer);
discounts and plans: the person authorizes them. Key clients: Example Client A.
```

(Sample data. This is not legal advice; for clauses or interest, consult a lawyer.)

## Never

- Invent a clause, an interest rate or a credit term.
- Treat the policy as approved without the person's sign-off.
- Include threats, contact with third parties or hours outside 9:00-19:00 Mon-Sat.

## Why

With written rules the team collects consistently, and the person does not learn from the client that something was said
that they never authorized.
