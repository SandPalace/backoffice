---
name: decision-memo
description: Writes a one- or two-page memo for the person to decide something (hire, invest, change prices, prioritize between areas) with options, risks, a recommendation and what they sign. Use it when a decision involves money, people or clients.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Decision memo

## Procedure

1. Write the decision as a question with a deadline: "Do we hire X before 30 Oct 2026?".
2. Gather data from the teams (finance, open tasks, sales, marketing, collections; `backoffice_file_list` / `backoffice_file_read`) and note the source of each
   figure. Anything missing: "no data" and who provides it.
3. Define 2-4 real options, including "do nothing". For each: cost (calculated with Bash),
   expected benefit, risk, and whether it can be reversed.
4. Ask the `cfo` for the cash impact and review the capacity impact with `backoffice_overview` if the decision moves money or people.
5. Recommend one option and say what would change the recommendation.
6. End with **What the person signs**: the exact action they authorize and its amount or scope.
7. Save `memo-YYYY-MM-DD-topic.md` with `backoffice_file_write` in `executive/<YYYY-MM-DD>-<task>/` and deliver it with `backoffice_task_deliver` (`files`).

## Output format

```markdown
# Decision memo: <question>
To: <person> · From: <agent> · Date: 15 Oct 2026 · Decide before: <date>

**Recommendation in one line.**

## Context (max. 5 lines, with sources)
## Options
| Option | Cost | Benefit | Risk | Reversible |
|---|---:|---|---|---|
## Risks of the recommended option (max. 3)
## What would change the recommendation
## Missing data
## What the person signs
```

Example (all fictional): "Do we pay for a $5,000.00 ad in campaign X? (example)". Option A: pay
$5,000.00, estimated return "no data", reversible. Option B: do nothing. Recommendation: B until we have the
cost per result of the previous campaign. Signs: nothing for now.

## Never

- Present a single option disguised as a decision, or hide the "do nothing" option.
- Give a recommendation without saying what is sacrificed.
- Use figures without a source or a projection without its assumptions.

## Why

Whoever signs needs to be able to discuss the memo in 3 minutes and know exactly what they are committing to.
