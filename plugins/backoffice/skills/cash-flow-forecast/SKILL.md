---
name: cash-flow-forecast
description: Projects the 13-week cash flow with explicit assumptions: opening balance, expected collections, fixed and variable payments, and the week in which cash hits its minimum. Use it to know whether the money is enough, before a large expense, or when the person asks "how long can we last?".
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# 13-week cash flow forecast

## Procedure

1. Ask for or read (`backoffice_file_list` / `backoffice_file_read`; the person uploads sheets in the web "Archivos" tab): the real opening balance (with date), accounts receivable with expected date, fixed payments (payroll,
   rent, utilities, taxes) and known variable payments. Every data point with its source; anything missing:
   "no data" and ask.
2. Write the **assumptions** in a table before calculating: when each client pays, what percentage is
   collected late, which new income is counted and which is not. Mark each one as data or estimate.
3. Calculate with python in a scratch folder (`$TMPDIR/backoffice-work/<task>/`; save the script next to the result, and persist both at the end): week 1 starts on the nearest Monday;
   closing balance = opening balance + collections - payments, week by week.
4. Calculate the cash minimum and the week it occurs; if it is negative or below the minimum the
   person set, flag it.
5. Present two scenarios: base and prudent (collections 2 weeks late or one large client not paying).
6. IVA and ISR: if you include them, as an indicative estimate and with the notice "validate it with your accountant".
7. Save `cash-flow-YYYY-MM-DD.csv` (13 rows), the script and `cash-flow-YYYY-MM-DD.md` with `backoffice_file_write` in `executive/<YYYY-MM-DD>-cash-flow/` and deliver them with `backoffice_task_deliver` (`files`).

## Output format

```markdown
# 13-week cash flow — from 12 Oct 2026 (MXN)
## Assumptions
| # | Assumption | Data or estimate | Source |
## Forecast (base scenario)
| Week | Start | Opening balance | Collections | Payments | Closing balance |
|---|---|---:|---:|---:|---:|
## Prudent scenario: cash minimum and week
## Alerts and decision the person needs to make
```

Example (all fictional): Week 1 · 12 Oct 2026 · $50,000.00 · collections $20,000.00 · payments
$35,000.00 · closing balance $35,000.00. Assumption 1: "Example Client pays at 15 days" (estimate).

## Never

- Project without a list of assumptions, or count collections without a date or evidence as certain.
- Calculate by hand: everything comes from the script.
- Present the tax projection as definitive.

## Why

Most SMBs do not fail for lack of sales, but for not seeing in time the week when cash
runs out.
