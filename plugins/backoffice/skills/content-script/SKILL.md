---
name: content-script
description: Writes the script for a short video (reel, TikTok, Short) or the structure of a carousel with hook, engagement zone, blocks, re-hook and a call to action with a keyword, plus 3 hook variants. Use it when asked for a "script", "hook", "CTA" or before the video prompt of an approved piece.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Content script

## Procedure

1. Read the piece in `calendar.csv`: its status must be `approved`, checked with `backoffice_task_list` (task `done`). If not, do not write the final script; leave a draft and say so.
2. Read `marketing/<business>/brief.md` (voice, goal) and `facts.md` with `backoffice_file_read`. Every claim in the script comes from a `confirmed` fact; if not, write `[MISSING: fact]` and ask the person.
3. Write the 8 steps with their timing: hook (0-2 s), engagement zone (2-5 s), block 1 (~8 s), re-hook (1-2 s), block 2 (~8 s), optional block 3 (~8 s), re-hook (1-2 s), call to action (2-3 s).
4. Carousel: slide 1 hook, slide 2 engagement, one slide per block, last slide the call to action.
5. Call to action: only one, with a keyword (for example CLASES) to measure which piece the message came from. Do not promise a resource that is not in `facts.md`.
6. Propose 3 hooks of different types for the same body: pain, contrarian, promise with a number, novelty or ease. They are tested organically and the winner gets ad spend.
7. On-screen text is noted separately to be composed in editing, never inside a generated image or video. No recognizable minors or generated people.
8. Save with `backoffice_file_write` to `marketing/<business>/creatives/Pxx_vN.md`, section `## Script`. If it already exists, create the next version (`_v2`), never overwrite.

## Exact output format

```markdown
# Pxx_vN · Script · <platform, duration>
Facts used: <fact> (facts.md, <source>)
## Script
| # | step | time | voice | on-screen text (composed in editing) |
## Hooks to test
A (type): "..." · B (type): "..." · C (type): "..."
## Call to action
Keyword: ... · Where it lands: ...
```

Example (sample data; the spoken lines and on-screen text are deliverable content, written in the person's language):

```markdown
# P02_v1 · Script · TikTok, 20 s
Facts used: clase de prueba gratis (facts.md, dueña, 12 oct 2026)
## Script
| 1 | hook | 0-2 s | "4 cosas que tu hijo puede construir este mes" | 4 COSAS |
| 8 | CTA | 17-20 s | "Escribe CLASES por WhatsApp" | CLASES |
## Hooks to test
A (promise): "4 cosas..." · B (pain): "Tu hijo no se aburre de la tecnología..." · C (ease): "La forma más fácil de probar programación..."
```

## Never

- Claim anything that is not `confirmed` in `facts.md`.
- Write more than one call to action, or one without a keyword.
- Overwrite a script the person has already seen.

## Why

A short video is lost in the first second or halfway through; the structure prevents that. And without a single measurable action you cannot tell which piece brought customers.
