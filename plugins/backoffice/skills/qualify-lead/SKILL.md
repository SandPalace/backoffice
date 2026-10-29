---
name: qualify-lead
description: Scores a prospect from 0 to 100 using the business's own rubric in ventas/criterios-de-calificacion.md, marking each data point confirmed or [NO DATA], and updates the prospect's lead in the Leads Kanban. Use it when a lead needs profiling or when new information arrives about an existing one.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Qualify lead

Stages and lead format: `../pipeline-stages.md`.

## Procedure

1. Read `ventas/criterios-de-calificacion.md` (+ `cliente-ideal.md`, `oferta.md`). Missing = stop and hand back to `sales-setup`.
2. Find the lead: `backoffice_lead_list` (`query` name/contact) and read `ventas/prospectos/<slug>/ficha.md` if it exists. None = it comes from `prepared-replies`; create it there or here with `backoffice_lead_create`.
3. Only what the prospect said is a source. For each rubric criterion record data, status (`confirmed` with quote, or `[NO DATA: ...]`) and points up to its weight. An assumption never earns full points.
4. Total /100 and label (caliente/tibio/frio per the thresholds in the rubric). Say in one line why.
5. Pick the missing data that would move the score most; propose ONE next question from the rubric's discovery list, as a draft in the business voice.
6. Update `ficha.md` (`backoffice_file_write`) and the lead with `backoffice_lead_update`: `score`, `notes`, `next_contact_at`, `stage` = `qualified` if tibio or caliente (else keep `contacted`/`new`). Never `won`; recommending `lost` needs the person's OK and a reason in `notes`.
7. Use only personal data needed to qualify.

## Output format (ficha.md score section, Spanish)

```markdown
## Calificación — <15 oct 2026>
| criterio | peso | dato | estado | cita | pts |
|---|---|---|---|---|---|
TOTAL: X/100 — caliente | tibio | frío · Por qué: ...
Falta: ...
Siguiente pregunta (borrador): "..."
Pendiente para la persona: ...
```

## Never

- Mark `confirmed` something the prospect did not say, or fill budget/authority by intuition.
- Discard a prospect: you recommend, the person decides.
- Quote prices not in `ventas/oferta.md`.

## Why

A high score built on assumptions sends the person after the wrong prospect and makes them ignore the good one.
