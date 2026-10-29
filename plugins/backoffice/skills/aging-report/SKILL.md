---
name: aging-report
description: Builds the portfolio aging report (current, 1-30, 31-60, 61-90, 90+ days) from a CSV or sheet of open invoices, with a check that the buckets add up to the total. Use it when the person asks how much they are owed and since when, or before prioritizing collections.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Aging report

## Procedure

1. **Find or confirm** the file (CSV/sheet) with `backoffice_file_list` (the person uploads it in the web "Archivos" tab) and the **cutoff date**. Minimum columns: folio, client,
   due_date, amount, paid. If the due date is missing: "no data" and ask.
2. **Balance per invoice** = amount - applied payments (only those that appear on the bank statement).
3. **Days overdue** = cutoff date - due date. Less than or equal to 0: current.
4. **Buckets:** current (not yet due), 1-30, 31-60, 61-90, 90+ (91 or more).
5. **Calculate with python**, not by hand, in a scratch folder (`$TMPDIR/backoffice-work/<task>/`): `backoffice_file_read` the CSV and write it there as `portfolio.csv` first:

```bash
python3 - <<'EOF'
import csv, datetime as d
cutoff = d.date(2026, 10, 15)          # confirmed cutoff date
buckets = {"current":0,"1-30":0,"31-60":0,"61-90":0,"90+":0}; total = 0; n = 0
for r in csv.DictReader(open("portfolio.csv", encoding="utf-8")):
    balance = round(float(r["amount"]) - float(r.get("paid") or 0), 2)
    days = (cutoff - d.date.fromisoformat(r["due_date"])).days
    k = "current" if days<=0 else "1-30" if days<=30 else "31-60" if days<=60 else "61-90" if days<=90 else "90+"
    buckets[k] = round(buckets[k]+balance, 2); total = round(total+balance, 2); n += 1
print(buckets, total, n, round(sum(buckets.values()),2) == total)
EOF
```

6. **Verify:** the sum of the buckets must equal the portfolio total and the invoice count must
   equal the rows read. If it does not add up, do not deliver: find the broken row.
7. **Risks:** a client with more than 30% of the portfolio, 90+ invoices, clients with 2 or more overdue.

Save the result with `backoffice_file_write` as `aging-report.md` in `collections/<YYYY-MM-DD>-<task>/` and deliver it with `backoffice_task_deliver` (`files`).

## Output format (`aging-report.md`)

```markdown
# Aging report — cutoff 15 Oct 2026
Source: portfolio.csv (4 invoices) · Currency: MXN

| Bucket | Invoices | Amount | % |
|---|---:|---:|---:|
| Current | 1 | $10,000.00 | 39.2% |
| 1-30 | 1 | $5,000.00 | 19.6% |
| 31-60 | 1 | $8,000.00 | 31.4% |
| 61-90 | 0 | $0.00 | 0.0% |
| 90+ | 1 | $2,500.50 | 9.8% |
| **Total** | **4** | **$25,500.50** | 100% |

Check: sum of buckets $25,500.50 = portfolio total $25,500.50 ✔
Risks: Example Client A concentrates 70.6% of the portfolio; 1 invoice 90+ (97 days).
Questions for the person: is F-004 still valid or is it disputed?
```

(Sample data.)

## Never

- Deliver with the check in disagreement, or round to make it add up.
- Assume a missing cutoff date or due date.
- Subtract payments the client says they made but that are not on the bank statement.

## Why

Prioritizing with a wrong total sends you after the wrong client. A figure that adds up to the cent
is what lets the person trust the rest.
