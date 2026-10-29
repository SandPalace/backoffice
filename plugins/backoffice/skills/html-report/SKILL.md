---
name: html-report
description: Produces a single-file, dependency-free HTML report saved to marketing/<business>/reports/ (period plan, results or research), with every figure citing its source and pieces sorted by cost per result. Use it when asked for a "report", "visual summary", "dashboard" or "something I can send to the client".
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# HTML report

Bundled template: `${CLAUDE_PLUGIN_ROOT}/skills/html-report/template.html`.

## Procedure

1. Decide the type: `plan` (calendar and goals), `results` (metrics) or `research`.
2. Gather sources with `backoffice_file_list` / `backoffice_file_read`: `brief.md`, `facts.md`, `calendar.csv`, `research/`, CSVs in `data/` or `data/metrics.db` (`metrics-sqlite`), all under `marketing/<business>/`. Note which file each number comes from.
3. Work in a scratch folder (`$TMPDIR/backoffice-work/<task>/`): copy the template there as `report-YYYY-MM-DD.html` (the final name is `marketing/<business>/reports/report-YYYY-MM-DD.html`; if it exists, use `report-YYYY-MM-DD_v2.html`) and fill in its sections. Put the brand hexes from the brief into `--brand` and `--accent`. The template's labels are placeholders: write the report's content in the person's language and set `<html lang>` to match.
4. Every figure carries a `<small class="source">` with the file (and the query if it is SQL). No data: the words "no data" (in the report's language), never 0 or an estimate.
5. Rates (CTR, cost per result) are computed from totals: sum of spend divided by sum of results.
6. At the top, the conclusion in one sentence and 3 key figures; below, the detail. Sort pieces by cost per result ascending, never by CTR.
7. Charts in SVG or CSS bars; no external libraries or internet.
8. Check the scratch file at phone width (no horizontal scroll) and in dark mode with a headless render if available; never ask the person to open it from disk.
9. Persist it with `backoffice_file_write` to `marketing/<business>/reports/report-YYYY-MM-DD.html`, deliver with `backoffice_task_deliver` (`files`) and move the task to `review`; sending to the client is the person's decision.

## Exact output format

One `.html` with: title and period; `<p class="conclusion">`; three `.kpi` with source; a table of pieces sorted by cost per result; recommendations with their figure; a footer "no data means it was not measured". When done, reply with where to find it in the web (Archivos tab, `reports` folder, or the task's delivery), the conclusion and a "figure: source" list.

Example (sample data):

```html
<div class="kpi"><div class="label">Cost per result</div>
<div class="value">$22.29</div>
<small class="source">Source: data/metrics.db; SUM(spend)/SUM(results), P01</small></div>
```

## Never

- Invent a figure to make the chart "look complete".
- Average daily rates.
- Sort by CTR.
- Send the report to the client.
- Ask the person for a disk path or to open a file from disk.

## Why

A figure without a source cannot be defended, and CTR rewards curiosity, not the business. Cost per result is what the person pays for what they are after.
