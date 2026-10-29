---
name: metrics-sqlite
description: Imports CSV exports of ads or posts from marketing/<business>/data/ into metrics.db (SQLite) and computes cost per result, CTR and totals from sums. Use it when CSVs repeat every week, when asked "which piece performed best", or when queryable figures are needed for the report.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Metrics in SQLite

Helper files: `${CLAUDE_PLUGIN_ROOT}/skills/metrics-sqlite/schema.sql` and `example-export.csv`.

## Procedure

0. **Scratch pattern.** sqlite3 needs a real disk, so work in `$TMPDIR/backoffice-work/<task>/`: `backoffice_file_read` the CSV from `marketing/<business>/data/` and write it into scratch (plus the existing `metrics.db` if there is one: read it with `content_base64`). When finished, persist with `backoffice_file_write` (the report as text; optionally `data/metrics.db` with `content_base64`, up to 50 MB) and deliver with `backoffice_task_deliver` (`files`). The commands below run inside that scratch folder.
1. Check that the CSV is in the business's `data/` (`backoffice_file_list`); read its header and confirm with the person which column is which (impressions, clicks, results, spend) and the currency.
2. Create the database if it is missing: `sqlite3 data/metrics.db < ${CLAUDE_PLUGIN_ROOT}/skills/metrics-sqlite/schema.sql`.
3. Import into a temporary table and map (re-importing a day replaces the row):

```bash
sqlite3 data/metrics.db <<'SQL'
.mode csv
.import data/export.csv import_tmp
INSERT OR REPLACE INTO daily_metrics (piece_id, date, channel, impressions, clicks, results, spend, currency, source_file)
SELECT ad_name, date, 'meta', impressions, clicks, results, spend, 'MXN', 'export.csv' FROM import_tmp;
DROP TABLE import_tmp;
SQL
```

4. Query with rates from totals, never averages of rates:

```sql
SELECT piece_id, SUM(spend) AS spend, SUM(results) AS results,
  ROUND(SUM(spend)/NULLIF(SUM(results),0),2) AS cost_per_result,
  ROUND(100.0*SUM(clicks)/NULLIF(SUM(impressions),0),2) AS ctr
FROM daily_metrics WHERE currency='MXN' GROUP BY piece_id
ORDER BY cost_per_result IS NULL, cost_per_result;
```

5. Check freshness: `SELECT MAX(date) FROM daily_metrics;`. If the newest data point is more than 2 days old, say so before recommending anything.
6. Verify the import: compare the CSV's row count against the database's rows and report differences.
7. Cite the query next to every number you use.

## Exact output format

```markdown
Imported: <file> · N rows · dates YYYY-MM-DD to YYYY-MM-DD · currency MXN
Latest data: <date> (<fresh | N days behind>)
| piece | spend | results | cost per result | CTR |
Query: <SQL or script path>
```

Example (sample data, example-export.csv):

```markdown
Imported: example-export.csv · 4 rows · 2026-10-14 to 2026-10-15 · MXN
| P01 | $200.60 | 9 | $22.29 | 2.00 % |
```

## Never

- Average daily rates; always `SUM` over `SUM`.
- Divide without `NULLIF`: a zero divisor is "no data", not 0.
- Mix MXN with USD in one query.
- "Fill in" a day with no rows: it may be a day with no delivery; confirm it.

## Why

Averaging rates gives numbers that do not match real spend, and two different sources give two different reports. One database and sums give a single truth.
