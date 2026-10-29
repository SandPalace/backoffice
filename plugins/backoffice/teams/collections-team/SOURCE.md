# Source of collections-team

Written from scratch for Back Office, following `docs/CONVENTIONS-TEAMS.md`.

- **an earlier internal project** only contributed the CFO agent pattern: "Always / Never" principles and escalation
  triggers to the person. None of its text was copied; it was rewritten for collections in Mexico.
- **marketing-team** was used as a model for tone and structure (hard rules, "You are done when",
  skills with an exact output format). Obsidian is not used.
- Domain context: SMBs that invoice with CFDI and collect by SPEI, cash or card.

## What was adapted / own decisions

- Four agents (`collections-lead`, `portfolio-analyst`, `collections-agent`, `reconciler`) and five skills
  (`payment-reminder`, `collections-policy`, `aging-report`, `payment-reconciliation`, `payment-plan`).
- Shared domain rules: no threats or humiliation, no contacting third parties, hours 9:00-19:00
  Mon-Sat, no legal action or interest that is not in the confirmed contract or promissory note (pagaré), payment
  received only if it appears on the bank statement, discounts and plans authorized by the person.
- Every message is a draft. This plugin is not legal advice.
- Workspace folder: `collections/` (virtual files; formerly `~/AgentOS/collections/`, a legacy prefix the server still maps).
