# Source of executive-team

## Adapted from an earlier internal project (`.opencode/agents/`)
- `ceo.md`, `cfo.md`: translated and condensed. The responsibilities, the Always/Never principles
  (turned into rules with their why), the decision flow and the escalation triggers were kept.
- Adjusted for a Mexican SMB (MXN, indicative IVA/ISR with a notice to the accountant in the CFO) and for the fact that the person
  (the owner) decides and signs.
- Platform-specific material was removed: committees, `request_human_approval`, `./data/general`, ollama models,
  `ai-*` files, CTO and CHRO.
- `cmo.md` was only consulted to avoid duplication: the CMO already exists in `marketing-team`.

## Written from scratch
- The 5 skills (`executive-dashboard`, `decision-memo`, `weekly-review`, `quarterly-plan`,
  `cash-flow-forecast`), with output formats and fictional examples.
- The "How you work with Back Office" block (from `docs/CONVENTIONS-TEAMS.md`) and the coordination with the
  marketing, sales and collections teams.
- Workspace folder: `executive/` (virtual files; formerly `~/AgentOS/executive/`, a legacy prefix the server still maps).

## Change of 13 Oct 2026
- The COO moved to `backoffice-core` (`plugins/backoffice/agents/coo.md`): it is now the default Back Office agent, a bridge and guide between all teams. Its operations and commitments work is kept within that role. This team has CEO, CFO and `operations-chief` (the business COO, new and not adapted from mission-control; its id differs because `coo` belongs to the Assistant).
