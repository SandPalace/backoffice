---
name: workspace-guide
description: The marketing team's map - where each file of a business goes in marketing/<business>/ (the workspace's virtual files), which statuses a piece has, who signs off on what, the 7-step production cycle and how Back Office tasks relate to files. Use it before creating or moving any file, when you do not know where something goes, or when asked "how does it work?" or "what's next?".
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Marketing workspace

Every business lives in `marketing/<business>/` of the workspace's Back Office storage (`<business>` in lowercase with hyphens:
`south-yoga-studio`). These are virtual files: read them with `backoffice_file_list` / `backoffice_file_read`, write them with `backoffice_file_write`. The person sees and uploads them in the web "Archivos" tab; no disk paths are ever involved. What is not in a file does not exist; what has no task is not delivered.

## 1. The map

```
marketing/<business>/
  facts.md         table: fact | value | status (confirmed|inferred|missing) | source (who and when)
  brief.md         business, audience, offer, voice, goals, constraints; every claim points back to facts.md
  calendar.csv     id,date,weekday,platform,format,topic,status,question,approved_by
  research/        notes with sources and dates
  creatives/       Pxx_vN.md (copy, script, prompts, facts used with source); never overwrite: _v2, _v3
  reports/         report-YYYY-MM-DD.html
  data/            CSV exports and optional metrics.db
  documents/       files the person hands over (PDFs, images, spreadsheets) and index.md (see read-documents)
```

## 2. Piece statuses (the `status` column of calendar.csv)

| status | means | who writes it |
|---|---|---|
| `proposed` | the agent planned it; the person still has to approve the calendar | CMO |
| `blocked` | has a pending `question` for the person; only that piece stops | CMO |
| `approved` | the person approved the task and the agent saw it in `backoffice_task_list` | CMO, with `approved_by` |
| `published` | the person published it and said so | CMO, based on what the person confirms |
| `rejected` | the person discarded it during review | CMO, based on what the person indicates |

`approved_by` is written as `person (task T-xxxx)`, with the real task id. The agent never decides or
invents an approval. `weekday` is computed with `date` from `date`, never from memory.

## 3. Tasks and files

- Every delivery is a task: the brief, the calendar, each batch of creatives, each report.
- The agent registers the files with `backoffice_task_deliver` (`files`) and moves the task to `review`.
- The person approves on the web (tasks tab): the task moves to `done`. **That is the source of truth
  for approval**, not the chat or the file's contents.
- A piece with a question: task `blocked` with the question in the description and `backoffice_checkin` as `waiting`.
- To know the real status, query `backoffice_task_list`; the calendar only reflects what you already saw there.

## 4. Production cycle (7 steps)

| # | Step | Done by | Skill | Leaves | Sign-off |
|---|---|---|---|---|---|
| 1 | Onboarding | CMO + person | `onboarding` | `facts.md`, `brief.md` | person approves the brief's task |
| 2 | Research | researcher | `market-research` | `research/` | person's review (optional) |
| 3 | Plan | CMO | `content-calendar` | `calendar.csv` (proposed/blocked) | person approves the calendar's task |
| 4 | Produce | creative | `fact-check`, `content-script`, `image-prompt`, `video-prompt` | `creatives/Pxx_vN.md` | person approves the batch's task |
| 5 | Publish | CMO prepares, **person publishes** | `publish-package` | package and checklist in the creative | person publishes and says so |
| 6 | Measure | analyst | `metrics-sqlite` | `data/` | not applicable |
| 7 | Report | analyst | `html-report` | `reports/report-YYYY-MM-DD.html` | person approves the report's task |

What is never skipped: no approved brief, no calendar; no `approved` piece, no creative; no
`fact-check`, no copy; no `published` unless the person publishes. A missing fact blocks the piece, not
the period. A new period goes back to step 1 with what was learned in the report.

## Never

- Write `approved` without seeing the task in `done`, or invent a task id.
- Overwrite a creative, report or note the person has already seen: create `_v2`.
- Save deliverables outside the business folder.
- Ask the person for a disk path or to open a file from disk: point them to the Archivos tab or the task's delivery.

## Why

An approval that exists only in the chat gets forgotten, and an invented one gets published. With the task as the sign-off,
the person decides in one place and the files tell what really happened.
