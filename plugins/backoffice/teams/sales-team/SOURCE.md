# Source: sales-team

Written from scratch for Back Office. the earlier internal project had no sales agents, so none of its agents was copied
or adapted.

Ideas taken from the earlier internal project's pattern:
- **Always/Never rules**: each agent separates what it always does from what it never does
  ("Rules that override your judgment" and "What you never do").
- **Human escalation**: prices, discounts, terms, availability and anything sent outside
  are decided and signed by the person; the agent prepares drafts and asks when data is missing.

First use case: a real estate agent with a podcast who qualifies leads from Meta Ads.

Agents: `sales-lead`, `lead-qualifier`, `proposal-writer`, `follow-up`.
Skills: `qualify-lead`, `objection-handling`, `commercial-proposal`, `pipeline-report`, `follow-up-sequence`.
Workspace folder: `sales/` (virtual files; formerly `~/AgentOS/sales/`, a legacy prefix the server still maps).
