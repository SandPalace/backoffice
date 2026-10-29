---
name: payment-reconciliation
description: Cross-checks bank statement deposits (SPEI, cash, card) against open invoices, proposes applications and flags differences. Use it when payments arrive, when a client says they already paid, and always before sending a collection message.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Payment reconciliation

## Procedure

1. **Confirm the sources:** bank statement (CSV) with period and account, and open invoices, found with `backoffice_file_list` and read with `backoffice_file_read` (the person uploads them in the web "Archivos" tab; python runs in a scratch folder `$TMPDIR/backoffice-work/<task>/`). Minimum
   columns: date, amount, reference/description, and per invoice folio, client, balance.
2. **Only bank statement deposits count.** A client's receipt or screenshot = "to confirm".
3. **Match in this order:** (a) reference or folio in the description, (b) exact amount of a single
   invoice, (c) same client and nearby date. If there is more than one candidate: do not apply, ask.
4. **Classify each deposit:** `applied` (equal to the balance), `partial` (less), `excess` (more),
   `no invoice`, `to confirm`.
5. **Calculate with python** comparing to the cent; never round differences.
6. **Verify:** total deposits = applied + partial + excess + no invoice + to confirm, and for
   each invoice new balance = previous balance - applied.
7. **Deliver the proposal:** save `reconciliation.md` with `backoffice_file_write` in `collections/<YYYY-MM-DD>-<task>/` and use `backoffice_task_deliver` (`files`). The person applies the payments in their system and issues the payment
   complements (complementos de pago) that apply; you do not close invoices.

## Output format (`reconciliation.md`)

```markdown
# Reconciliation — bank statement 1-15 Oct 2026
Source: bank-statement.csv · open invoices: portfolio.csv

| Date | Deposit | Reference | Invoice | Status | Remaining balance |
|---|---:|---|---|---|---:|
| 12 Oct 2026 | $10,000.00 | F-001 | F-001 | applied | $0.00 |
| 13 Oct 2026 | $3,000.00 | Example B | F-002 | partial | $2,000.00 |
| 14 Oct 2026 | $1,200.00 | no description | — | no invoice | — |

Check: $14,200.00 deposits = $10,000.00 + $3,000.00 + $1,200.00 ✔
Do not collect: F-001. Collect only $2,000.00 of F-002.
Questions for the person: whose is the $1,200.00 deposit from 14 Oct?
```

(Sample data.)

## Never

- Treat as paid something that does not appear on the bank statement.
- Force a doubtful match or adjust cents to make it add up.
- Close invoices, move money or write to the client.
- Copy bank data outside the reconciliation.

## Why

Collecting from someone who already paid damages the relationship; treating as paid what never arrived damages cash.
The bank statement is the only proof.
