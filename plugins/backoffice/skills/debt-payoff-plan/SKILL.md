---
name: debt-payoff-plan
description: Lists the person's debts (balance, annual rate, minimum payment, CAT if known) and compares the avalanche (highest rate first) and snowball (smallest balance first) methods with a month-by-month python simulation - total interest, payoff date and order per method - and warns when a minimum payment does not even cover the interest. Use it when the person asks "¿cómo salgo de mis deudas?", "¿qué tarjeta pago primero?", has several credit cards or loans, or only pays the minimum.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Debt payoff plan

Shared rules (notice, `[NO DATA: ...]`, money format, files): `../finance-mx-basics.md`.

## Procedure

1. For each debt ask for, or read from the statements the person uploads in the web "Archivos" tab
   (`backoffice_file_read`): name (e.g. "Tarjeta A"), current balance, **annual interest rate** (tasa de interés
   ordinaria anual), minimum payment, CAT if shown, and whether the statement charges IVA on interest (common on
   Mexican credit cards). Missing rate or minimum: `[NO DATA: ...]` and ask; do not assume a "typical" rate.
2. Ask how much they can pay in total per month across all debts. Ideally it comes from a `home-budget`; if the
   person does not know, propose doing that first.
3. Write `debts.csv` (`name,balance,annual_rate_pct,min_payment,cat_pct,iva_on_interest`) in
   `$TMPDIR/backoffice-work/<task>/`, copy `scripts/debt_payoff.py` from this skill's folder there and run
   `python3 debt_payoff.py debts.csv <monthly_amount> <YYYY-MM start>`.
4. The script stops (exit 2) if the monthly amount does not cover the minimums: then the conversation is about
   the budget, not the method. It also warns, per debt, when the minimum does not cover the month's interest.
5. Read both results (months, payoff date, total interest, order) and the difference in interest between the
   methods. Explain: avalanche saves more money; snowball gives early wins that keep motivation. The person
   chooses; if the difference is small, say so.
6. Add the first three months of the chosen plan as concrete actions ("pagar $X a Tarjeta B el día ...").
7. Save `debt-plan-avalanche.csv`, `debt-plan-snowball.csv`, `debt_payoff.py` and `debt-plan.md` with
   `backoffice_file_write` in `finance/<YYYY-MM-DD>-debt-plan/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Tu plan para salir de deudas — desde <mes año> (MXN)

Pago total al mes: $X · Deudas: N · Saldo total: $Y

## Tus deudas

| Deuda | Saldo | Tasa anual | CAT | Pago mínimo | ¿El mínimo cubre el interés? |
| ----- | ----: | ---------: | --: | ----------: | ---------------------------- |

## Comparación

| Método                                  | Meses | Terminas en | Intereses totales | Orden |
| --------------------------------------- | ----: | ----------- | ----------------: | ----- |
| Avalancha (tasa más alta primero)       |       |             |                   |       |
| Bola de nieve (saldo más chico primero) |       |             |                   |       |

## Lo que elegiste y los próximos 3 meses

## Alertas

## Datos que faltan
```

Example (fictional): 3 debts, $5,000.00/mes → avalanche 22 months, interest $32,600.36; snowball 22 months,
interest $34,587.60; "Tarjeta A: the $1,250.00 minimum does not cover the $1,498.33 monthly interest".

## Never

- Recommend a specific bank, consolidation loan, balance transfer product or new credit.
- Suggest stopping payments, or negotiate with a creditor on the person's behalf.
- Use a rate the person did not give, or treat CAT as the monthly interest rate.
- Calculate months or interest by hand.

## Why

Seeing the payoff date and the interest saved turns "I will never get out" into a plan with a finish line; the
minimum-payment warning is often the single most useful sentence in the whole plan.
