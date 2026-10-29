---
name: quarterly-plan
description: Builds the quarter plan with 3 to 5 objectives, each with measures, target, owner and date. Use it at the start or close of a quarter, or when the person wants to define where the business is heading over the next three months.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Quarterly plan

## Procedure

1. Define the quarter with full dates (for example 1 Oct to 31 Dec 2026) and locate the previous plan and
   its close.
2. Read the baseline data (`backoffice_file_read`): recent dashboard, cash flow, team capacity. Without a baseline: "no data".
3. Propose 3 to 5 objectives that change the business, not routine tasks. Each objective has 1-3 measures
   with a current value (from a file), target and date.
4. Assign one owner per objective (a person or a team, not "everyone").
5. Check feasibility: capacity is checked against open tasks (`backoffice_overview`) and the `cfo` validates the cost. Calculate with Bash whatever
   can be summed. What does not fit moves to "We will not do this quarter".
6. Save `plan-YYYY-QN.md` with `backoffice_file_write` in `executive/<YYYY-MM-DD>-<task>/`, deliver it with `backoffice_task_deliver` (`files`) and leave the points the person decides at the end.

## Output format

```markdown
# Quarterly plan — Q4 2026 (1 Oct to 31 Dec 2026)
## Objective 1: <desired outcome in one sentence>
Owner: · Estimated cost:
| Measure | Today | Target | Date | Source |
|---|---:|---:|---|---|
Key initiatives (max. 3):
## ... up to 5 objectives
## We will not do this quarter
## Risks (max. 3) and assumptions
## What the person approves
```

Example (fictional): Objective 1, "Reduce overdue receivables". Measure: overdue today $45,000.00 (example,
collections.csv) → target $20,000.00 by 31 Dec 2026. Owner: collections (example).

## Never

- More than 5 objectives, or objectives without a measure, owner or date.
- Set targets with invented or "trend-based" numbers without a baseline.
- Put daily operations in as an objective.

## Why

A plan with 12 objectives is a wish list; with 3 to 5 measurable ones, it can be reviewed every week.
