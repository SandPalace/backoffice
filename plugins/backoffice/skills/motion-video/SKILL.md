---
name: motion-video
description: The front door for making or editing a vertical video in code (from AI Studios). Picks the format and template (animated poster, character, cartoon, fluids, Tesseract offer, talking head) and covers installation, rendering, frame review and delivery. Use it for "make a video", "motion graphics", "animated poster", "cartoon", "animated character", "reel", "faceless video", "edit this video", or to install the video studio.
allowed-tools: Bash, Read, Glob, Skill, mcp__plugin_backoffice_backoffice
---

> **Kit and preflight (Back Office).** The `knowledge/…` and `render/…` paths below live in
> `${CLAUDE_PLUGIN_ROOT}/video-kit/`. Before rendering, read and run
> `${CLAUDE_PLUGIN_ROOT}/video-kit/knowledge/tools/setup-and-preflight.md`: scratch copy, the preflight
> (`tsrct`, ffmpeg, node, numpy/scipy), engine order (**Tesseract default**, GSAP kit fallback) and what to tell
> the person in Spanish when something is missing. Never install system software without their yes.

This skill is the router and the stack sheet. Read the craft rules before making anything:

- `knowledge/craft/motion-graphics.md`: faceless video made in code.
- `knowledge/craft/talking-head-editing.md`: editing real footage of a person.
- `knowledge/tools/engine-comparison.md`: why Tesseract is the default and when each fallback applies.

## 0. Preflight and engine choice

Run the preflight in `knowledge/tools/setup-and-preflight.md` and decide the engine **before** picking a template:

1. **Tesseract (default)** when `tsrct` answers `--version` (pin: `skills/tesseract-motion/references/cli-version.txt`)
   and the licence gate passes (client under US$1M annual revenue, or a written agreement with Mirage).
2. **GSAP kit (fallback)** when `tsrct` is missing, the person declines installing it, or the licence gate fails.
   Tell the person in Spanish which engine you used and that the result will not be editable in Tesseract.
3. Talking-head edits have **no fallback**: without `tsrct` the task is `blocked` with the install question.
4. **Remotion and HyperFrames: not installed — evaluated, see `knowledge/tools/engine-comparison.md`.** Never install or
   route to them.

## 1. Pick the format

| The ask | Format | Engine and template | Procedure |
|---|---|---|---|
| Offer or promo, editable by the brand afterwards | Kinetic type spot | **Tesseract (default)**, `render/tesseract/templates/kinetic-offer` (`build.py` docstring + `example.props.json`); fallback GSAP `poster-kinetic` | `tesseract-motion` |
| A person talking to camera (raw takes) | Talking-head edit | **Tesseract (default, required)**, `render/tesseract/talking-head` (`README.md` = `edit.json` format) | `talking-head-edit` |
| Overlay, lower third, typography over supplied footage | Motion overlay | **Tesseract (default)**, native layers | `tesseract-motion` |
| Ad that should look like design, "más poster" | Animated poster | GSAP, `render/gsap/templates/poster-kinetic` | `gsap-motion` |
| Explainer with a cute character | Mascot explainer | GSAP, `mascot-explainer` | `gsap-motion` (§ characters) |
| Music-driven cartoon, lyric video, meme format | Beat-cut cartoon | GSAP, `cartoon-lyric` | `gsap-motion` + `sound-design` |
| Story, myth, brand film, showcase | Geometry over a fluid sim | GSAP + WebGL2, `myth-fluid` | `gsap-motion` (§ fluids) + `sound-design` |
| A still flyer, or assembling generated clips | Static / spot assembly | **Not available in this plugin** (Remotion pipeline not installed; evaluated in `engine-comparison.md`) | Tell the person; offer a motion piece instead |

When an existing template fits, write a new `props.json` for it. Build a new template only for a
new format, and list it in the `render/LEEME-kit-video.md` table.

Example props: `render/gsap/examples/*.props.json` and `render/tesseract/templates/kinetic-offer/example.props.json`.

## 2. The stack

| Piece | What | Version tested |
|---|---|---|
| Languages | HTML/CSS/SVG + JavaScript (pages and renderer), GLSL ES 3.00 (fluid shaders), Python 3.11+ (audio, tools), Swift (person matte, macOS only) | |
| Default engine | Tesseract CLI `tsrct`, `.tsrct` documents; read `knowledge/tools/tesseract.md` first. macOS path `~/Library/Application Support/Tesseract/bin/tsrct` (not on PATH; quote it). Windows bundle exists, but the kit's Python scripts hard-code the macOS path | tsrct 0.3.1 |
| Person cutouts | Apple Vision person matte (`render/tesseract/talking-head/personmatte.swift`) → ProRes 4444 | macOS 14+ |
| GSAP (fallback kit) | Timeline engine. All plugins are free since 3.13; we use SplitText, DrawSVG, MorphSVG and CustomEase | gsap 3.13.0 |
| Renderer | `render/gsap/render.mjs`: Playwright drives a headless Chrome, seeks the timeline frame by frame, and pipes screenshots into ffmpeg | playwright-core 1.55.1, Node 20+ (tested 24) |
| Browser | `CHROME_PATH` (an installed Chrome works), else Playwright's chrome-headless-shell (`npx playwright install chromium-headless-shell`, only with the person's yes) | |
| GPU | `--gpu` renders WebGL on Metal through ANGLE (needed for the fluid templates); without it you get SwiftShader on the CPU | |
| Fluids | `render/gsap/lib/fluid.js`: WebGL2 stable fluids (Stam; GPU Gems ch. 38; vorticity after Dobryakov, MIT) | |
| Audio | numpy (+ scipy for `cartoon-lyric`) synthesis: `score.py` per template, `render/tesseract/templates/kinetic-offer/music.py`; ffmpeg two-pass loudnorm | numpy 2.x, scipy 1.17 |
| SFX | Procedural presets from `tesseract_sound.py` (`tesseract-motion` skill `scripts/`). The CC0 pack the knowledge mentions is not included | |
| Video | ffmpeg (libx264, AAC 192k), ffprobe | ffmpeg 7+ (tested 9.0) |
| Fonts | Not in the repo: `node render/tesseract/fonts/fetch-fonts.mjs` in the scratch kit before rendering (downloads Inter, DM Sans, Space Grotesk, Space Mono, Instrument Serif, Luckiest Guy with their licences; cached in `data/fonts`) | Node 18+ |

Install commands and the rule for missing software: `knowledge/tools/setup-and-preflight.md`.

## 3. Rendering

Tesseract: `python3 render/tesseract/templates/kinetic-offer/build.py --props <abs>/props.json --root <abs>/out`,
then `"$T" filmstrip …` for stills and `"$T" export --project <abs>/<name>.tsrct --output <abs>/<name>.mp4`
(`T` = the `tsrct` path; absolute paths only). Talking head: `talking-head-edit`.

### GSAP render contract (fallback kit)

A template is one HTML page that builds **one paused timeline** and exposes `__ready`,
`__seek(t)` (returns nothing), `__meta` and `__check()`. The contract is in the header of
`render/gsap/render.mjs`; the determinism rules (no `Math.random`, no wall clock, a seeded RNG, the `LEAD`
offset, `svgOrigin`) are in `gsap-motion` and visible in every template's `index.html`.

```bash
cd render/gsap
node render.mjs --page templates/<t>/index.html --props <spot>/props.json --out <spot>/<name>.mp4 \
  --frames 0,2.5,7,…          # stills only, into <spot>/frames/: iterate on these
node render.mjs … [--gpu] [--jpeg] [--crf 17] [--fps 60]    # the full video with audio
node render.mjs … --audio-only                               # remix onto the frames already rendered
```

## 4. Quality control and delivery

1. **Stills.** Render stills, tile them into a contact sheet, and look at them before the full render:
   ```bash
   ffmpeg -pattern_type glob -i 'frames/t*.png' -vf "scale=270:480,tile=7x2" sheet.png
   ```
2. **Full render.** Then a contact sheet from the MP4 (`-vf fps=0.4,scale=180:320,tile=11x2`)
   and a waveform (`showwavespic`).
3. **Measure.** Check duration with `ffprobe`, and loudness and peak with `ebur128=peak=true`.
   The target is −15 LUFS and ≤ −1.5 dBTP; if the peak is over, add `alimiter`.
4. **Delivery encode.** When the master is very large, encode a delivery version at CRF 21.
5. **Write `review.md`.** Say what changed and what was measured. Say plainly what nobody listened
   to or watched on a phone. The owner answers `APPROVE` or `CHANGES:`.
6. **Never overwrite** a render someone has seen. Use a new letter and slug for each version
   (`9x16_b-v2-<slug>.mp4`).

There is no `publish.py` here: persist the MP4 and `review.md` with `backoffice_file_write` (`marketing/<business>/creatives/`) and deliver them with `backoffice_task_deliver` (`files`).

## Do not

- Invent client facts, or reuse a reference's characters, lyrics or music.
- Use point text inside a zoomed Tesseract group (tsrct 0.3.1 wraps it).
- Ship a template without `__check()`, or a piece nobody has looked at as stills.
