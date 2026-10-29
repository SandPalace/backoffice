---
name: pipeline-report
description: Summarizes the state of the sales pipeline in a prioritized table (who, stage, score, next step and date) with alerts for cold leads. Use it at the start of the day, when the person asks how sales are going, or to decide whom to handle first.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Pipeline report

## Procedure

1. Read the leads with `backoffice_lead_list` (all stages) and, for detail, `ventas/prospectos/<slug>/` with `backoffice_file_read`. Count only what is there. Stages: `../pipeline-stages.md`.
2. For each lead record the stage (new, contacted, qualified, proposal, won, lost),
   score (/100), last contact and next step with a date.
3. Sort: first those awaiting a reply from us, then highest score/confirmed urgency, then the rest.
4. Alert: lead with no contact for more than 2 days (new) or 7 days (others).
5. Amounts only from proposals sent, exactly as they appear in them; if there are none, "no data". Do not project
   revenue or invented probabilities.
6. Close with what the person needs to provide (data and signatures).
7. Save the report with `backoffice_file_write` in `ventas/reportes/<YYYY-MM-DD>-pipeline/report.md` and deliver it with `backoffice_task_deliver` (`files`).

## Exact output format

```markdown
# Pipeline — <15 Oct 2026>
Source: <files>

| # | lead | stage | pts | last contact | next step (date) | proposed amount |
|---|---|---|---|---|---|---|

Alerts: <cold leads or "none">
Summary: <N active leads; X hot; Y awaiting our reply>
I need from the person: <data/signatures, or "nothing">
```

## Example (sample data)

```markdown
# Pipeline — 15 Oct 2026 (example)
Source: example-leads.csv

| # | lead | stage | pts | last contact | next step (date) | proposed amount |
|---|---|---|---|---|---|---|
| 1 | Example Person A | proposal sent | 8 | 14 Oct 2026 | follow-up touch 2 (17 Oct 2026) | $2,000.00 |
| 2 | Example Person B | new | 5 | no data | reply today | no data |

Alerts: Example Person C with no contact for 9 days (example)
Summary: 3 active leads; 1 hot; 1 awaiting our reply
I need from the person: approve the follow-up draft for lead 1.
```

## Never

- Invent amounts, closing probabilities or dates.
- Show personal data that is not needed to decide.
- Mark a lead as won or lost without the person's confirmation.

## Why

A pipeline without an owner or a date per lead is where sales go cold; the report makes visible who is waiting for a reply.
