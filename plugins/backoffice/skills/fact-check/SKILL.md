---
name: fact-check
description: The data gate - reviews a copy, brief, script or prompt, extracts every fact about the business (price, date, schedule, address, age, offer) and blocks the piece if any of them is not confirmed in facts.md. Use it ALWAYS before writing or delivering copy, and when asked "is this right?".
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Fact check

## Procedure

1. **Extract** from the text every verifiable claim: numbers, prices, dates, days, schedules, addresses,
   ages, product names, promotions, guarantees.
2. **Look it up** in `marketing/<business>/facts.md` (`backoffice_file_read`).
3. **Compute** whatever can be computed: every date with a weekday is checked with `date -j -f "%Y-%m-%d" 2026-10-13 "+%A"`
   (macOS) or `date -d 2026-10-13 +%A` (Linux).
4. **Classify:** `ok` if it is `confirmed` and the value matches exactly; `block` if it is `inferred`, `missing`,
   does not appear or the value differs.
5. **Deliver the table and the verdict:**

```markdown
| claim in the copy | facts.md | verdict |
|---|---|---|
| "de 7 a 17 años" | audience: 8 to 15, confirmed | block: the range is 8 to 15 |
| "inscripción gratis" | does not appear | block: ask |
| "lunes 13 de octubre" | date gives Tuesday | block: the 13th is a Tuesday |

VERDICT: BLOCKED - 1 differing fact, 1 unconfirmed, 1 incorrect date.
Question for the person: "¿La inscripción es gratis en octubre? ¿Para todos los cursos?"
```

(Sample data; the copy being checked and the question for the person are in the person's language.)

6. **Block only that piece.** In `marketing/<business>/calendar.csv` (read it with `backoffice_file_read`, rewrite it whole with `backoffice_file_write`): `status` = `blocked` and the exact question in `question`.
   The other pieces keep going. Create or update the piece's task to `blocked` with the question in the
   description (`backoffice_task_update`) and signal it with `backoffice_checkin` status `waiting`.
7. **Unblock** when the person answers: add or fix the row in `facts.md` (`backoffice_file_write`) as `confirmed` with
   the source ("person, chat 15 Oct 2026"), empty `question`, move the piece to `proposed` and the task to
   `review` so they approve it. Never move it to `approved`.
8. **Date audit:** in every piece you touch, `weekday` must match `date` run on `date`; if not,
   fix it and flag it.

## Never

- Fix the fact yourself with a "more likely" value.
- Accept `inferred` because "surely that's how it is".
- Copy a day of the week from another document, not even the client's.
- Block the whole calendar because of one piece.

## Why

A plausible, specific value is the most dangerous. Even an erratum said "Wednesday the 27th" and the 27th
was a Thursday: corrections get verified too.
