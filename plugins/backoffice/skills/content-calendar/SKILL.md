---
name: content-calendar
description: Builds or updates the business's calendar.csv with 2 to 4 weeks of pieces (date, weekday, platform, format, topic, status, question). Validates the day of the week with date and marks as blocked any piece whose fact is not confirmed in facts.md. Use it when asked for a "calendar", "content plan", "what do we post" or "build the month".
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Content calendar

Working folder (virtual workspace files): `marketing/<business>/`. Read with `backoffice_file_read`, write the whole CSV with `backoffice_file_write`; the weekday check with `date` is the only shell step.

## Procedure

1. Read `brief.md` and `facts.md`. No brief, no calendar: ask the person for it. Read `research/` if it exists; if not, suggest `market-research`.
2. Ask about the pace (slow: 3-5 posts per week; fast: 1-2 clips per day) and note it in `brief.md` if it is missing.
3. Take the brief's goals in order (#1, #2, #3): each piece serves one and its `topic` says which.
4. Compute the weekday with `date`, never from memory: macOS `date -j -f "%Y-%m-%d" 2026-10-14 "+%A"`; Linux `date -d 2026-10-14 +%A`.
5. Mix at least two format families (static/carousel and video). Do not assume the most produced content performs best: it is measured by cost per result.
6. Every fact a piece uses (price, schedule, offer, date) is looked up in `facts.md`. If it is `inferred`, `missing` or does not exist, the piece comes out `blocked` and `question` holds the exact question for the person.
7. Write `marketing/<business>/calendar.csv` (`backoffice_file_write`, `overwrite` true only when you only changed `proposed`/`blocked` rows) with consecutive ids `P01`, `P02`... If it already exists, add or edit only `proposed` or `blocked` rows; do not touch `approved`, `published` or `rejected`; flag it if any of them needs a change.
8. A `blocked` piece becomes `proposed` once its fact is `confirmed` in `facts.md`; empty `question`.
9. Statuses you may write: `proposed` and `blocked`. `approved` only when `backoffice_task_list` shows that piece's task in `done`; then record who approved in `approved_by` with the name of the person who approved the task. Never mark it yourself on your own.
10. Report: "N pieces proposed, M blocked" and list the questions.

## Exact output format

`calendar.csv`, fixed header, quotes if there are commas:

`id,date,weekday,platform,format,topic,status,question,approved_by`

Allowed `status` values: `proposed|blocked|approved|published|rejected`.

Example (sample data; the deliverable content is written in the person's language):

```csv
id,date,weekday,platform,format,topic,status,question,approved_by
P01,2026-10-14,miércoles,Instagram,carrusel 4:5 (5 láminas),"Objetivo #1: qué construye tu hijo este mes",proposed,,
P02,2026-10-16,viernes,TikTok,reel 9:16 (20 s),"Objetivo #2: clase de prueba",blocked,"¿Cuál es el horario de la clase de prueba?",
```

## Never

- Write `approved` or `approved_by` without a `done` task seen with `backoffice_task_list`.
- Use a price, schedule or date that is not `confirmed` in `facts.md`.
- Overwrite or delete rows that are already approved, published or rejected.
- Compute the day of the week from memory.

## Why

A calendar with an invented price gets published and paid for. Blocking only the affected piece lets the rest move forward and tells the person exactly what is missing.
