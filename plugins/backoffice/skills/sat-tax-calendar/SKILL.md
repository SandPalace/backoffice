---
name: sat-tax-calendar
description: Builds a GENERAL, dated checklist of the person's likely tax obligations for the next 3 months according to their regime (persona moral, persona física con actividad empresarial, RESICO) - monthly ISR/IVA provisional payments by the 17th, withholdings, payroll ISR and IMSS, DIOT, the annual return (personas morales in March, personas físicas in April) - each item marked "confírmalo con tu contador". Asks the regime first. Use it when the person asks "¿qué tengo que pagar al SAT?", "¿cuándo vence...?", "calendario fiscal" or "obligaciones del mes".
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# SAT tax calendar

Shared rules (notice, regimes, `[NO DATA: ...]`, files): `../finance-mx-basics.md`.

## Procedure

1. **Ask the regime first** (it is on the Constancia de Situación Fiscal; the person can upload it in the web
   "Archivos" tab). Map it to `pm`, `pm-resico`, `pf-empresarial` or `pf-resico`. Other regimes (sueldos only,
   arrendamiento, plataformas) or "no sé": say this calendar does not cover it and send it to the accountant as
   `[NO DATA: régimen fiscal]`. Never guess the regime.
2. Ask: do they have employees (payroll ISR, IMSS, INFONAVIT, state payroll tax)? Do they pay professional fees
   or rent to personas físicas (withholdings)? Which state (state payroll tax date)?
3. Copy `scripts/sat_calendar.py` from this skill's folder to `$TMPDIR/backoffice-work/<task>/` and run
   `python3 sat_calendar.py <regime> <employees yes|no> <withholds yes|no> <today YYYY-MM-DD>`. It writes
   `sat-calendar.csv` with dates moved from weekends to Monday; official holidays are not known to the script,
   so each row carries the note.
4. Review the list with the person and remove what clearly does not apply (e.g. DIOT if their accountant says
   they are exempt). Add items the accountant already told them about, labeled as such.
5. Write `sat-calendar.md`: the notice at the top, the dated table, and for each month the documents to gather
   before the date (link to `accountant-handoff`).
6. Save `sat-calendar.md`, `sat-calendar.csv` and the script with `backoffice_file_write` in
   `finance/<YYYY-MM-DD>-sat-calendar/` and deliver them with `backoffice_task_deliver`.

## Output format

```markdown
# Calendario fiscal general — <mes> a <mes año>

> **Indicativo; valídalo con tu contador.** Las fechas y obligaciones dependen de tu régimen, tu estado y
> facilidades que solo tu contador conoce. Si la fecha cae en día festivo oficial, normalmente se recorre.
> Régimen: <confirmado por la persona / [NO DATA: régimen fiscal]> · Empleados: sí/no · Retenciones: sí/no
> | Fecha | Día | Obligación | Autoridad | Estado | Confírmalo con tu contador |
> |---|---|---|---|---|---|

## Qué juntar antes de cada fecha

## Preguntas para tu contador
```

Example (fictional): RESICO persona física, no employees → 17 Nov 2026 "Pago mensual: ISR provisional (RESICO)
e IVA de octubre 2026"; 30 Nov 2026 "DIOT de octubre 2026".

## Never

- State a penalty, surcharge, amount to pay or a rule as definitive, or omit the notice on any item.
- Build the calendar without the regime, or assume persona moral / física.
- File, pay, or log in to the SAT portal; never ask for e.firma, CIEC or passwords.
- Type dates by hand: they come from the script.

## Why

Most fines for small businesses come from forgotten dates, not from complex tax issues; a dated list reviewed
with the accountant each month prevents most of them.
