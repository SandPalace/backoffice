# Video engines: comparison and decision (2026-10-15)

Use case: short vertical marketing video (reels, ads, kinetic offers, talking-head edits), authored by an
agent on the person's own computer (macOS first; Windows for students), made by an agency for SMB clients.
Owner's decision: **Tesseract is the default engine.** The GSAP kit is the fallback. Remotion and
HyperFrames are **evaluated, not installed**: do not add them as dependencies.

## Comparison

| Criterion | Tesseract (`tsrct`) | GSAP kit (`render/gsap`) | Remotion | HyperFrames (HeyGen) |
|---|---|---|---|---|
| What it is | Native editor engine; agents drive a CLI that writes an editable `.tsrct` project and exports MP4/ProRes | Our HTML + SVG + GSAP pages, seeked frame by frame by Playwright, piped to ffmpeg | React components rendered in headless Chrome | HTML + `data-*` attributes (GSAP or other adapters) rendered in headless Chrome |
| Agent authorability | Good: JSON document + action batches, schema dumpable (`tsrct project schema`), vendor skills (`tesseract-motion`, `tesseract-video`). Caveats in `tesseract.md` | Good: plain HTML/JS; our 4 templates + `props.json`; contract in `render.mjs` header | Good: React/TS, 12 official agent skills | Very good: built for agents, 21 skills, no build step |
| Install, fresh Mac | One signed zip, checksum-verified, no sudo/Node; ~2 min | Node 20+, `npm install`, a Chrome (system Chrome via `CHROME_PATH` works), ffmpeg, Python numpy/scipy | Node + npm; Chrome Headless Shell and ffmpeg auto-download | Node 22+, ffmpeg separately, Chrome via npm |
| Install, Windows (students) | Official `windows-x86_64` bundle (unsigned: SmartScreen warns). Our render scripts hard-code the macOS path | Works in principle; `--gpu` path is Metal-only, ffmpeg/Python setup is friction | Supported (x64 binaries bundled) | No official statement; Windows fixes in Jul 2026 releases |
| Determinism / speed (measured here, M-series Mac) | Native renderer. Kinetic-offer 15 s 1080x1920: build 3 s + export **19 s** | Deterministic by contract (no wall clock, seeded RNG). Poster-kinetic 15 s @60 fps: **66 s** | Deterministic frame seeking; not measured here | Claims "same input, same frames"; not measured here |
| Talking head (cut / matte / captions) | **Yes**: our `talking-head/` tools (audio-based silence cuts, voice-driven zooms, captions, cutouts). Person matte via Apple Vision (macOS only); native matte broken in 0.3.1 | No footage pipeline | Possible in code, no person segmentation; would need building | Possible (video clips + captions), no matte; would need building |
| Audio | Native Audio layers, envelopes; procedural SFX helper `tesseract_sound.py` | numpy scores per template + ffmpeg two-pass loudnorm | `<Audio>` components | `<audio>` elements, `data-volume`, ducking skill |
| Editable by the client afterwards | **Yes** (`.tsrct` opens in the Tesseract app) | No (code + MP4 only) | No | No |
| License / cost | Free, **proprietary**. Commercial use by or for a business with ≥ US$1M annual revenue (commissioned client work included) needs a written agreement with Mirage. No resale/redistribution of the plugin. Output is yours | Our code. GSAP: free incl. plugins ("Standard no-charge"), bans building a Webflow-competing no-code animation tool; videos are fine | Free ≤ 3 employees; otherwise Company License (Creator $25/seat/month; Automator $0.01/render, $100/month min.). 5.0 counts contractors | **Apache-2.0**, no per-render fees or thresholds |
| Maturity | Young: repo Sep 2026, v0.4.0 (13 Oct 2026); we pin and field-tested **0.3.1** | In production at AI Studios (Oct 2026 pieces) | Mature (v4.0.535, years of use) | Young but very active: Mar 2026, v0.8.x, pre-1.0, several releases/week |
| Installed on this Mac | Yes, 0.3.1 at the standard path (not on PATH) | Code yes; `node_modules` and Chrome Headless Shell no (system Chrome works) | No | No |

## Recommendation

1. **Tesseract by default** for kinetic offers, overlays and every talking-head edit: fastest render measured,
   the only engine with an editable deliverable, and the only one where our talking-head tooling exists.
2. **Licence gate before using it for a client:** if the client (or the agency) has ≥ US$1M revenue and there is
   no written agreement with Mirage, do not use Tesseract for that client; use the GSAP kit and tell the owner.
   Anyone redistributing Back Office: shipping a copy of the `tesseract-motion` skill inside a plugin may count as
   redistribution (§2.2.2); that is why public copies do not include it.
3. **GSAP kit as fallback** when `tsrct` is missing/blocked or the client is over the licence threshold, and as
   the first choice for SVG characters, beat cartoons and WebGL fluids (formats Tesseract does not do).
4. **HyperFrames is the strongest candidate to replace the GSAP kit** later (same HTML+GSAP model, Apache-2.0,
   agent skills). Re-evaluate at 1.0 or when Windows is officially supported. Do not install it now.
5. **Remotion: no.** The Company License applies to us (more than 3 people) and to clients who would rerun it;
   it adds React and offers nothing the GSAP kit or HyperFrames lack for this use case.

## When to use each fallback

| Situation | Engine |
|---|---|
| Offer/promo, brand wants to edit later | Tesseract (`kinetic-offer`) |
| Raw takes of a person talking | Tesseract (`talking-head`); if `tsrct` is missing → **blocked**, ask to install |
| `tsrct` missing, person declines install, or client over the licence threshold | GSAP kit (`poster-kinetic` for offers) |
| Animated poster, mascot, cartoon, fluids | GSAP kit |
| Windows student machine | Tesseract Windows bundle for motion pieces (render scripts need the path adapted); GSAP kit without `--gpu` |
| Stills / flyers, clip assembly with generated shots | Not covered by this kit (craft only: `knowledge/ads/static-flyer.md`) |

## Sources (checked 2026-10-15)

- Tesseract: <https://mirage.app/tesseract>; repo and releases <https://github.com/mirage-hq/Tesseract> (v0.4.0,
  2026-10-13); terms <https://raw.githubusercontent.com/mirage-hq/Tesseract/main/LICENSE> (updated 2026-09-21,
  §2.2.2, §2.2.3); install guide `skills/tesseract-motion/references/installation.md`.
- Remotion: licence <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md>; pricing
  <https://www.remotion.pro/license> (the page's example total is inconsistent: confirm before quoting);
  <https://remotion.dev/docs/5-0-migration>; <https://www.remotion.dev/docs/ffmpeg>; <https://www.remotion.dev/docs/ai/skills>.
  Earlier internal test (Aug 2026, Remotion as control for overlays).
- HyperFrames: <https://github.com/heygen-com/hyperframes> (README, releases; v0.8.162 on 2026-10-15).
- GSAP: <https://gsap.com/standard-license>. Playwright browsers: <https://playwright.dev/docs/browsers>.
- Render timings: measured on this Mac on 2026-10-15 from a scratch copy of the kit (`kinetic-offer`
  `example.props.json`; GSAP `poster-kinetic` example with system Chrome).
