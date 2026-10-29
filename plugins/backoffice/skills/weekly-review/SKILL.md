---
name: weekly-review
description: Does the week's close: achievements, commitments met and overdue, blockers and next week's priorities. Use it every Friday or Monday, or when the person asks "how did we do this week".
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Weekly review

## Procedure

1. Define the week (Monday to Sunday, full dates) and locate the previous review to bring over its
   commitments and priorities.
2. Read each team's deliverables (`backoffice_file_list` / `backoffice_file_read`) and tasks for the week. For each previous commitment mark: met,
   overdue (days) or canceled, with the evidence (file or confirmation).
3. Calculate the countable items with Bash: met / total, money collected, leads or quotes if there is a file.
4. List blockers: what it is, who resolves it, since when, what it costs each additional day.
5. Propose at most 3 priorities for next week, each with an owner and a date.
6. Save `review-YYYY-MM-DD.md` (closing date) with `backoffice_file_write` in `executive/<YYYY-MM-DD>-review/` and deliver it with `backoffice_task_deliver` (`files`).

## Output format

```markdown
# Weekly review: 5 to 11 Oct 2026
## Achievements (max. 5, each with evidence)
## Commitments of the week
| Commitment | Owner | Date | Status | Evidence |
|---|---|---|---|---|
Met: X of Y
## Blockers
| Blocker | Who resolves it | Since | What happens if it continues |
|---|---|---|---|
## Next week's priorities (max. 3)
## Decisions the person needs to make
```

Example (fictional): Commitment "Send quote to Example Client" · Ana (example) · 9 Oct 2026 ·
Overdue, 2 days · no evidence. Met: 3 of 4.

## Never

- Treat a commitment as met without evidence.
- Leave a blocker without an owner or date.
- Exceed 3 priorities.

## Why

What is reviewed with evidence gets done; what is reviewed "from memory" repeats every week.
