---
name: accountant-handoff
description: Assembles the monthly package for the external accountant - list of CFDI emitidos and recibidos (from files the person uploads), bank statements index, bank reconciliation status, expenses without CFDI (non-deductible risk), payroll summary and pending questions - as a checklist, an index CSV and a short email DRAFT to the accountant. Use it at month end, when the person says "¿qué le mando a mi contador?", "prepárame lo del contador" or before the 17th.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Accountant handoff

Shared rules (notice, CFDI checks, `[NO DATA: ...]`, files): `../finance-mx-basics.md`.

## Procedure

1. Confirm the month, the RFC's regime (or `[NO DATA: régimen fiscal]`), the bank accounts used by the business
   and whether there is payroll. List what the person uploaded in the web "Archivos" tab with
   `backoffice_file_list`: CFDI exports or XML (emitidos and recibidos, from the SAT portal or their billing system),
   bank statements (PDF/CSV), payroll receipts, cash expenses.
2. Build `cfdi.csv` (columns in the header of `scripts/cfdi_check.py`) from the CFDI files and `bank.csv` from the
   statements, in `$TMPDIR/backoffice-work/<task>/`. If XML is available, read UUID, date, RFC, total, método and
   forma de pago from it with python; never retype amounts by hand.
3. Copy `scripts/cfdi_check.py` from this skill's folder there and run `python3 cfdi_check.py cfdi.csv bank.csv`.
   It flags: issued PUE without deposit, received PUE without payment, deposits without CFDI, payments without
   CFDI, PPD paid without complemento de pago, cancelled CFDI, cash expenses above $2,000 and fuel paid in cash.
   Every flag is a **possible** risk with a question for the accountant.
4. Bank reconciliation status per account: opening balance, deposits, payments, closing balance vs statement
   (computed). If the `collections-team` delivered a `reconciliation.md` for the month, reference it.
5. Payroll summary if there are employees: headcount, gross payroll, period (from the receipts), or
   `[NO DATA: nómina]`.
6. Write the checklist (`handoff.md`), the index (`handoff-index.csv`: `document,period,source_file,status,notes`)
   and the **email draft** (`email-draft.md`): short, polite, in the person's voice, listing what is attached and
   the open questions. The person sends it; you do not.
7. Save everything plus `cfdi-check.csv` and the script with `backoffice_file_write` in
   `finance/<YYYY-MM-DD>-accountant-handoff/` and deliver it with `backoffice_task_deliver`.

## Output format

```markdown
# Paquete para tu contador — <mes año>

> Indicativo; valídalo con tu contador.

## Checklist

- [x] CFDI emitidos: N (total $X) — archivo ...
- [x] CFDI recibidos: N (total $Y)
- [ ] Estado de cuenta <banco/cuenta> — [NO DATA: falta subirlo]
- [x] Conciliación bancaria: cuadra / diferencia $Z
- [ ] Nómina del mes

## Posibles riesgos (para confirmar con tu contador)

| Fecha | Contraparte | Monto | Hallazgo | Pregunta |

## Preguntas pendientes

## Borrador de correo (no enviado)

Asunto: Información de <mes año> — <negocio>
Hola <nombre del contador>, te comparto ... ¿Me ayudas a confirmar ...?
```

Index CSV example: `CFDI emitidos,2026-09,finance/2026-10-05-accountant-handoff/cfdi.csv,completo,`.

## Never

- Send the email, contact the accountant, or log in to the SAT portal (never ask for e.firma, CIEC or passwords).
- State that an expense "is not deductible" as a fact; it is a possible risk.
- Issue, cancel or modify CFDI, or retype amounts by hand.
- Include personal expenses in the business package.

## Why

A complete, organized package on time saves the accountant hours, reduces surprises on the 17th and lets the
owner ask the right questions instead of discovering problems at the annual return.
