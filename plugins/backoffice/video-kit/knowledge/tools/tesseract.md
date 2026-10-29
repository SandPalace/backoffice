# Tesseract — field notes

Tesseract (by Mirage, <https://mirage.app/tesseract>) is a free local engine for
editing video, motion graphics and static designs as editable layered projects
(`.tsrct`). Agents drive it through a CLI. These notes record what was learned
producing `demo-002` v4: what works, what is
broken in **CLI 0.3.1**, and the workarounds. Recheck the broken items when the
CLI version changes.

Reference build (AI Studios, not included here): the demo-002 `build.py`. Its patterns now live in
`render/tesseract/talking-head/build.py` (format: `render/tesseract/talking-head/README.md`).
Engine choice and licence: `engine-comparison.md`; preflight: `setup-and-preflight.md`.

---

## 1. Setup

| Item | Value |
|---|---|
| CLI | `~/Library/Application Support/Tesseract/bin/tsrct` (symlink to `public-cli/0.3.1-arm64/bin/tsrct`). Not on PATH: call it by full path, quoted (the path has a space). |
| Skills | In Back Office only `tesseract-motion` ships (plugin `skills/`); footage edits use `talking-head-edit`. The vendor set (`npx skills add mirage-hq/Tesseract`) also has `tesseract-video`, `-design`, `-editor`: not installed here. |
| Schemas | Dump them once per version: `tsrct project schema --document > document.schema.json` (editable JSON) and `tsrct project schema > actions.schema.json` (action batches). Grep them for a definition instead of guessing fields. `fxSchemaVersion` 67 in 0.3.1. |
| Telemetry | Optional attribution `TESSERACT_SKILL=tesseract-video`. Never enable telemetry for the user. |
| Helpers | `<skill>/scripts/tesseract_sound.py` (procedural SFX: `list`/`make`/`measure`/`mobile-preview`) and `tesseract_waveform.py`. They need python3 and ffmpeg. |

**Always pass absolute paths** to `--project`, `--file` and `--output`. Relative
paths fail with errors like `create the output directory first`, or silently
write nothing.

## 2. Mental model

- A `.tsrct` is a zip containing **one** composition (`main`, default 1080×1920,
  3 s) plus all packaged media and fonts. Never edit it by hand.
- Workflow: `project create` → `import-video` / `import-asset` / `import-font`
  (packages the bytes and returns an asset id) → `project checkout` to JSON → edit
  → `project commit` (validates the whole document atomically) → `project apply
  --actions` (animation batches) → `preview` / `filmstrip` / `export`.
- **Commit replaces the layer tree, then apply adds the animators.** After a
  commit, re-apply the animator batch. Re-checkout after any `apply` before you
  commit again, or you'll commit stale JSON.
- `layers[0]` is the **frontmost** layer. IDs must be unique across the whole
  composition, and that includes **effect IDs** (duplicate effect id 1 → commit
  error).
- Clocks: document `duration` is in seconds; every range is in ms.
  Video/Audio/Group layers use `playback` (windowed: `inputRange` = placement on
  the parent clock, `mapping.output.start` = source time); Text/Rect/Shape use
  `activeRange`. Children of a Group are timed relative to the group.
- Video layer: set `volume: 1.0` (or a gain) to hear embedded audio. `null`
  mutes it. `fit: "cover"`.
- Transform: `position` is in parent px, `anchorPoint` is layer-local, scale and
  opacity are in %, colours are RGBA 0–1.
- Point text (`boxText: false`, `justification: center`): its origin is the
  **baseline centre**. Anton's cap height is about 0.876 × fontSize.

## 3. Animation

Use `setFxPropertyAnimator` with `jsScript` / `layerTimeJsCode`. One action
animates one property; scale needs both `scaleX` and `scaleY`. The script reads
`input.time.seconds`, which is local to the owning layer's start, and must
`return` a number. It must be stateless (evaluated at arbitrary times).
Animatable property names live in the `JBFXProperty` enum: `positionX/Y`,
`opacity`, `scaleX/Y`, `rotation`, `fontSize`, `textContent`, `trimStart/End`,
`volume`, `rectSize`, …

Patterns that worked:

```js
// overshoot pop 135→100 over 220 ms, then slow drift
function cl(x){return Math.max(0,Math.min(1,x));}
function back(p){var c=1.9;return 1+(c+1)*Math.pow(p-1,3)+c*Math.pow(p-1,2);}
var t=input.time.seconds, p=cl(t/0.22);
return 135+(100-135)*back(p) + Math.max(0,t-0.22)*0.5;
```

- **Camera on a footage group**: `z = 100 + t*0.9` (slow push), a 0.25 s settle
  from 108% on each cut, and a hard punch-in ×1.13 over 70 ms on emphasis words.
  Set the group's anchor and position to the face (eye line) so zooms stay
  centred on it.
- **Strike-through**: a Rect anchored on its left edge, with `scaleX` going 0→100
  over 180 ms.
- **Music bed fades and ducking**: animate the Audio layer's `volume` with JS.
  The animator *replaces* the static gain, so include the bed level in every
  returned value.

## 4. What works well

- Native effects (typed, listed in the document schema): `primaryGrade` (needs
  `semanticVersion: 1` **and every field present**: exposure, contrast,
  highlights, shadows, whites, blacks, saturation, vibrance, temperature, tint),
  `vignette`, `grain`, `glow`, the blurs, `chromaticAberration`, `lumaKey`,
  `colorCurves`, `lensDistortion`, `customShader` (WGSL), and more.
- Text `dropShadow` and stroke (`applyStroke`, `strokeColor`, `strokeWidth`,
  `strokeOverFill: false`) give readable captions.
- Fonts: download the TTF (Google Fonts / GitHub), run `import-font`, and use the
  returned `fontFamily`/`fontStyle`. Anton (display) and Montserrat Black/ExtraBold
  (captions, UI) worked well.
- Speed: preview is about 1 s per frame. Exporting 58 s at 1080p30 took about 70 s.
- Filmstrip: `--timestamps-ms 300 3500 …` takes **space-separated values**. In
  zsh, write them literally or use `${=VAR}`, because a quoted var fails with
  `invalid digit`. Use `--tile-width 270 --tile-height 480 --items-per-row 7` for
  vertical frames; the defaults are tiny landscape tiles.
- `--fx-solo main:<id>` renders one layer over its whole window. It can't be
  combined with `--timestamps-ms`, so use `--max-frames`. Solo renders **skip
  track mattes**, so they can't diagnose matte problems.

## 5. Broken or limited in 0.3.1 — and the workarounds

| Problem | Symptom | Workaround |
|---|---|---|
| **`personMatte` effect has no model** | The public CLI ships no segmentation model, so the layer renders solid white. | Generate a real matte with Apple Vision: `.tesseract-work/v4/personmatte.swift` (`VNGeneratePersonSegmentationRequest`, accurate quality) → grayscale H.264, person white. About 10 s per clip. Compile it with `swiftc -O`. |
| **Track mattes are unreliable** | `trackMatte {layer, mode}` worked for some layers and was silently ignored for others. A matte shared by two consumers only cut the first. At composition root it cut nothing. | Don't use track mattes for the subject. **Pre-key the cutout** with ffmpeg: `alphamerge` footage + matte → `premultiply=inplace=1` → **ProRes 4444** (`prores_ks -profile:v 4444 -qscale:v 12`, yuva444p10le) trimmed to the used range, about 5 MB/s. Import it with `import-video` and place it **above** the text, with the full plate below. |
| HEVC with alpha | `hevc_videotoolbox -alpha_quality` imports fine but renders opaque. | Use ProRes 4444 (PNG-in-MOV also decodes, at about 3× the size). |
| **Root Adjustment layer** | A full-frame Adjustment (grade) above the groups broke cutout compositing in one shot: text drew over the subject. | Put the grade effects **on each footage layer and its cutout** (same settings), not in an Adjustment layer. |
| **Point text wraps at the canvas edge** | Text pushed wider than 1080 px by scale/punch-ins breaks onto a second line. | Size from real glyph widths (PIL `ImageFont.getlength`) to about 860 px, leaving headroom for zooms. |
| Text box / chip sizing | Character-count width estimates under- or over-shoot. | Measure with PIL using the same font file and size, then add padding. |
| No transcription | The CLI doesn't transcribe. | Use the platform's existing parakeet transcripts (`demo-002-sh-NN-transcript.json`; subword tokens, where a leading space starts a new word). |
| No music generation | The skill offers only procedural accents. | Synthesize an original bed with numpy (`.tesseract-work/v4/music.py`), or get a licensed track. |
| Loudness | The native mix landed at −16.8 LUFS with a −0.1 dBTP peak. | Two-pass ffmpeg `loudnorm` (I=−15, TP=−1.5, linear) on a **derived** MP4 with `-c:v copy`. Keep the premaster and the editable mix unchanged. |

## 6. Recipe: type behind the person (the look that made v4)

1. Matte each take with Vision → `mattes/shNN.mp4`.
2. Pre-key a cutout per take over its used source range → `cutouts/shNN.mov` (ProRes 4444).
3. Per shot, one Group (playback = placement on the timeline) containing
   `[cutout Video, big Text words…, footage Video]` in that front-to-back order.
   The cutout is timed with `sourceRange.start = 0` because it is already trimmed.
4. Place the word's baseline about 0.55 × cap height below the measured head top,
   so the head overlaps the lower half of the letters. Get the head top from the
   matte's first white row.
5. Slam the word in on its spoken word time (from the transcript) with the pop
   animator and a boom or swoosh SFX. Hold it to the end of the shot.
6. Captions, pills and counters go at the root, above all groups.

## 7. Verdict vs Remotion (2026-10)

Stay with Tesseract for creator-led footage edits. It has a rich effect set,
editable `.tsrct` deliverables, fast local export, and a single reproducible
build script. The ChatGPT-made v1–v3 looked basic because of authoring choices
(footage shrunk into a box, static header text), not because of engine limits.
Remotion has the same person-segmentation gap. Re-test §5 after each CLI update:
if `personMatte` gains a model and track mattes are fixed, drop the pre-keyed
cutouts.

## 8. Sound

- Don't pull SFX from YouTube "no copyright" meme packs for client work. They
  contain copyrighted clips (game music, songs, TV themes, OS sounds).
- AI Studios used a CC0 Freesound library (not included in this plugin). Here, make
  accents with `tesseract_sound.py make` and verify them (`sound-design` §1).
- Density for talking-head ads is about 3–5 accents per 15–30 s, each tied to
  meaning: boom on the big statement, whoosh on section cuts, swoosh on list
  items, pop on chips, ka-ching on money, ding on the CTA.
- Gains that worked under voice at about unity: boom 0.45, whoosh 0.22, pop 0.30,
  scratch 0.32, swoosh 0.28, cash 0.26, ding 0.30, music bed 0.13.
- Import with `import-asset --kind audio` and use Audio layers with
  `captionsEnabled: false`. Start a cue `lead_ms` early when its transient isn't
  at the start of the file.

## 9. Publishing

AI Studios' `publish-demos.mjs` (S3 + Demos page) is not included. In Back Office, persist with
`backoffice_file_write` and deliver with `backoffice_task_deliver`; never overwrite. Naming:
`9x16_<letter>-v<N>-<slug>.{mp4,tsrct}`, with a new letter and slug each version
(a v1, b v2, c v3, d v4). Deliver the editable `.tsrct` next to the MP4.

## 10. Motion graphics without footage (Kinetic Offer, 2026-10-07)

Template: `render/tesseract/templates/kinetic-offer/` (`build.py` + `props.json` per brand; usage in
the `build.py` docstring, example in `example.props.json`). First used for a client spot. What it showed:

- Native vector work behaves well in 0.3.1: point text, Rects, Shape paths with stroke `trim`
  (animate `trimEnd` 0→100 to draw a check), and Group `scaleX/Y` drift. No mattes needed, so
  none of the §5 bugs apply.
- **Negative times in JS break the parser.** `(t--0.300)` is a SyntaxError that rejects the
  whole action batch. Wrap every interpolated time in parentheses: `(t-(-0.300))`. Negative
  times are useful for having a line already mid-rise on frame 0.
- `tesseract_sound.py make` refuses to overwrite an existing output file, so delete it before
  regenerating SFX in a rebuild.
- Export at `--fps 60` for kinetic type: 15 s rendered in about 12 s.
- The music and SFX mix landed at −16.5 LUFS. Loudnorm a derived MP4 as in §5.
- In zsh, `"$VAR:linear=true"` applies the `:l` modifier and eats the text. Write `${VAR}:…`
  when building an ffmpeg filter string.
