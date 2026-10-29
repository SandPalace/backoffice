---
name: break-even-pricing
description: Calculates contribution margin per product or service, the break-even point in units and in MXN, the margin of safety and the price needed for a target margin, with IVA clearly separated (prices sin IVA and con IVA). Use it when the person asks "¿cuánto debo cobrar?", "¿a cuánto lo vendo?", "¿cuánto tengo que vender para no perder?", "¿estoy ganando con este producto?" or wants to raise prices.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Break-even and pricing

Shared rules (notice, IVA, `[NO DATA: ...]`, money format, files): `../finance-mx-basics.md`.

## Procedure

1. List the products or services with the person: current price, and whether that price **includes IVA**. Convert
   to sin IVA with python (`precio / 1.16`) when it does, and say so. Ask if they are in the border region (8%)
   or sell exempt / 0% items.
2. Variable cost per unit sin IVA (materials, packaging, commissions, card fees, shipping) and units sold per
   month (history or expectation, labeled). Fixed costs per month sin IVA (rent, payroll, software, utilities).
   Read uploaded lists with `backoffice_file_read`. Missing: `[NO DATA: ...]`; never assume a cost.
3. Ask the target margin and whether it is a contribution margin (over variable cost) or a net margin (after
   fixed costs). If they do not know, show both.
4. Write `products.csv` (`product,price_sin_iva,variable_cost_sin_iva,units_per_month`) in
   `$TMPDIR/backoffice-work/<task>/`, copy `scripts/break_even.py` from this skill's folder there and run
   `python3 break_even.py products.csv <fixed_costs> <target_margin_pct> [iva_pct]`.
5. Read: products that lose money per unit; break-even in MXN and units with the current mix; margin of safety;
   the price for the target margin sin IVA and con IVA (what the customer pays).
6. If a price rise is suggested, show the units that could be lost before earning less (same script, new price)
   and leave the market decision to the person (and to the sales team if they want an offer change).
7. Save `break-even.md`, `break-even.csv` and `break_even.py` with `backoffice_file_write` in
   `finance/<YYYY-MM-DD>-break-even/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Punto de equilibrio y precios — <mes año> (MXN)

**En una línea:** necesitas vender $X sin IVA al mes para no perder.

## Margen por producto

| Producto | Precio sin IVA | Precio con IVA | Costo variable | Margen de contribución | MC % |

## Punto de equilibrio

Ventas: $X sin IVA ($Y con IVA) · ≈ N unidades con la mezcla actual · Margen de seguridad: Z%

## Precio para tu margen objetivo (W%)

| Producto | Precio mínimo sin IVA (MC) | Precio sin IVA (margen neto) | Precio con IVA |

## Supuestos y datos que faltan

> El IVA no es ingreso: lo cobras para el SAT. Indicativo; valídalo con tu contador.
```

Example (fictional): bakery, fixed costs $30,000.00/mes; cake $450.00 sin IVA ($522.00 con IVA), variable
cost $180.00; break-even $48,000.00 sin IVA per month.

## Never

- Mix prices with and without IVA in one column, or count IVA as income or margin.
- Set the final price: you show the numbers; the person decides.
- Invent costs, competitor prices or market data.
- Calculate by hand.

## Why

Many small businesses price by copying the competition or "what feels right" and find out at year end that a
product loses money; the break-even number turns sales goals into something concrete.
