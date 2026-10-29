---
name: financial-statements
description: Prepares an SMB's three basic financial statements - estado de resultados (income statement), estado de situación financiera / balance general and estado de flujos de efectivo (indirect method) - from a trial balance (balanza de comprobación), ledger or bank + invoice data, with checks that assets = liabilities + equity and that the cash flow reconciles to the change in cash, flagging missing data. NIF references as guidance. Use it for the monthly or annual close, when the person asks for "estados financieros", "estado de resultados", "balance", "¿cuánto gané este mes?" or a bank asks for statements.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Financial statements

Shared rules (notice, `[NO DATA: ...]`, NIF references, files): `../finance-mx-basics.md`.

## Procedure

1. Confirm the period (month, year to date), the entity and the currency. Read the inputs the person uploads in
   the web "Archivos" tab with `backoffice_file_list` / `backoffice_file_read`: best is a **balanza de comprobación**
   with opening and closing balances (from their accountant or accounting system); otherwise bank statements +
   CFDI lists + a list of assets and debts.
2. Map every account to one class in `trial_balance.csv` (`account,name,class,opening,closing`; classes and the
   sign convention are in the header of `scripts/statements.py`). Keep the mapping table: it goes in the
   deliverable. An account you cannot classify stays out and is listed as `[NO DATA: clase ...]`.
3. If only bank + invoices exist, build the balance from them and mark every balance you could not support
   (inventory, fixed assets, debts) as `[NO DATA: ...]`. Say clearly that the result is partial.
4. Copy `scripts/statements.py` from this skill's folder to `$TMPDIR/backoffice-work/<task>/` and run
   `python3 statements.py trial_balance.csv "<period>"`. It writes `statements.md` and `statements.json`
   (the input for `financial-ratios`) and exits 1 when a check fails.
5. **Checks must pass**: opening and closing balance (assets = liabilities + equity [+ period result]) and cash
   flow = change in cash. If one fails, show the difference and its likely cause (unclassified account,
   depreciation that does not match accumulated depreciation, an asset sale, a missing opening balance). Never
   add a balancing line.
6. Add a short plain-Spanish reading: sales, profit, where the cash went (operation, investment, financing).
7. Save `statements.md`, `statements.json`, `trial_balance.csv`, the mapping and `statements.py` with
   `backoffice_file_write` in `finance/<YYYY-MM-DD>-financial-statements/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Estados financieros — <periodo> (MXN)

> Indicativo; valídalo con tu contador. Referencias: NIF B-3, B-6, B-2.
> **En una línea:** <ventas, utilidad, efectivo>

## Estado de resultados (NIF B-3)

| Concepto | Importe |

## Estado de situación financiera (NIF B-6)

| Concepto | Inicial | Final |

## Estado de flujos de efectivo, método indirecto (NIF B-2)

| Concepto | Importe |

## Verificaciones

| Verificación | Diferencia | Estado |

## Mapeo de cuentas

| Cuenta | Nombre | Clase |

## Datos que faltan
```

Example (fictional): sales $600,000.00, net income $63,000.00; operating flow $69,000.00, investing
-$30,000.00, financing -$10,000.00 = change in cash $29,000.00 (OK).

## Never

- Force a balance with an "ajuste" or "otros" line, or hide a failed check.
- Present the statements as audited, official or ready to file.
- Mix personal and business accounts in the same statements.
- Calculate totals by hand.

## Why

Statements that do not close are the first thing a bank or an accountant notices; showing the difference and
its cause builds more trust than a balance that "closes" by force.
