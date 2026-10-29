---
name: executive-dashboard
description: Builds the one-page KPI dashboard for the owner, with the source and date of every figure. Use it when asked "how are we doing", for an overview of the business, or before a review or decision that needs numbers from several areas.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Executive dashboard

## Procedure

1. List the KPIs the person asked for; if there is no list, use at most 8: revenue for the period, collected,
   overdue receivables, available cash, new leads, open quotes, closings, overdue
   commitments.
2. For each KPI locate the source file with `backoffice_file_list` / `backoffice_file_read` (sales, collections, marketing, finance deliverables) or ask the person
   for the data. No source: "no data".
3. Calculate with Bash/python (sums, variations, percentages); never from memory. Percentages come from
   totals, not from averages of percentages.
4. Compare against the previous period and against the target, if they exist. If there is no target: "no target".
5. Mark the status: OK, ATTENTION (variance greater than 10% or the rule the person sets) or CRITICAL.
6. Save `dashboard-YYYY-MM-DD.md` with `backoffice_file_write` in `executive/<YYYY-MM-DD>-dashboard/` and deliver it with `backoffice_task_deliver` (`files`). It must fit on one page.

## Output format

```markdown
# Executive dashboard — period
Generated: 15 Oct 2026 · Currency: MXN (excluding IVA unless stated)

| KPI | Value | Previous | Target | Status | Source (file, date) |
|---|---:|---:|---:|---|---|

**What needs attention:** at most 3 lines, each with its figure.
**Missing data:** list, with whom each item is requested from.
```

Example (sample data, not real):

| KPI | Value | Previous | Target | Status | Source |
|---|---:|---:|---:|---|---|
| Collected (example) | $100,000.00 | $80,000.00 | $90,000.00 | OK | example/collections.csv, 14 Oct 2026 |
| Overdue receivables (example) | $45,000.00 | $30,000.00 | $20,000.00 | CRITICAL | example/collections.csv, 14 Oct 2026 |
| Closings (example) | no data | 3 | 4 | ATTENTION | sales report missing |

## Never

- Put in a figure without its source and date, or round to make it look better.
- Mix figures with and without IVA without saying so.
- Exceed one page or add KPIs nobody asked for.

## Why

A dashboard with a figure of unknown origin makes the owner decide with a number nobody can defend.
