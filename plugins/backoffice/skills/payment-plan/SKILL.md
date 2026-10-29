---
name: payment-plan
description: Prepares an installment payment plan proposal for a client with an overdue balance, for the person to authorize. Use it when a client asks for terms or when the collections lead considers installments advisable; the agent never grants it.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Payment plan

## Procedure

1. **Confirm the balance** with the aging report and the reconciliation (read with `backoffice_file_read` from `collections/`) (balance = open invoices minus deposits
   seen on the bank statement). Without that data there is no plan.
2. **Ask the person** (not yourself): maximum number of installments, minimum down payment, date of the
   first payment and whether there is interest. **No interest unless it appears in a confirmed contract or promissory note (pagaré).**
3. **Calculate with python** and distribute the cents: installment = balance / n rounded to 2 decimals; the last
   one absorbs the difference.

```bash
python3 -c "s=12000.00;n=3;p=round(s/n,2);u=round(s-p*(n-1),2);print(p,u,round(p*(n-1)+u,2)==s)"
```

4. **Verify:** the sum of the installments (plus down payment) must equal the balance; dates must fall on
   business days of a Monday-to-Saturday calendar.
5. **Save the proposal** with `backoffice_file_write` (`collections/<YYYY-MM-DD>-<task>/payment-plan-<client>.md`), deliver it with `backoffice_task_deliver` (`files`), **marked** "PENDING THE PERSON'S AUTHORIZATION". Until they
   approve it, it is not communicated to the client.
6. **If the person approves**, draft the confirmation with the `payment-reminder` skill and
   suggest putting the agreement in writing (the person decides whether with legal advice).

## Output format (`payment-plan-<client>.md`)

```markdown
# Payment plan proposal · Example Client A · PENDING AUTHORIZATION
Overdue balance: $12,000.00 (invoices F-003, F-005) · Source: aging-report.md, cutoff 15 Oct 2026
Interest: none (no confirmed clause) · Down payment: $0.00

| # | Due date | Amount |
|---|---|---:|
| 1 | 31 Oct 2026 | $4,000.00 |
| 2 | 30 Nov 2026 | $4,000.00 |
| 3 | 31 Dec 2026 | $4,000.00 |
| | **Total** | **$12,000.00** |

Check: $12,000.00 = balance ✔
The person decides: do they authorize the plan? Do they require a down payment? What happens if an installment fails?
```

(Sample data.)

## Never

- Grant, promise or hint at the plan to the client before the person authorizes it.
- Invent interest, penalties or acceleration clauses.
- Give legal advice about the agreement.
- Treat an installment as fulfilled if it is not on the bank statement.

## Why

A plan is only honored if it is realistic and approved by whoever answers for the business. If the agent
granted it, it would commit the person without their knowledge.
