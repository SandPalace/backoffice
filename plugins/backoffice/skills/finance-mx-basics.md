# Finance basics for Mexico (shared by every finance-team skill)

Read this before running any finance-team skill. It is general guidance, not tax or legal advice.

## The notice

Every deliverable that touches taxes, accounting rules (NIF), deadlines or deductibility carries this line,
in the deliverable's language:

> **Indicativo; valídalo con tu contador.** Las reglas fiscales cambian y dependen de tu régimen.

(English: "Indicative; validate it with your accountant.")

## Data and calculation rules

- **Missing data** is written `[NO DATA: <what is missing and who can provide it>]` and reported to the person.
  Never fill it with an "average" or a guess. An estimate is allowed only if the person agrees, and it is labeled
  `estimate` with its basis.
- **Every number is calculated with python3 (standard library only)** in `$TMPDIR/backoffice-work/<task>/`:
  read inputs with `backoffice_file_read`, write them to that folder, run the script, save the script next to the
  result. Never do arithmetic mentally. Use `decimal.Decimal` for money totals and round only when presenting
  (2 decimals, `ROUND_HALF_UP`); rates, NPV and IRR may use floats. Exception: stored documents (sales, IVA per line)
  use the one configurable rule of the `revenue-ledger` skill (`half-up` or `truncate`), applied once per line and never re-rounded.
- **Bundled scripts:** most skills ship a tested script in their `scripts/` folder. Copy it into the scratch
  folder with Bash (`cp "<this skill's folder>/scripts/<name>.py" "$TMPDIR/backoffice-work/<task>/"`), run it there,
  and save the copy you ran with the result. If you adapt it, say what changed in the deliverable.
- **Money format:** MXN by default, `$12,345.67`. Say whether a figure includes IVA (`con IVA` / `sin IVA`).
  Never add different currencies; convert only with an exchange rate and date given by the person.
- **Sources:** every figure in a deliverable names its source (file + row/sheet, or "the person said, <date>").
- **Files:** outputs go to `finance/<YYYY-MM-DD>-<task>/` with `backoffice_file_write` and are delivered with
  `backoffice_task_deliver`. Never ask for or mention disk paths: the person finds files in the web tab "Archivos"
  or in the task's delivery.

## IVA and ISR (general level)

- **IVA:** general rate 16% (8% in the northern/southern border region for eligible taxpayers; 0% or exempt for
  some goods and services). `precio con IVA = precio sin IVA × 1.16`; `IVA = precio sin IVA × 0.16`. IVA is not
  income: a business collects it for SAT and credits the IVA it paid (acreditamiento) when the expense is
  deductible and supported by a CFDI.
- **ISR:** income tax. Businesses make **monthly provisional payments**; the annual return settles the year.
  Payroll ISR is withheld from employees and paid monthly.
- **Withholdings (retenciones):** a persona moral paying a persona física for professional services or rent
  usually withholds ISR and part of the IVA; they are paid with the monthly return.

## Regimes the person may be in (ask; never assume)

| Regime                                                 | Who                                                            | Notes (indicative)                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Persona moral, régimen general                         | Companies (S.A., S. de R.L., S.A.S.)                           | Monthly ISR/IVA; annual return by 31 March                                  |
| RESICO persona moral                                   | Small companies that opted in                                  | Monthly; ISR on cash flow basis; annual in March                            |
| Persona física con actividad empresarial y profesional | Individuals with a business or profession                      | Monthly ISR/IVA; annual in April                                            |
| RESICO persona física                                  | Individuals under the income cap (about $3.5 million MXN/year) | Monthly ISR at a low rate on income collected, IVA monthly; annual in April |
| Sueldos y salarios                                     | Employees                                                      | The employer withholds; annual only in some cases                           |
| Others (arrendamiento, plataformas tecnológicas, etc.) | —                                                              | Ask the accountant                                                          |

## CFDI 4.0 (what to check, not how to issue)

Receiver RFC, name and postal code match the Constancia de Situación Fiscal; régimen fiscal and uso de CFDI are
right; método de pago `PUE` (paid in one exhibition) or `PPD` (paid later, needs a **complemento de pago** when
collected); status vigente vs cancelado. Common deductibility red flags (indicative): an expense without CFDI;
a CFDI issued to the wrong RFC; payments above $2,000 MXN made in cash (they usually must be by transfer, card or
check to be deductible); fuel paid in cash; `PPD` invoices without their payment complement.

## Revenue and invoicing data (used by `revenue-ledger`)

- **IVA treatments:** general 16%, tasa 0% and exento are three different things. 0% is **not** exempt (both show IVA
  $0.00 but are reported differently). "Sin IVA" is treated as exempt; "no objeto" items need the accountant (F4).
- **Which rate:** the rate comes from the **sale date** through a table with validity dates, never hardcoded. Whether the
  sale date or the collection date fixes it is an open question for the accountant (F1); abonos do not change the rate.
- **Público en general:** RFC `XAXX010101000`, name "PUBLICO EN GENERAL", régimen 616, uso CFDI S01, CP = the issuer's
  CP de expedición. Confirm in the current SAT catalogs and the deadline to ask for an invoice (F7); sales to this client are summarized in a global invoice.
- **CFDI 4.0 fields:** emisor (RFC, razón social, régimen fiscal, CP de expedición); receptor (RFC, name, CP fiscal,
  régimen, uso CFDI); each concepto (ClaveProdServ, ClaveUnidad, descripción, cantidad, valor unitario, descuento, ObjetoImp);
  método de pago PUE/PPD and forma de pago. A PPD sale needs a complemento de pago per abono (date, amount, forma de pago).
- **Out of scope = flag, never compute wrong:** retenciones of IVA/ISR, IEPS and local taxes are not calculated; say so and
  send the item to the accountant (F10).
- **Records:** keep sales and payments at least 5 years (CFF art. 30, from secondary sources: confirm, F6) and never delete
  them: cancel with a reason. Cancelling a sale already invoiced outside means cancelling or substituting that CFDI in the billing system.
- **Rounding:** pick one rule (`half-up` or `truncate` per line) and apply it everywhere. Ask the accountant whether it stays
  inside the tolerance the CFDI and the PAC accept (F5).

## Financial statements and NIF (references, not rules)

- Estado de situación financiera (balance general): NIF B-6.
- Estado de resultado integral (estado de resultados): NIF B-3.
- Estado de flujos de efectivo: NIF B-2 (indirect method is the common one for SMBs).

## Hand-offs

- A forward cash projection (13 weeks, "¿me alcanza?", "¿cuánto aguantamos?") belongs to the executive-team
  `cfo` (skill `cash-flow-forecast`). Prepare the inputs and say so; do not build a second forecast.
- Budget vs strategy decisions with a memo go to the `cfo` / `ceo` (`decision-memo`).
- Everything tax-related ends with "confirm with your accountant": returns, regime changes, SAT letters or
  requirements, penalties, surcharges.
