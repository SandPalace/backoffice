# Boards ideas · dev-team

Artifacts this team can publish to the Boards with `backoffice_artifact_publish`. Titles are Spanish patterns
(`<proyecto>`, `<página>`, `<fecha>` are placeholders filled with real values). Templates come from the core skill
`backoffice:canvas-artifacts`. Scope: `team` for the Team board, `agent` for each agent's own board, `workspace`
only when the person asked for a project-level view. The code itself is delivered by `path`; the Boards shows what
the person must look at and decide. Screenshots come from `visual-verification`, never mock-ups.

## Team board (scope `team`)

| Artifact (Spanish title pattern)          | Template         | Built from (which skill/output/data)                                                              | What the owner validates                               | When to publish           |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| Brief y plan del sitio · <proyecto>       | `document.md`    | Tech lead's 6-line brief + task split per agent                                                   | Business, audience, goal, sections and missing content | Before any design or code |
| Avance del proyecto · <proyecto>          | `timeline.html`  | Design workflow order (brief → direction → components → build → animate → verify) and task states | What is done and what comes next                       | At each stage change      |
| Capturas del sitio · <proyecto> · <fecha> | `gallery.html`   | `visual-verification` screenshots at 375/768/1280, light and dark                                 | How the site looks on phone and desktop                | After each build round    |
| Reporte de QA · <proyecto>                | `report.html`    | `qa-report.md` (verdict, findings by severity, what was not verified)                             | The verdict and which findings can wait                | After each QA pass        |
| Lista de lanzamiento · <proyecto>         | `checklist.html` | `launch-checklist` + `deploy-vercel` steps (domain, keys, content the person owes)                | Their pending items before publishing                  | Before delivery           |

## tech-lead

| Artifact (Spanish title pattern)      | Template         | Built from (which skill/output/data)                                                           | What the owner validates  | When to publish                   |
| ------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------- |
| Brief del sitio · <proyecto>          | `document.md`    | 6-line brief (business, audience, goal, sections, content, constraints)                        | Gaps and the page's goal  | When the brief is written         |
| Cómo construir la tienda · <proyecto> | `options.html`   | `shopify-choose-approach` (Liquid theme, headless, Next.js + Storefront, own Next.js + Stripe) | The approach they approve | Before building any store         |
| Plan de trabajo · <proyecto>          | `timeline.html`  | Task split with owners and order (design and API contract first)                               | Order and scope           | After the brief is confirmed      |
| Pendientes de tu lado · <proyecto>    | `checklist.html` | `launch-checklist` person items: domain, content, photos, Stripe keys, `[NO DATA]`             | Each item they owe        | Before delivery                   |
| Pasos para publicar · <proyecto>      | `document.md`    | `deploy-vercel` written steps and commands the person runs                                     | That they can follow them | When the site is ready to publish |

## frontend-designer

| Artifact (Spanish title pattern)    | Template       | Built from (which skill/output/data)                                            | What the owner validates                    | When to publish                  |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| Direcciones visuales · <proyecto>   | `options.html` | `art-direction` (2-3 candidates from different families, pick/reject reasons)   | The direction to follow                     | Before tokens                    |
| Dirección visual · <proyecto>       | `document.md`  | `docs/visual-direction.md` (criteria, what to avoid)                            | Criteria and feeling                        | When the direction is chosen     |
| Paleta y tipografía · <proyecto>    | `table.html`   | `docs/tokens.css` light/dark with measured contrast ratios                      | Colors and fonts                            | With the tokens                  |
| Referencias de diseño · <proyecto>  | `gallery.html` | `design-references` → `docs/design-inputs.md` (references, brand assets, Figma) | That the references are the ones they meant | At the start of design           |
| Desviaciones de diseño · <proyecto> | `table.html`   | `design-critique` + screenshots (selector, current value, correct value)        | Which deviations to fix                     | After reviewing the built layout |

## frontend-engineer

| Artifact (Spanish title pattern)  | Template         | Built from (which skill/output/data)                               | What the owner validates          | When to publish                 |
| --------------------------------- | ---------------- | ------------------------------------------------------------------ | --------------------------------- | ------------------------------- |
| Vista previa · <página> · <fecha> | `gallery.html`   | `visual-verification` screenshots at 375/768/1280, dark mode       | The page as built                 | After each section or fix round |
| Antes y después · <página>        | `gallery.html`   | Before/after screenshots of a QA fix                               | That the fix solved what they saw | After fixing findings           |
| Contenido pendiente · <proyecto>  | `checklist.html` | `[NO DATA: ...]` items in `SITE-README.md` (texts, prices, photos) | Provides the real content         | When placeholders remain        |
| Guía del sitio · <proyecto>       | `document.md`    | `SITE-README.md` (how to run it, structure, pending items)         | That they understand what exists  | At delivery                     |

## backend-engineer

| Artifact (Spanish title pattern)             | Template         | Built from (which skill/output/data)                                             | What the owner validates                | When to publish                 |
| -------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| Contrato de la API · <proyecto>              | `document.md`    | `docs/API.md` (routes, payloads, errors) from `api-and-database`                 | That it covers what the site must store | Before implementation           |
| Datos que guarda el sitio · <proyecto>       | `table.html`     | Drizzle schema (tables, fields, what each stores)                                | Fields they need or do not want stored  | When the schema is drafted      |
| Pruebas de pago (modo prueba) · <proyecto>   | `checklist.html` | `stripe-payments` checks: completed, cancelled, forged signature, tampered price | That payments behave as expected        | After the payment flow is built |
| Variables de entorno necesarias · <proyecto> | `checklist.html` | List of variable names (never values) the person must set                        | That they can provide each one          | Before deploy                   |

## shopify-developer

| Artifact (Spanish title pattern)                 | Template         | Built from (which skill/output/data)                                                                | What the owner validates          | When to publish                     |
| ------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------- |
| Configuración de la tienda · <tienda>            | `checklist.html` | `shopify-store-setup` → `store/setup-steps.md` (payments, taxes/IVA, shipping MX, policies, domain) | Each step they will click         | During setup                        |
| Catálogo a importar · <tienda>                   | `table.html`     | `store/products.csv` (products, variants, prices from the person)                                   | Products and prices before import | Before the CSV import               |
| Vista previa del tema · <tienda>                 | `gallery.html`   | Unpublished theme preview screenshots at 375/768/1280                                               | The theme before they publish it  | After `shopify theme check` passes  |
| Cambios por aplicar (dry-run) · <automatización> | `report.html`    | `shopify-admin-api-automation` dry-run diff and audit log                                           | Approve that specific run         | Before any mutation on a real store |
| Reporte semanal de la tienda · <semana>          | `dashboard.html` | `shopify-store-operations` weekly report (orders, low stock, abandoned checkouts)                   | The read and the actions          | Weekly                              |

## web-qa

| Artifact (Spanish title pattern)       | Template       | Built from (which skill/output/data)                                           | What the owner validates                   | When to publish          |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------ |
| Reporte de QA · <proyecto> · ronda <n> | `report.html`  | `qa-report.md` (verdict APPROVED / CHANGES REQUIRED, findings, not verified)   | The verdict                                | After each QA pass       |
| Hallazgos por severidad · <proyecto>   | `table.html`   | Findings table (severity, file:line, verification command)                     | Which medium/low findings can wait         | With the report          |
| Capturas de revisión · <proyecto>      | `gallery.html` | `visual-verification` screenshots cited in the report                          | What the findings look like                | With the report          |
| Casos extremos · <proyecto>            | `table.html`   | `break-ui` (long names, 0/99 items, sold out, 200% zoom) with the fix for each | Which edge cases matter for their business | When the site shows data |

## Rules

- Publish only real data: screenshots of the real running site, measured scores and real content; gaps are
  `[NO DATA: ...]`. Never quote a score that was not run or show a mock-up as the site.
- One card per deliverable. A change is a new version of the same artifact (`artifact_id`), never a new card.
- Request review with one concrete question in the note (e.g. «¿Seguimos con la dirección B, editorial cálida?»).
- Approving a card does not publish the site, push a theme or run a mutation; the person executes. No secrets on any card.
- Read `backoffice:canvas-artifacts` for the procedure, templates and scopes before publishing.
