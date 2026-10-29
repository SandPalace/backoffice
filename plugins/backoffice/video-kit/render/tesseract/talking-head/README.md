# Talking-head tools: `edit.json` reference

Derived from the code of `voice.py`, `cutouts.py`, `build.py` and `finish.py` (2026-10-15). When the code
and this file disagree, the code wins. Craft rules: `knowledge/craft/talking-head-editing.md`.

## Commands (E = absolute path to `edit.json`)

| Step | Command | Writes |
|---|---|---|
| Voice analysis | `python3 voice.py analyze --edit E` | `<work>/analysis.json`, `analysis.md` |
| Camera draft | `python3 voice.py propose --edit E` | `<work>/emphasis.draft.json` (review → save as `emphasis.json`) |
| Cutouts | `python3 cutouts.py --edit E [--shots 01,04]` | `<cutouts_dir>/sh<NN>.mov` (ProRes 4444) for shots with `behind` |
| Build | `python3 build.py --edit E [--no-import]` | `<root>/<name>.tsrct`, `<work>/{document,actions,edit-map,imports}.json` |
| Finish | `python3 finish.py --edit E [--skip-export]` | `<root>/<name>.mp4` (−15 LUFS), `<work>/seams.json`, `loudness-final.json`, `<root>/Previews/<name>-overview.png` |

`build.py` and `finish.py` call `tsrct` at the macOS path. `finish.py` needs
`<working-folder>/.agents/skills/tesseract-motion/scripts/tesseract_sound.py` (see `setup-and-preflight.md`).

## `edit.json`

Paths are relative to `root`, which is relative to the folder holding `edit.json`.

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | Output basename (`<name>.tsrct`, `<name>.mp4`). New name per version |
| `title` | no | Composition name (default `name`) |
| `root` | no | Project root (default `.`) |
| `work` | yes | Work folder (e.g. `.tesseract-work/v1`) |
| `takes_dir`, `takes` | yes | Folder and `{"NN": "file.mov"}` per take |
| `transcript` | yes | JSON `{"NN": [[word, start_s, end_s], …]}` per take (word level; the tools do not transcribe) |
| `kit` | yes | Brand kit name → `kits/<kit>.json` (format: `kits/example.json`) |
| `kit_overrides` | no | `{section: {…}}` merged over the kit |
| `cutouts_dir` | yes | Where cutouts are written/read |
| `sfx` | yes | `{"dir": folder of .wav files, "roles": roles.json}` |
| `sfx_variants` | no | `{"pop": ["pop", "pop2"]}` cycles roles on repeated cues |
| `keywords` | no | Words always highlighted in captions |
| `voice` | no | `speech_db` −32, `min_pause` 0.30, `keep_tail` 0.09, `keep_lead` 0.06, `emph_db` 3.0 |
| `camera` | no | `merge_s` 0.25, `drift_per_s` 0.006, `settle` 0.06, `eye_dy` 150, `min_hold` 0, `super_mode` "fixed", `min_state` 0 |
| `grade` | no | primaryGrade values (exposure, contrast, highlights, …) |
| `shots` | yes | Ordered list, below |

### `shots[]`

Times inside a shot (`at`, `until`, `strike`) are **source seconds of the take**; the build maps them
through the silence cuts.

| Key | Meaning |
|---|---|
| `n` | Take id (key in `takes` / transcript) |
| `src` | `[start_s, end_s]` source range |
| `head` | Y px (1080x1920) of the top of the head, read off the person matte |
| `cx` | X px of the face centre |
| `path` | Palette colour name for this shot's graphics (must exist in the kit's `palette` and `on`) |
| `gain` | Voice gain (default 1.0) |
| `behind` | `[{text, at, until?, size?, mult?, base_dy?, band? (true), front? (y px: in front of the person), sfx?}]` hero words behind the person (needs a cutout) |
| `chips` | `[{text, at, strike, y, pop? (true), sfx? ("pop")}]` labels struck through at `strike` |
| `pill` | `{text, at, until, y, sfx? ("pop")}` |
| `agent` | Counter label text shown for the whole shot |
| `cta` | `{text, at}` closing call to action |
| `whoosh` | `true` → whoosh role at the shot start |
| `sfx` | `[{role, at: "start" \| "end" \| source_s}]` extra cues |

## `roles.json` (in `root`)

`{"<role>": {"key": "<wav basename>", "gain": 0.5, "lead_ms": 0, "dur_ms": 600}, …, "music": {"key", "gain", "dur_ms"}}`.
`music` is required. `lead_ms` moves the sound earlier so its hit lands on the cue.

## `emphasis.json` (in `work`)

`{"levels": {"base": 1.0, "tight": 1.10, "super": 1.28}, "tail_override": {"NN": end_s}, "shots": {"NN":
{"sections": [source_s, …], "super": [{"at": source_s, "word": "…", "why": "…"}]}}}`. Start from
`emphasis.draft.json` and validate every `super` against the sentence.
