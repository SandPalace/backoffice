---
name: market-research
description: Overview of competitors, formats, hooks and trends in a business's niche, with a source and date on every data point, saved in research/. Use it before planning a period or when asked "what is the competition doing" or "what's working on TikTok/IG for this niche".
allowed-tools: WebSearch, WebFetch, mcp__plugin_backoffice_backoffice
---

# Market research

## Procedure

1. Read `marketing/<business>/brief.md` (niche, city, audience) and `facts.md` with `backoffice_file_read`. Without them, ask the person for the niche and city.
2. Competitors (3-5): web search by niche and city. For each one: name, URL or account, what it posts, approximate frequency, visible offer, source and date looked up.
3. Formats and hooks (5 or more): which kinds of piece have the most visible engagement. Note the pattern in one line and the example's link. Pattern, never copied text.
4. Trends: only with a date; one older than 6 months is marked `old`. Sources that need no account: Google Trends (`trends.google.com`) and the Meta Ad Library (`facebook.com/ads/library`). If the page does not load with WebFetch, say so in the note and ask the person for a screenshot.
5. Gaps: what nobody in the niche is doing well.
6. Three opportunities, each with the evidence (a row of the note) that backs it.
7. Save with `backoffice_file_write` to `marketing/<business>/research/YYYY-MM-DD-<topic>.md`. If it already exists, create another with a different topic or the suffix `-v2`; do not overwrite.
8. Nothing researched goes into `facts.md` (those are facts about the business, not about the market).

## Exact output format

```markdown
# Research · <business> · <15 Oct 2026>
## Competitors
| name | where | what it posts | visible offer | source (date) |
## Formats and hooks observed
- **<pattern>**: example <url> (date)
## Trends
| trend | date | currency (current/old) | source |
## Gaps
## 3 opportunities
1. <opportunity>: evidence <row or url>
```

Example (sample data; the note's content is written in the person's language):

```markdown
| Academia Ejemplo | instagram.com/ejemplo | carruseles 2 por semana | clase de prueba | instagram.com/ejemplo (15 oct 2026) |
- **Antes y después de un proyecto**: ejemplo instagram.com/p/xxxx (15 oct 2026)
```

## Never

- Give follower or view counts you did not see; write "no data".
- Copy the competition's text; only the pattern.
- Present an opinion as fact: mark it **(opinion)**.
- Omit the date looked up.

## Why

A trend without a date or a competitor without a source leads to copying what has already stopped working and deciding on rumors.
