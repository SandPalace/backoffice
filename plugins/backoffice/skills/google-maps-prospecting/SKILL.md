---
name: google-maps-prospecting
description: Finds local businesses on Google Maps (name, category, rating, phone, address, website, hours) for a query like "cafeterías en Monterrey", saves them as a CSV in Archivos (ventas/prospeccion/) and, if the person agrees, loads them as leads in the Leads Kanban. Use it when the person asks "búscame / consígueme negocios de X en Y", a list of prospects or a directory of businesses. Needs the sales-team Playwright browser.
allowed-tools: mcp__plugin_backoffice_backoffice, mcp__plugin_backoffice_playwright__browser_navigate, mcp__plugin_backoffice_playwright__browser_evaluate, mcp__plugin_backoffice_playwright__browser_wait_for, mcp__plugin_backoffice_playwright__browser_snapshot, mcp__plugin_backoffice_playwright__browser_click
---

# Google Maps prospecting

Adapted from the owner's google-maps-scraper skill. Stages and lead format: `../pipeline-stages.md`.
One business or one fact ("what is the phone of X?") is NOT this skill: look it up directly. This is for multi-result lists.

## Privacy and good use

- Only **public business data** shown on Maps (name, category, phone, address, website, hours). No personal profiles, no reviewer names, no private data.
- Respect Google's terms: modest volumes (default **30**, max about **100**), human pace, one search at a time, no loops or repeated runs. Say so if asked for more.
- The list is raw material: contacting these businesses is a draft the person reviews and sends (`prepared-replies` / `follow-up-sequence`).

## Procedure

1. **Confirm in ONE short question** (skip it if the message already has query and count): search query («dentistas en monterrey»), how many (default 30, max ~100) and locale (`es-419` for Spanish queries, `en` otherwise).
2. `backoffice_task_create` «Prospección: <query>», then `backoffice_checkin` working.
3. **Navigate:** `browser_navigate` to `https://www.google.com/maps/search/<URL-encoded query>/?hl=<locale>`, then `browser_wait_for` 3 seconds.
4. **Consent banner:** if the next step returns `{error: 'feed not found ...'}`, `browser_snapshot`, click the consent button («Aceptar todo» / «Accept all») with `browser_click`, wait, retry once. Still no feed: stop, task `blocked`, tell the person.
5. **Scroll:** `browser_evaluate` with the function in `scripts/scroll_results.js`, replacing the default `target = 30` with the requested count. It scrolls `[role="feed"]` until enough cards load or the list ends. If fewer exist than requested, deliver what there is and say so.
6. **Extract in batches of 7** (never all at once: it times out). Read `scripts/extract_batch.js`, replace `__START__`/`__END__` with `0`/`7`, `7`/`14`, ... and pass it to `browser_evaluate`. Collect every returned array in one list (keep `idx` order).
7. **Dedupe** by `mapsUrl` (or exact `name`): Maps reshuffles results between scrolls. Cut to the requested count.
8. **Build the CSV.** Columns: `nombre, categoria, rating, num_reviews, telefono, direccion, sitio_web, website_host, horarios, plus_code, google_maps_url`.
   - With Node (macOS and Windows): write the JSON list to a temp file and run `node scripts/build-csv.mjs <records.json>`; it prints the CSV (BOM, CRLF, RFC 4180 quoting, hours normalized, deduped). `scripts/normalize-hours.mjs` is its helper.
   - If Node/Bash is not available to you, do the same in context: dedupe, normalize hours (`jueves: 9 a.m.–1 p.m.3–7:30 p.m.` -> `jue: 9am-1pm y 3-7:30pm`, days Mon->Sun), quote any field containing comma, quote or newline (double the quotes), header first, and start the content with the UTF-8 BOM character `﻿` so Excel on Windows shows accents correctly.
9. **Save** with `backoffice_file_write` at `ventas/prospeccion/<slug-of-query>.csv` (slug: lowercase, no accents, hyphens; e.g. `cafeterias-en-monterrey.csv`). Keep the BOM.
10. **Deliver:** `backoffice_task_deliver` with that file, `backoffice_task_update` to `review` (never `done`), `backoffice_checkin` idle.
11. **Ask the person** (in Spanish, one question): «¿Cargo estos negocios como Leads? Todos, los N mejor calificados, o solo los que tienen teléfono.» Do nothing until they answer.
12. **On yes**, for each chosen business: `backoffice_lead_list` with `query` = name; if already there, skip it and count it. Otherwise `backoffice_lead_create` with `name`, `stage: new`, `source: other`, `interest` = category, `contact` = phone (plus website if any), `notes` = address · hours · maps link · rating (reviews), `files: ventas/prospeccion/`. Omit empty fields. No `score` (not qualified yet), no `value`.
13. Report: how many found, how many loaded, how many skipped as already present, anything notable (top rated, no phone). No rows in chat; say «Archivos -> ventas/prospeccion/» and «pestaña Leads».

## Output (Spanish)

«Listo: 28 negocios en Archivos -> ventas/prospeccion/cafeterias-en-monterrey.csv (tarea en revisión). ¿Los cargo como Leads?» Then after loading: «Cargué 20 en la pestaña Leads; 3 ya existían.»

## Edge cases

- Page opens a `/place/` URL after a click: fine, cards stay in the DOM. If the page reloads, re-navigate and re-scroll.
- If `browser_evaluate` fails with «Execution context was destroyed» (Maps did a full navigation after a click; seen in a real run), re-navigate to the search URL, re-run the scroll and resume from the batch that failed, with smaller batches (3-4). Dedupe makes resuming safe.
- Missing hours, phone, website, rating: leave empty. Never fabricate and never put the Maps URL in `sitio_web`.
- Selectors are obfuscated hashes and can change: if zero cards or empty fields, see `references/selectors.md` and report instead of guessing.
- Non-Latin scripts work: extraction keys off `data-item-id` prefixes. Set `hl=` accordingly.

## Never

- Scrape personal profiles or reviewer data, exceed ~100 results or loop searches.
- Invent or complete missing fields, or load Leads without the person's yes.
- Contact a business, set `won`, or mark the task `done`.

## Why

A clean, deduped CSV plus an explicit yes before touching the Kanban keeps the list useful, the Leads board uncluttered and the volume modest enough to respect Google's terms.
