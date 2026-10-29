# Source of finance-team

Written from scratch for Back Office, following the plugin conventions in `CLAUDE.md`.

- **executive-team** was used as the model for tone and structure (the `cfo` agent: hard rules with their why,
  calculations in python, the accountant notice; `cash-flow-forecast` and `decision-memo` for the skill format).
- **collections-team** (`reconciler`, `collections-lead`) was the model for the lead that delegates with Task and
  for to-the-cent checks.
- Domain context: Mexican SMBs (personas morales, personas físicas con actividad empresarial, RESICO) that
  invoice with CFDI 4.0, and individuals managing a household budget.

## What was adapted / own decisions

- **revenue-ledger** (skill + `ledger.py`) brings the business knowledge of a revenue-platform plan for Mexican SMBs
  (CFO/CTO documents, Oct 2026) in a lightweight form: knowledge only (rules,
  CFDI/IVA data, the accountant questions), no code, data or client names copied; rewritten from scratch as one JSON
  file instead of an app and database. The rounding rule is configurable (`half-up` by default, `truncate` optional).
- Four agents (`controller` as lead, `financial-analyst`, `tax-compliance`, `personal-finance-advisor`) and nine
  skills (`revenue-ledger`, `financial-statements`, `accountant-handoff`, `financial-ratios`, `project-evaluation`,
  `break-even-pricing`, `sat-tax-calendar`, `home-budget`, `debt-payoff-plan`).
- Split with executive-team: the `cfo` keeps strategy, the 13-week `cash-flow-forecast`, budget and decision
  memos. This team is the operational department (close, statements, accountant handoff, SAT calendar) and the
  personal finance desk. Whenever a forward cash projection is needed, the work is handed to the `cfo`.
- Shared Mexican rules live once in `skills/finance-mx-basics.md` (notice, IVA, regimes, NIF references,
  calculation and file conventions); skills point to it instead of copying it.
- Tax and accounting content is general guidance with the notice "indicativo; valídalo con tu contador". The team
  never files returns, never moves money, never gives definitive tax or investment advice, and never recommends
  specific financial products. Emails to the accountant are drafts.
- Workspace folder: `finance/` (virtual files).
