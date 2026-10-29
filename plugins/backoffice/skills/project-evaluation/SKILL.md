---
name: project-evaluation
description: Evaluates a project or investment (new equipment, branch, product line, hire, vehicle) with NPV (VPN), IRR (TIR), discounted payback and ROI, an explicit discount-rate rationale, base/optimistic/pessimistic scenarios and a sensitivity table on the 2 riskiest variables, ending in a "recomendación" with decision criteria. Use it when the person asks "¿conviene este proyecto?", "¿me conviene comprar...?", "¿en cuánto tiempo recupero la inversión?" or compares two investments.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Project evaluation

Shared rules (notice, `[NO DATA: ...]`, money format, files): `../finance-mx-basics.md`.

## Procedure

1. Write the decision as a question with a deadline and the alternative ("¿Compramos el horno de $180,000 sin
   IVA antes de diciembre, o seguimos maquilando?").
2. Gather, with source for each (quotes, sales history, the person): investment sin IVA, horizon in years,
   expected units and price, variable cost per unit, extra fixed costs, salvage value. Read uploaded files with
   `backoffice_file_read`. Missing: `[NO DATA: ...]`; an estimate only if the person agrees, labeled `estimate`.
3. **Discount rate with its reason:** the person's cost of financing (loan rate) or the return they require; if
   unknown, propose one and say why (e.g. "tasa del crédito que te ofrecen + 5 puntos por riesgo"). Write it in
   the assumptions table.
4. Define scenarios as multipliers (pessimistic: fewer units, higher cost; optimistic: more units, better
   price) and pick the 2 variables the result depends on most for the sensitivity table.
5. Write `project.json` in `$TMPDIR/backoffice-work/<task>/` (shape in the header of `scripts/project_eval.py`),
   copy the script from this skill's folder there and run `python3 project_eval.py project.json`. If the project
   does not fit the units × margin model (e.g. a savings project), edit `flows()` and state it in the assumptions.
6. Read the result: NPV > 0 at the chosen rate means it creates value; IRR vs the rate; payback vs how long the
   person can wait; which scenario makes NPV negative.
7. If the decision depends on having cash in the coming weeks, say so and hand the inputs to the executive-team
   `cfo` (`cash-flow-forecast`). Taxes (ISR, IVA acreditable, depreciation rules): general note with the notice.
8. Save `project-evaluation.md`, `project.json` and `project_eval.py` with `backoffice_file_write` in
   `finance/<YYYY-MM-DD>-project-evaluation/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Evaluación: <pregunta> (MXN sin IVA)

**Recomendación en una línea** (la decisión es tuya).

## Supuestos

| # | Supuesto | Valor | Dato o estimado | Fuente |

## Tasa de descuento: X% — por qué

## Resultados por escenario

| Escenario | VPN | TIR | Recuperación descontada | ROI |

## Sensibilidad: VPN según <variable 1> y <variable 2>

## Criterios de decisión

- Conviene si ... · No conviene si ...

## Qué cambiaría la recomendación

## Datos que faltan

> Temas fiscales: indicativo; valídalo con tu contador.
```

Example (fictional): oven $180,000.00, 5 years, rate 18% → base NPV $141,459.29, IRR 48.6%, discounted payback
2.4 years; pessimistic NPV -$13,648.40 (units -20%, cost +10%).

## Never

- Give a single number without scenarios, or hide the scenario where the project loses.
- Pick or adjust the discount rate so the project "comes out", or leave it without a reason.
- Include IVA in the cash flows, or present the recommendation as a decision.
- Recommend financial products or promise a return.

## Why

The owner is betting real money; seeing in which case the project loses is worth more than a precise base case.
