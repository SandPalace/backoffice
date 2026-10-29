# Video kit: setup and preflight


> **Tesseract skill (public distribution).** The official `tesseract-motion` skill belongs to Mirage and may not be
> redistributed, so public copies of Back Office do not include it. With the person's OK: install the Tesseract app from
> https://mirage.app/tesseract, then Mirage's official skills with `npx skills add mirage-hq/Tesseract` (they land in the
> person's own Claude, straight from Mirage). If `skills/tesseract-motion/` is missing here, use that installed skill
> (the pin file and `tesseract_sound.py` helpers live in it) or fall back to the GSAP kit.

Shared by the video skills (`motion-video`, `gsap-motion`, `tesseract-motion`, `sound-design`,
`talking-head-edit`). Read it once per task, before rendering anything.

## Where the kit lives

`${CLAUDE_PLUGIN_ROOT}/video-kit/` (`knowledge/` + `render/`). Every `knowledge/…` and `render/…` path in
the video skills is relative to that folder. Never render inside the plugin: work in a scratch copy.

```bash
W="$TMPDIR/backoffice-work/<task>"                         # <working-folder>
mkdir -p "$W/.agents/skills"
cp -R "${CLAUDE_PLUGIN_ROOT}/video-kit/." "$W/"
cp -R "${CLAUDE_PLUGIN_ROOT}/skills/tesseract-motion" "$W/.agents/skills/"   # render scripts look for tesseract_sound.py here
```

Inputs the person uploaded come from `backoffice_file_read` (write them into `$W` first). Results (MP4, PNG,
`review.md`) are persisted with `backoffice_file_write` (`content_base64` for binary, up to 50 MB) under
`marketing/<business>/creatives/` and delivered with `backoffice_task_deliver` (`files`). Never ask the person
for a disk path and never show them one.

## Engines (default first)

| Order | Engine | Use when |
|---|---|---|
| 1 (default) | **Tesseract** (`tsrct`, pinned version in `skills/tesseract-motion/references/cli-version.txt`) | Kinetic offers, overlays, talking-head edits, anything the brand should reopen as an editable `.tsrct` |
| 2 (fallback) | **GSAP kit** (`render/gsap`, Node + headless Chrome + ffmpeg) | `tsrct` is missing or blocked, or the format needs SVG characters / WebGL fluids (poster-kinetic, mascot-explainer, cartoon-lyric, myth-fluid) |
| — | Remotion, HyperFrames | **Not installed.** Evaluated only: `knowledge/tools/engine-comparison.md` |

Licence gate: Tesseract's terms require a written agreement with Mirage for commercial use by or for a
business with ≥ US$1M annual revenue (client work included). If the client is that size and no agreement is
confirmed, use the GSAP kit and say why. Details in `engine-comparison.md`.

## Preflight (run it, do not assume)

```bash
T="$HOME/Library/Application Support/Tesseract/bin/tsrct"            # macOS; Windows: %LOCALAPPDATA%\Tesseract\bin\tsrct.cmd
{ [ -x "$T" ] && "$T" --version; } || command -v tsrct || echo "MISSING tsrct"
cat "${CLAUDE_PLUGIN_ROOT}/skills/tesseract-motion/references/cli-version.txt"   # required version
command -v ffmpeg ffprobe || echo "MISSING ffmpeg"
node --version || echo "MISSING node"                                  # GSAP kit: Node 20+
python3 -c "import numpy, scipy" || echo "MISSING numpy/scipy"           # scores, voice analysis
node "$W/render/tesseract/fonts/fetch-fonts.mjs"                       # fonts are not in the repo; first time needs internet
```

`tsrct` is usually **not on PATH**: call it by its full quoted path (it has a space). The render scripts
(`kinetic-offer/build.py`, `talking-head/*.py`) hard-code the macOS path.

GSAP kit only: `cd "$W/render/gsap" && npm install` (local, inside the scratch copy). Browser: set
`CHROME_PATH` to an installed Chrome (macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)
or ask before running `npx playwright install chromium-headless-shell`.

## If something is missing

- **Never install system software on your own** (Tesseract, ffmpeg, Node, Python packages, Xcode tools,
  browsers). Tell the person in Spanish what is missing, what it is for, and the command, and wait for a yes.
  Example: «No encuentro Tesseract (el editor de video) en esta compu. ¿Lo instalo? Son unos 2 minutos;
  mientras, puedo hacer el video con el kit GSAP, pero no quedará editable.»
- `tsrct` missing or wrong version → install only with permission, following
  `skills/tesseract-motion/references/installation.md` (checksum-verified, no sudo). Without it, fall back to
  the GSAP kit for motion pieces; **talking-head edits are blocked** (no fallback): task `blocked` + checkin
  `waiting` with the question.
- ffmpeg missing → every engine is blocked (Tesseract on macOS/Windows exports MP4 itself, but loudness,
  contact sheets and the talking-head tools need ffmpeg).
- Person cutouts (`talking-head/personmatte.swift`) need macOS 14+ and Xcode command line tools (`swiftc`).
- A version different from the pin is not an error to fix silently: report it; the field notes in
  `knowledge/tools/tesseract.md` are for 0.3.1.

## Not included in this kit

- The CC0 SFX pack the knowledge mentions (`sfx-library/v2/`). Use the procedural presets of
  `tesseract_sound.py` (`list` / `make` / `measure`) in the `tesseract-motion` skill's `scripts/`.
- `publish.py`, S3 upload, the AI Studios dashboard, the static-flyer / Remotion pipeline.
