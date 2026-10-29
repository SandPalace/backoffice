---
name: financial-ratios
description: Computes an SMB's financial ratios from its statements - liquidity (razón circulante, prueba ácida), leverage (deuda/capital), profitability (márgenes bruto, operativo y neto, ROE, ROA) and efficiency (días de cobro, días de pago, rotación de inventario) - each with formula, value, a plain-Spanish reading and a traffic light against thresholds the person can override. Use it when the person asks "¿cómo está mi negocio?", "¿es sano?", for "razones financieras" or "indicadores", or before talking to a bank or investor.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Financial ratios

Shared rules (notice, `[NO DATA: ...]`, money format, files): `../finance-mx-basics.md`.

## Procedure

1. Get `statements.json` from a `financial-statements` deliverable (`backoffice_file_list` with prefix `finance/`,
   then `backoffice_file_read`). If it does not exist, run `financial-statements` first; ratios without statements
   that close are not computed.
2. Confirm the number of days in the period (30 for a month, 365 for a year, the real count for year to date)
   and whether the person has their own thresholds (their bank's, their industry's). Defaults are generic
   references and are labeled as such.
3. Copy `scripts/ratios.py` from this skill's folder to `$TMPDIR/backoffice-work/<task>/` and run
   `python3 ratios.py statements.json <days> [thresholds.json]`. It writes `ratios.csv`.
4. For each ratio write one plain-Spanish line: what it means for this business ("por cada peso que debes a
   corto plazo tienes $4.05 para pagarlo"). Red or yellow lights get a likely cause and one question.
5. Compare with a previous period if there is one (run the script on both and show the change).
6. Do not compute what has no data (no inventory = no inventory days); the script prints `[NO DATA: ...]`.
7. Save `ratios.md`, `ratios.csv` and `ratios.py` with `backoffice_file_write` in
   `finance/<YYYY-MM-DD>-financial-ratios/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Razones financieras — <periodo> (MXN)

**En una línea:** <la salud del negocio en palabras simples>

| Grupo | Razón | Fórmula | Valor | Semáforo | Qué significa |
| ----- | ----- | ------- | ----: | -------- | ------------- |

## Focos rojos y amarillos (causa probable y pregunta)

## Umbrales usados (genéricos o los tuyos)

## Datos que faltan

> Indicativo; valídalo con tu contador.
```

Example (fictional): razón circulante 4.05x (verde); margen neto 10.5% (verde); días de cobro 21.6 (verde).

## Never

- Compute ratios from statements whose checks failed, or mix periods (annual sales with monthly balances).
- Present the default thresholds as a standard for every industry.
- Annualize ROE/ROA silently; say if a figure is for the period.
- Calculate by hand.

## Why

A ratio is only useful when the owner understands what it says about their business and what to do about it;
the traffic light points to where to look first.
