# Canvas ideas · marketing-team

Artifacts this team can publish to the Canvas with `backoffice_artifact_publish`. Titles are Spanish patterns
(`<negocio>`, `<periodo>`, `Pxx` are placeholders filled with real values). Templates come from the core skill
`backoffice:canvas-artifacts`. Scope: `team` for the Team board, `agent` for each agent's own board, `workspace`
only when the person asked for a project-level view.

## Team board (scope `team`)

| Artifact (Spanish title pattern)                      | Template         | Built from (which skill/output/data)                                                             | What the owner validates                                          | When to publish                                                  |
| ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Estado del ciclo de marketing · <negocio>             | `checklist.html` | `workspace-audit` (what exists, what is missing, step of the 7-step cycle in `workspace-guide`)  | That the current step and the single next step are right          | At the start of a period or when the person asks "¿dónde vamos?" |
| Plan del periodo · <negocio> · <periodo>              | `timeline.html`  | `brief.md` + `calendar.csv` (`content-calendar`) + research note                                 | Dates, platforms and the order of pieces before production starts | When the calendar is built or changes                            |
| Piezas bloqueadas por datos · <negocio>               | `table.html`     | Rows of `calendar.csv` with status `blocked` + the pending question from `fact-check`            | Answers the missing facts (price, date, address)                  | Whenever a piece is blocked                                      |
| Lote de creativos de la semana · <negocio> · <semana> | `gallery.html`   | `creatives/Pxx_vN.md` of the batch (copy, hooks, prompts, renders/contact sheets)                | Which pieces go to publishing and which need changes              | When the creative delivers a batch                               |
| Resultados del periodo · <negocio> · <periodo>        | `dashboard.html` | `reports/report-YYYY-MM-DD.html` figures (spend, results, cost per result) from `metrics-sqlite` | The read of the numbers and which pieces to scale or archive      | After the analyst's period report                                |

## cmo

| Artifact (Spanish title pattern)                     | Template         | Built from (which skill/output/data)                                                      | What the owner validates                                                        | When to publish                              |
| ---------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| Brief de <negocio>                                   | `document.md`    | `onboarding` → `brief.md` + confirmed facts in `facts.md`                                 | Offer, audience, channels, goals and period                                     | When the brief is ready for approval         |
| Calendario de contenido · <negocio> · <periodo>      | `timeline.html`  | `content-calendar` → `calendar.csv` (date, weekday, platform, format, topic, status)      | Dates, topics and the blocked pieces                                            | Each new calendar or `_v2`                   |
| Paquete de publicación · Pxx · <plataforma>          | `checklist.html` | `publish-package` (copy, assets, schedule suggestion, publish steps)                      | That the person can publish it as is; nothing was published                     | When an approved creative is ready to go out |
| Borradores de anuncio en Meta (pausados) · <campaña> | `table.html`     | `meta-connector`: PAUSED drafts left in Ads Manager (name, objective, audience, creative) | That the paused drafts match what was approved before the person activates them | After leaving drafts in Meta                 |
| Opciones de enfoque para el periodo · <negocio>      | `options.html`   | Researcher's 3 opportunities + brief goals                                                | Which angle the period follows                                                  | Before building the calendar                 |

## researcher

| Artifact (Spanish title pattern)             | Template       | Built from (which skill/output/data)                                           | What the owner validates                                     | When to publish            |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------- |
| Investigación de mercado · <nicho> · <fecha> | `report.html`  | `market-research` note in `research/market-YYYY-MM-DD.md` (sources with dates) | That the competitors and gaps are relevant to their business | When the note is delivered |
| Competidores observados · <nicho>            | `table.html`   | Competitor table of the note (account, what it posts, frequency, source, date) | Missing or wrong competitors                                 | With the research note     |
| Ganchos y formatos que funcionan · <nicho>   | `gallery.html` | "Hooks and formats observed" section (pattern + example link)                  | Which patterns fit the brand                                 | With the research note     |
| 3 oportunidades para <negocio>               | `options.html` | Closing opportunities of the note, each with its evidence                      | Which opportunity the CMO should plan around                 | With the research note     |

## creative

| Artifact (Spanish title pattern) | Template         | Built from (which skill/output/data)                                                                    | What the owner validates               | When to publish                               |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| Variantes de gancho · Pxx        | `options.html`   | `content-script` (3 hook variants + script)                                                             | Which hook to record or test first     | Before animating or recording                 |
| Copy y guion · Pxx_vN            | `document.md`    | `creatives/Pxx_vN.md` (hook, body, CTA, facts with source from `fact-check`)                            | Text and facts before production       | Each new version of the piece                 |
| Variantes de anuncio · Pxx       | `gallery.html`   | Images or frames generated from `image-prompt` / `video-prompt` (no text in image)                      | Which visual goes with the copy        | When renders or generated images exist        |
| Video final · Pxx · <motor>      | `gallery.html`   | `motion-video` / `tesseract-motion` / `talking-head-edit`: 1080x1920 render, contact sheet, `review.md` | The finished video, audio and frames   | When the render passed frame and audio review |
| Revisión honesta del video · Pxx | `checklist.html` | `review.md` + `sound-design` measured loudness                                                          | Known issues they accept or want fixed | With the final video                          |

## analyst

| Artifact (Spanish title pattern)                      | Template         | Built from (which skill/output/data)                                                | What the owner validates                          | When to publish                 |
| ----------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| Reporte de resultados · <negocio> · <periodo>         | `report.html`    | `html-report` → `reports/report-YYYY-MM-DD.html`                                    | The three-line summary and the recommendation     | When the report is saved        |
| Tablero de métricas · <negocio>                       | `dashboard.html` | `metrics-sqlite` totals (spend, results, cost per result, % watched, saves, shares) | That the figures match their exports              | Weekly, or when new CSVs arrive |
| Ranking de piezas por costo por resultado · <periodo> | `table.html`     | Per-piece table from `metrics.db` (never ranked by CTR)                             | Which pieces to scale, keep or archive            | With each report                |
| Datos que faltan para medir · <negocio>               | `checklist.html` | "What could not be measured" list (missing exports, undefined result)               | Uploads the missing exports or defines the result | When a measure is "no data"     |

## Rules

- Publish only real data: every figure and fact comes from `facts.md`, `calendar.csv`, exports or `metrics.db`; gaps are
  `[NO DATA: ...]`. Never a mock-up with sample numbers.
- One card per deliverable. A change is a new version of the same artifact (`artifact_id`), never a new card.
- Request review with one concrete question in the note (e.g. «¿Aprobamos el gancho B para P03?»).
- Publishing to the Canvas does not replace the task: still `backoffice_task_deliver` and move the task to `review`.
- Read `backoffice:canvas-artifacts` for the procedure, templates and scopes before publishing.
