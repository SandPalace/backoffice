---
name: onboarding
description: Interviews the business owner in short rounds and fills facts.md and brief.md on the spot - what they sell, offer, prices, audience, channels, brand, goals, measurement and period. Use it with a new business, when workspace-audit finds gaps, or with "make me the brief", "let's start", "let me tell you about my business".
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Onboarding

The person is the only source of data about their business. Ask well, write down what they say, and let
them watch the files fill in as they answer.

## Procedure

1. Run `workspace-audit` (or read its result). If the person uploaded their own files in the web "Archivos" tab (PDF, Word, CSV), run
   `read-documents` first; if they have files, tell them to upload them there (never ask for a disk path). **Ask only what is missing.**
2. New business: create `marketing/<business>/` (lowercase with hyphens) with `backoffice_file_write`: `facts.md`, `brief.md`,
   `calendar.csv` (header only: `id,date,weekday,platform,format,topic,status,question,approved_by`)
   and the folders `research/ creatives/ reports/ data/ documents/` (virtual folders exist once a file is written in them: write a short `README.md` or `index.md` placeholder in each).
3. **Round 0 (if there are documents):** confirm in bulk, in a table, what came out as `inferred`:
   "Is it still current? Tell me which one changed." What they confirm becomes `confirmed`.
4. **Rounds of at most 4 questions**, concrete and with an example answer ("who decides the purchase,
   the parents or the student? What ages?"):

| Round | Ask about | Rows of facts.md |
|---|---|---|
| 1 The business | what it sells, to whom and what holds them back from buying, where, when it is open | business, audience, location, schedule |
| 2 The offer | what is sold this period, prices, what makes it different, constraints | offer, prices, differentiator, constraints |
| 3 Channels and brand | social networks, where the customer lands, colors, tone, what is never said | channels, brand |
| 4 The period | start and end dates, key dates, goals 1 to 3, what counts as a result and how much it is worth | period, goal, measurement |

5. **After each round**, before moving on: write the answers into `facts.md` and tell them in one line what
   was saved ("Done: 4 facts confirmed in facts.md, folder marketing/mi-negocio, visible in the Archivos tab").
6. When the rounds are over, fill `brief.md` with the sections: business, audience, offer, voice, goals,
   measurement, period, constraints and "what still blocks pieces". **Every claim points back to its row in
   `facts.md`** (in parentheses: `(prices)`); it does not rewrite it. What is `inferred` or `missing` is marked and
   listed as a blocker. If the person already edited the brief, keep their changes.
7. Compute weekdays with `date`, never from memory.
8. Deliver: task "Brief for <business>", `backoffice_task_deliver` with `files` (`brief.md` and `facts.md`), move to `review`
   and explain: "In the Back Office web app, tasks tab, open the brief's task, read it and approve it. That is your
   signature. After that I research your competition and build the calendar."

## facts.md format

```markdown
| fact | value | status | source |
|---|---|---|---|
| audience | papás de niños de 8 a 15 años (example) | confirmed | owner, onboarding 8 Oct 2026 |
| schedule | sábados 9:00-14:00 (example) | inferred | "I think that's it", owner, 8 Oct 2026 |
| prices | - | missing | ask the owner |
```

`confirmed`: they said it with certainty or it was read from a document of theirs. `inferred`: they said it with
doubt or an agent deduced it; it is never usable for copy. `missing`: not known. **Write their words**: "like 900
pesos" is the value, and the status is `inferred`. Values are kept in the person's language.

## Period close

New period for the same business: read the last report, check that prices and schedules are still current and
write the new brief as `brief_v2.md` with "What we learned".

## Never

- Write a "plausible" value to fill a gap.
- Move on to the next round without having written down the previous one.
- Mark the brief approved: the person approves it in the task.

## Why

An agent invented a plausible age range (7 to 17 years) and it got published; the real one was 8 to 15. A value
that sounds good is more dangerous than a gap: nobody questions it.
