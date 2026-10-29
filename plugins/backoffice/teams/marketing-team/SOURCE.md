# Origin

Absorbed from an earlier internal marketing kit (the kit from the 8 Oct 2026 workshop)
at commit `b07936e2581ab323ca7ee45e5d6c5b500d5f8e56` on 2026-10-12. A copy, not a move: the original repo is still alive.

## What came in
- Agents: cmo, researcher, creative, analyst (originally cmo, investigador, creativo, analista).
- Skills (13, now migrated): onboarding, workspace-audit (originally evaluar-boveda, then workspace-audit), read-documents (read-documents),
  workspace-guide (originally boveda-obsidian, then workspace-guide), fact-check (fact-check),
  market-research (market-research), content-calendar (content-calendar), content-script (content-script),
  image-prompt (image-prompt), video-prompt (video-prompt), publish-package (publicar), html-report (html-report),
  metrics-sqlite (metrics-sqlite).
- Outside the plugin, in `../../../../templates/` (repo `templates/`): CLAUDE.marketing.md (the CMO's hard rules),
  settings.marketing.json (allow/ask/deny permission layer) and the vault templates.

## What was left for later
- **Video (13 Oct 2026):** the motion-editor agent was not copied as a separate agent: its work belongs to the `creative`.
  Its 5 skills came in (tesseract-motion, motion-video, sound-design, talking-head-edit, gsap-motion), along with the knowledge
  (`video-kit/knowledge`) and the render kit (`video-kit/render`, without node_modules). They require Node, ffmpeg and Python;
  the Tesseract CLI (`tsrct`) has macOS/Windows/Linux bundles, but the kit's scripts hard-code the macOS path.
  The static-flyer, edit-clips-remotion and generate-spot skills (Remotion pipeline) were not brought over.
- **Video engine decision (15 Oct 2026):** Tesseract is the default engine, the GSAP kit the fallback;
  Remotion and HyperFrames evaluated and not installed (`video-kit/knowledge/tools/engine-comparison.md`).
  The five video skills now share `video-kit/knowledge/tools/setup-and-preflight.md` (scratch copy, preflight,
  Spanish message when something is missing), declare `allowed-tools`, and use `${CLAUDE_PLUGIN_ROOT}/video-kit`.
  Dead references (missing READMEs, the AI Studios SFX pack, `productions/` paths, non-existent skills) were
  removed or marked "not included"; `render/tesseract/talking-head/README.md` documents `edit.json` from the code.
  Tesseract's terms (2026-09-21) require a Mirage agreement for client work for businesses with ≥ US$1M revenue
  and forbid redistributing the plugin: check before reselling a plugin that ships `tesseract-motion`.
- Obsidian vault as the interface: replaced by the Back Office office.

## Migration to Back Office (13 Oct 2026)
The 4 agents and the marketing skills no longer depend on Obsidian. `boveda-obsidian` → `workspace-guide` (now `workspace-guide`),
`evaluar-boveda` → `workspace-audit` (now `workspace-audit`). Data lives in the workspace's virtual files `marketing/<business>/` (formerly `~/AgentOS/marketing/<business>/`, a legacy prefix the server still maps) and approval is the task
in Back Office (`done` is set by the person). The templates were copied inside the skills (`metrics-sqlite`, `html-report`).
`templates/` (repo root) remains as history (it still talks about Obsidian) and is no longer used.

## English rename
Agents, skills, file names and workspace paths were translated to English (e.g. `hechos.md` → `facts.md`, `calendario.csv` → `calendar.csv`,
`investigacion/` → `research/`). The agents still talk to the person in Mexican Spanish by default.
