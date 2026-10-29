# Motion Graphics: Faceless Video Made in Code

How the studio makes vertical (1080×1920) videos with no camera and no generated footage: type,
geometry, rigged characters, simulations and a score, all computed frame by frame. This file holds
the craft rules learned on real pieces. The tools live in `render/gsap/` and `render/tesseract/`;
the procedures are the `motion-video`, `gsap-motion` and `sound-design` skills.

Talking-head editing (real footage of a person) has its own file:
`knowledge/craft/talking-head-editing.md`. Static flyers: `knowledge/ads/static-flyer.md`.

Worked examples (all 9:16, 60 fps):

| Piece | Template | Engine | What it proved |
|---|---|---|---|
| Example spot-001 v1 | `kinetic-offer` | Tesseract | Type-only offer spot with an editable `.tsrct` a brand can reopen |
| Example spot-001 v2 | `poster-kinetic` | GSAP | "Poster, not flyer": geometry, split-flap, giant numeral, ring text |
| Example spot-002 v1 | `mascot-explainer` | GSAP | An original rigged SVG character that acts the message |
| Showcase · mascaras-001 | `cartoon-lyric` | GSAP | A 2D cartoon cut on the beat, studied from a reference without copying it |
| Showcase · icaro-001 | `myth-fluid` | GSAP + WebGL2 | A classic story in geometry over a live fluid simulation, with its own score |

---

## 1. Poster, not flyer

The owner on the first type-only spot (2026-10-07): "muy lineal vertical, parece un documento
animado… más poster, menos flyer". On the GSAP poster that followed: "Wow… Increíble".

- **Compose each scene as a poster**, not as stacked centred lines. Use a dominant shape (a giant
  numeral, a disc, a field of tiles), bleed it off the frame, and let type sit against it.
- **One visual idea per scene**, and a different mechanism per scene: a glyph that draws itself,
  a split-flap board, a rotating tile field, ring text. Four scenes, four mechanisms.
- **Geometry carries meaning.** In Ícaro the labyrinth is a seeded maze, the warning is a scale
  between sun and sea, the wings are pan pipes "from shortest to longest". Pick the shape the story
  already contains.
- **Restraint on paid offers.** The offer spot ("Apple, not TikTok") uses one ease-out curve, no
  bounce, no glow. Playful motion (squash, bounce, shake) belongs to characters and cartoons.

## 2. Characters

- **Build the character from primitives** (circles, paths) so every part is editable and owned.
  Never use a brand's off-limits mascot, fan art, or a character from the reference you studied.
- **The rig:** a body with squash and stretch around its feet, idle breathing, blinks, pupils for
  gaze, two to four eye or mouth states, arms that pivot at the shoulder (`svgOrigin`), and props.
- **The character acts the message**: it reacts (dizzy at confusion, a tie when it "works"), it
  points at the proof, it presses the CTA. A mascot that only waves is decoration.
- **A recurring character is a brand decision.** Ship the first piece as a proposal and ask the
  owner whether it stays, and what it is called.

## 3. Cartoon cut on the beat (studying a reference)

When a reference video is copyrighted, take its **techniques**, never its cast, lyrics, music or
shots. From a 2D lyric video the techniques were:

- a hard cut every 1–2 s, on the beat;
- limited two-pose animation with line boil (an SVG `feTurbulence` whose seed steps every 2–3
  frames);
- radial sunbursts behind the hero pose, bubble letters that slam in letter by letter, word-pop
  captions;
- a title splash with a hit-zoom and confetti;
- a horror beat: silence, one hit, flash cuts, a camera shake;
- an iris-out ending.

Write the score so its sections (`intro`, `groove`, `dark`, `build`, `drop`, `silence`, `hit`,
`end`) are events the page emits, so cuts and music cannot drift.

## 4. Simulation and physics

- **Fluids:** a GPU stable-fluids solver (`render/gsap/lib/fluid.js`) under the geometry. Dye is
  the medium of the story (smoke in the maze, wax, sky, the sun boiling, the sea).
- **Couple the simulation to the animation.** In Ícaro the wing-tip trails are the tips' real
  velocity (position difference per frame) injected as force. That coupling is what makes it read
  as physics rather than a background loop.
- **Use analytic physics for objects**: closed-form motion, such as a falling feather at terminal
  velocity with a pendulum flutter. It can be evaluated at any t, so stills and seeking stay exact.
- **Control the field per scene** with tweened parameters: curl (vorticity), dissipation, wind,
  curl-noise turbulence and buoyancy (heat rises, wax falls). Clear old dye before a new chapter by
  raising dissipation for about a second.
- **Grain and fine fluid detail make huge files**: a 55 s master came out at 543 MB at CRF 14.
  Deliver a CRF 21 re-encode (about 200 MB), and keep grain ≤ 0.015.

## 5. Text

- **Text rarely carries the piece.** In a story piece use one short line per beat, revealed per
  character (opacity, rise and blur, staggered), and gone before the next beat.
- **Use a serif for myth and story** (Instrument Serif), a grotesk for offers (Space Grotesk, DM
  Sans), and a bubble face for cartoons (Luckiest Guy). All are OFL.
- **Keep text inside x 40–1040 and y 270–1620** on a 1080×1920 frame, so the platform interface
  does not cover it. Every template's `__check()` enforces this before render.
- **Never print a client fact** that is not in the brief (non-negotiable 8).

## 6. Sound

The rules for SFX levels, procedural scores and checking files are in `sound-design` and §6 of
`knowledge/craft/talking-head-editing.md`. In short:
- the image emits the events and the score is written to them;
- the mix is normalised to −15 LUFS / ≤ −1.5 dBTP;
- a silence before the big hit is worth more than another layer.

## 7. Quality control

- **Stills before video.** Render 8–14 stills across the piece, tile them into a contact sheet,
  and look at it. Fix composition there; a full render costs minutes.
- **Look at a crop at full size** for anything that reads wrong small, such as feather angles,
  wing shapes or text kerning.
- **Measure, and say what was measured:** duration, LUFS, true peak, file size. Do not claim the
  mix sounds right unless someone listened at speed on a phone.
- **Versions are new files.** Never overwrite a render that someone has already seen.
