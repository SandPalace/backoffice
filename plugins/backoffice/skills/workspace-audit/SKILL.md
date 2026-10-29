---
name: workspace-audit
description: Reviews a business's workspace in marketing/<business>/ (virtual files) and says what is there, what is missing and which step of the cycle it is on, with a single next step. Read-only. Use it at the start of any session, with "hi", "where are we?", "what's next?", or before planning, producing or reporting.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Audit the workspace

You only read: you do not create or edit anything. If something is not in a file or a task, it does not exist.

## Procedure

1. **Businesses.** `backoffice_file_list` with prefix `marketing/` (not recursive). None: the step is `onboarding` (new business). Several: ask which
   one we are working on today.
2. **Base files.** Check with `backoffice_file_list` (recursive, prefix `marketing/<business>/`) that `facts.md`, `brief.md` and `calendar.csv` exist, and what is in
   `research/`, `creatives/`, `reports/`, `data/` and `documents/` (including files the person just uploaded in the Archivos tab).
3. **Facts.** Read `facts.md` with `backoffice_file_read`. Count the `confirmed`, `inferred` and `missing` rows in `facts.md`. An `inferred` counts as
   missing for writing copy. Critical gaps: business, offer, prices, location, schedule, audience,
   channels, brand, goal, measurement, period, constraints.
4. **Tasks.** With `backoffice_task_list` look at the business's tasks: which are in `review` (waiting for the
   person), `blocked` (with a question) or `done`. The brief is approved only if its task is `done`.
5. **Calendar.** Read `calendar.csv` with `backoffice_file_read` and count pieces by status (the 7th column).
   List the blocked ones with their `question`, and the `approved` ones without `approved_by` or without a `done` task.
6. **Cycle step.** Place the business in the 7 steps of `workspace-guide` and give **one** next step.

## Exact format

```markdown
**<Business> - workspace status**

- Brief: approved (task T-0012) | in review (T-0012) | does not exist
- Facts: 9 confirmed · 2 inferred (prices, schedule) · 1 missing (measurement)
- Research: 1 note (2026-10-15) | none
- Calendar: 6 pieces (3 proposed, 1 blocked, 2 approved) · 1 approved without a done task
- Creatives: 2 pieces with a version (P01_v1, P02_v1) · Reports: none
- Cycle step: 3 of 7 (plan)

**Next step:** <just one, concrete, e.g. "ask about the Saturday schedule (P04 blocked)">
```

(The numbers in the example are illustrative. The status is shown to the person in their language.)

## Never

- Write, create folders or change statuses: another step of the cycle does that.
- Ask the person for a disk path or to open a file from disk.
- Treat something as approved without seeing its task in `done`.
- Propose two next steps.

## Why

Resuming a business from chat memory leads to repeating work or skipping an approval; reading the real status
avoids both.
