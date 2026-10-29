---
name: revenue-ledger
description: Keeps a lightweight revenue ledger for a Mexican SMB in one JSON file - clients, items with SAT keys, quotes, sales with consecutive folios and IVA by sale date, payments (abonos) with balances, cancellations with reason - and produces the summary (sold, collected, receivable), collection days, IVA by treatment, global-invoice support, CFDI 4.0 export data and a portfolio CSV for collections. Use it when the person wants to record or review their sales and collections, asks "¿cuánto vendí / cobré / me deben?", needs data to issue CFDI in their own billing system, or when the accountant asks for IVA by treatment. Support tool: it does not issue or stamp CFDI.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Revenue ledger

Shared rules (notice, `[NO DATA: ...]`, money format, files): `../finance-mx-basics.md` (read its "Revenue and invoicing data" section).

## Procedure

1. Confirm the business RFC, régimen, CP de expedición and the **rounding rule** (`half-up` is the default; `truncate` cuts to
   the cent per line, as some owners require). Ask which rule their CFDI/PAC accepts: it is accountant question F5 below.
2. Look for `finance/ledger/ledger.json` with `backoffice_file_list`. If it exists, `backoffice_file_read` it into
   `$TMPDIR/backoffice-work/<task>/ledger.json`. Copy `scripts/ledger.py` from this skill's folder next to it.
3. Run the script in that scratch folder (it keeps ONE rounding function and integer cents; never calculate by hand):
   `init`, `client add`, `item add`, `quote`, `sale` (new or `--quote COT-0001`, with `--method PUE|PPD`), `payment`,
   `cancel sale|payment ID --reason ...`, `rate add`, `list`, `verify`. Pass `--key <unique>` on every mutation so a retry never duplicates.
4. Reports (add `--csv file` to also write the table): `summary --from --to` (Vendido by sale date, Cobrado by payment
   date, Por cobrar), `collection-days`, `iva --from --to`, `global-invoice --from --to`, `export-cfdi --from --to --out-dir d`,
   `portfolio --as-of --out portfolio.csv` (the input of the collections `aging-report`).
5. Run `verify` and `python3 ledger.py selftest` before delivering. After every change, `backoffice_file_write` the updated
   `ledger.json` back to `finance/ledger/ledger.json` (it is the only copy: the log inside it is the audit trail).
6. Save reports and CSVs with `backoffice_file_write` in `finance/<YYYY-MM-DD>-revenue-ledger/` and deliver them with `backoffice_task_deliver`.

## Output format

Reports are markdown tables as the script prints them, plus a short Spanish reading and this block:

```markdown
> Indicativo; valídalo con tu contador. IVA by sale date: open question F1.
Verificaciones: total = suma de líneas ✔ · saldos ≥ 0 ✔ · folios sin huecos ✔ · bitácora íntegra ✔
Datos que faltan: [NO DATA: ...]
```

## Questions for the accountant before relying on it

- **F1** Is the IVA rate fixed by the sale date or by the collection date? With abonos, does each payment follow its own date?
- **F4** Which items are exempt or 0% (art. 2-A LIVA), and is "Sin IVA = exento" enough or do "no objeto" items exist?
- **F5** Does the rounding rule chosen stay within the tolerance the CFDI and the business's PAC accept?
- **F7** Confirm the "Público en general" data: RFC, name, régimen 616, uso S01, CP, and the deadline to ask for an invoice.
- **F9** Are the SAT catalogs in use current (ClaveProdServ, ClaveUnidad, forma de pago, uso CFDI, régimen, ObjetoImp)?
- **F14** Which minimum data per abono (date, amount, forma de pago, reference) feeds the complemento de pago for PPD sales?

## Never

- Issue, stamp or cancel a CFDI, or present the export as a valid invoice: the business issues it in its own system.
- Edit or delete a record: cancel it with a reason. Never skip the log, or re-round a document total.
- Add items with retenciones, IEPS or local taxes (the script refuses; flag it for the accountant).
- Invent a client RFC, SAT key or rate; missing data is `[NO DATA: ...]`. Write client names or RFCs into the log.

## Why

A single rounding rule applied once per line, integer cents and a total that is the sum of stored lines make every
report reconcile to the cent, and nothing is ever overwritten, so the accountant can trust and audit the history.
