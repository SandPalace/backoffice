---
name: home-budget
description: Builds a personal or household monthly budget from net income and fixed/variable expenses, compares it with 50/30/20 as a reference (not a rule), sets the emergency fund target (3-6 months of essential expenses) and the monthly saving needed for each goal with a date. Use it when the person asks for a "presupuesto familiar" or "personal", says "no me alcanza la quincena", "¿en qué se me va el dinero?", wants to start saving or an emergency fund.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Home budget

Shared rules (notice, `[NO DATA: ...]`, money format, files): `../finance-mx-basics.md`.

## Procedure

1. Ask, one question at a time and without judging: net income that actually arrives (sueldo after
   deductions, extra income) and how often (quincenal, mensual, semanal); fixed expenses (renta, servicios,
   colegiaturas, seguros); variable expenses (súper, gasolina, salidas); minimum debt payments; current savings.
   If they upload bank or card statements in the web "Archivos" tab, read them with `backoffice_file_read` and
   propose the categories for them to confirm.
2. Mark each line `essential` yes/no **with the person** (it is their call, not yours). Anything they do not
   know: `[NO DATA: ...]`, or an estimate they agree to, labeled as such.
3. Ask for goals with an amount and a date (e.g. "fondo de emergencia", "enganche", "vacaciones de diciembre").
4. Write `budget.csv` (`concept,type,essential,amount,frequency`; `type` = income | fixed | variable | debt |
   savings) and, if there are goals, `goals.csv` (`goal,amount,target_date,saved`) in `$TMPDIR/backoffice-work/<task>/`.
5. Copy `scripts/budget.py` from this skill's folder there and run `python3 budget.py budget.csv goals.csv`.
   It normalizes every frequency to monthly, compares with 50/30/20, computes the emergency fund (3 and 6
   months of essentials) and the monthly saving each goal needs.
6. If expenses exceed income, propose 2-3 concrete adjustments ranked by impact, chosen from the person's own
   non-essential lines, and recompute. Never cut essentials without asking.
7. If there are debts with interest, suggest the `debt-payoff-plan` skill as the next step.
8. Save `budget-monthly.csv` (from the script), `budget.py` and `budget-plan.md` with `backoffice_file_write` in
   `finance/<YYYY-MM-DD>-home-budget/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Tu presupuesto mensual — <mes año> (MXN)

**En una línea:** <ingresos vs gastos, sin juicios>

## Cómo está hoy

| Bloque | Actual | % del ingreso | Referencia 50/30/20 |
| ------ | -----: | ------------: | ------------------: |

## Fondo de emergencia

Meta: 3 meses = $X · 6 meses = $Y (gastos esenciales $Z/mes). Hoy llevas: $W.

## Metas

| Meta | Monto | Fecha | Ahorro mensual necesario | ¿Cabe hoy? |
| ---- | ----: | ----- | -----------------------: | ---------- |

## Plan (pasos pequeños)

1. Esta semana: ...
2. Este mes: ...

## Datos que faltan

- [NO DATA: ...]

Siguiente revisión: <fecha>
```

Example (fictional): income $19,000.00/mes (quincena $9,500.00); essentials $18,050.00 (95%); emergency fund
3 months = $54,150.00.

## Never

- Judge or moralize about any expense, or present 50/30/20 as mandatory.
- Recommend banks, accounts, apps, funds or investments.
- Add amounts by hand or mix quincenal and monthly figures without normalizing.
- Ask for card numbers, NIP or passwords.

## Why

A budget the person helped build, in their own categories, is one they actually follow; a perfect budget
imposed from outside is abandoned in two weeks.
