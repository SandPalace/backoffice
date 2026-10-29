# Talking-Head Editing: Voice, Silence, and an Audio-Driven Camera

How a creator-led vertical edit (one person talking to camera, 15–60 s) gets tightened and given
a camera. This file holds the craft rules. The tools live in `render/tesseract/talking-head/`
and the procedure is the `talking-head-edit` skill.

Worked example (AI Studios, media not included): Demo 002 v6. The
tightening took it from 58.6 s to 50.1 s, with 12 validated emphasis zooms, and the tools
regenerate it byte for byte from `.tesseract-work/v7/edit.json`.

---

## 1. Silences: what to cut and what to keep

**Find pauses in the audio, not in the transcript.** ASR word timestamps (parakeet and similar)
are packed end to start: each pause gets absorbed into the neighbouring word. On Demo 002 the
transcript showed no gap longer than 0.35 s, while the audio had five real pauses of 0.33–0.70 s
plus 0.4–1.0 s of air at the head and tail of every take.

| Rule | Value | Why |
|---|---|---|
| Speech gate | ~10 dB over the room floor, ~15 dB under spoken words (−32 dBFS on DJI lav audio in a quiet room) | Measure the floor per take (10th percentile of 10 ms frames) before trusting a fixed number |
| Heads and tails | Trim to the first and last speech, keeping 60 ms before and ~120 ms after | Air before the first word is dead time in a feed |
| Internal pause cut | Pauses ≥ 0.30 s for paid short-form; 0.4–0.7 s for organic; 0.8–1.5 s can stay in explainers | Sources vary with context. Faster for paid placements |
| Padding left in a cut pause | 90 ms after the last word, 60 ms before the next (about 150 ms of air) | Protects consonant tails and plosive onsets. Tools use 50–200 ms (auto-editor's default margin is 0.2 s) |
| Never | Cut every breath | Speech with no air sounds machine-gunned and frantic, and viewers notice over-trimming first |
| Keep | A pause that sets up a point or a punchline | A pause can signal confidence and give the viewer time to process |
| Cut point | In the quietest frames, never through a word or mid-breath | Cut just before a word begins |
| Seams | 10–15 ms gain fades on both sides, then check for clicks | A hard sample discontinuity clicks on phone speakers |

## 2. The camera: sections and super zoom

A jump cut reads as an error unless the framing changes. Cover it with the camera.

- **Section framing.** The framing alternates 100% and ~110% at every jump cut, and at clause
  starts (commas, and words like *que*, *y*, *porque* and *sin*).
- **Hold each framing at least 2 s.** A jump cut always changes the framing, because that is what
  hides it. A clause start only changes it when it lands ≥ 2 s from the shot start and from every
  other change. The owner's note on v6 (2026-10-08) was "hay muchos zooms": snapping on every clause
  (15 changes in 50 s) read as busy. With a 2 s minimum hold, Demo 002 v8 has 8.
- **Super zoom.** About 128%, held **exactly while the word is said**: in 80 ms before the word,
  out over 150 ms from its end, minimum 0.2 s. On Demo 002 v8 that is 0.24–0.69 s per word. The v6
  version held 0.5 s after the word and felt like too much zoom. Use at most one per idea, at least 2.5 s apart; about one every
  4 s is plenty. Past about 130% the image softens and the cut looks like a mistake. Check it on a
  phone.
- **Every camera state lasts at least 0.5 s.** This covers a framing, a super zoom, and the
  framing after a super. The owner's note on v9 (2026-10-08) was "que no haya tanto cambio". An
  audit of v9 found 8 changes less than 0.5 s apart. They are resolved like this:
  - a super lasts ≥ 0.5 s, even when the word is shorter;
  - a super that would start within 0.5 s after a cut (shot start or jump cut) **starts on the
    cut**, with no ease, so the cut itself is the punch-in, which is one change instead of two;
  - a clause snap within 0.5 s of a super is dropped;
  - a jump cut within 0.5 s after a super's end extends the super to the cut;
  - supers closer than 0.5 s merge.

  Audit the timeline (shot cuts, snaps, super in and out) after every build. In Demo 002 v10, no
  two changes are closer than 0.5 s.
- **Zoom centre.** Centre the zoom on the eye line, so the eyes hold their screen position across
  every snap.
- **Zoom only the camera.** Apply it to the footage and the person cutout, never to the
  graphics. Graphics zoomed with the shot leave the frame. In tsrct 0.3.1, scaled point text also
  wraps at the canvas edge.
- **Slow drift and settle.** Add about 0.6% per second of slow drift. On each shot cut, let the
  framing settle from 106%.

## 3. Emphasis: loudness proposes, meaning decides

1. **Measure.** Measure loudness in 50 ms windows against the take's median speech level, and
   flag peaks ≥ +3 dB.
2. **Map.** Map each peak to the transcript word it falls in.
3. **Reject the mechanical peaks:**
   - function words (*que, y, con, en, el, a, de…*): they are loud because of the attack after a
     pause;
   - a word repeated across the piece's sections (*agente* ×4): the content is the word that
     changes;
   - the frame word of a CTA (*palabra* in "escribe la palabra EQUIPO"): the emphasis belongs on
     the keyword.
4. **Validate the rest against the sentence:**
   - contrast (*lo que **sí** necesitas*);
   - payoff (*tendrás la solución*, *notición*);
   - the number or name the piece is about (*cuatro*, *marketing*);
   - the personal claim (*porque **tú** lo crearás*);
   - the CTA keyword.
5. **Recurring device.** A recurring device is allowed across parallel sections: the same zoom on
   each agent's name. Vary it when a louder, more meaningful word is in the same line (*pagos*).

On Demo 002, an automatic pick (loudest non-function word) agreed with the validated plan in 5 of
10 shots. The other 5 went to the loud word instead of the meaningful one. Step 4 is not optional.

## 4. Captions

- **No box.** Use bare text with an outline: white with an ink outline, about 10 px at 64 px.
  It reads over any footage without hiding the shirt, hands or product.
- **Emphasis words** are the keywords plus the validated super-zoom words. Set them in bold,
  about 1.25× larger, and in a colour from the brand palette: the shot's path colour, outlined in
  the kit's contrast colour (white on purple or blue, ink on turquoise). The caption then repeats
  the camera's emphasis instead of competing with it.
- **Chunking.** Use 1–3 words per chunk. Break after punctuation or after a keyword. Lay each word
  out on a shared baseline, measured with the real fonts.

## 5. Graphics that survive the edit

- **Map times through the cut.** Graphics times written in source seconds must be mapped through
  the cut. A time that falls inside a removed pause snaps to the next seam.
- **When the head sits high.** If the head sits too high for a word behind it, put that word in
  front, at the root level, over the lap or torso. The face would otherwise cover it.
- **Keep labels and chips off the face across the whole zoom range.** Put them in the free band
  above the head (from y 270, the top safe edge, down to the head top) or below the chin, never
  beside the face. The super zoom pushes the head top up by about (eye_dy × super) px, so check the
  frame at the super zoom, not only at rest. In Demo 002 v8 the objection chips sat at y 450–640,
  across the face; v9 moved them to y 270–420.
- **Keep the CTA up long enough.** A CTA must stay ≥ 2.5 s (`knowledge/ads/ad-architecture.md`
  §5). Keep part of the last take's tail after the final word when trimming would cut it short.

## 6. Sound effects

- **Check every SFX file before it goes in.** Demo 002 v4–v10 were mixed from a pack whose files
  each kept only ~30 ms of sound, and nothing in the build complained. Measure how long each file
  stays within 40 dB of its peak, and compare a build against the previous version: the difference
  signal at each cue is the effect alone.
- **Level:** accents sit about 3–14 dB under the voice peak; ding and cash register at the top of
  that range, pops and whooshes lower. A long boom carries more energy than its peak suggests, so
  keep its gain lower.
- **Riser or swell ends on the cut**: give the role a `lead_ms` equal to the sound's length and cue
  it at the shot start.
- **Two sounds less than ~0.3 s apart blur into one.** Keep the one that carries the meaning (a
  closing ding over a transition whoosh).
- **Alternate variants** (`sfx_variants`) so a repeated accent does not sound pasted.

## Sources

- Silence and jump-cut practice:
  - [Illinois CITL, *The Cutting Room Floor*](https://citl.illinois.edu/node/70)
  - [subscribr, editing talking-head videos](https://subscribr.ai/p/editing-talking-head-videos-engaging)
  - [faceless.so, removing pauses](https://faceless.so/blog/how-to-remove-filler-words-from-video)
  - [flaviocopes, auto-cut silence](https://flaviocopes.com/cut-silence-videos.md)
  - [Britbrief on breathless edits](https://britbrief.co.uk/environment/activism/social-media-videos-cut-out-breaths-driving-viewers-mad.html)
  - [auto-editor](https://github.com/wyattblue/auto-editor), for the margin default
- Zoom and punch-in practice:
  - [vizard, punch-in pacing](https://agent.vizard.ai/how-to/stop-the-punch-ins-cycling-too-fast-in-a-talking-head-edit.html)
  - [Riverside, Hormozi-style edits](https://riverside.com/blog/hormozi-style-videos)
  - [vidpros](https://vidpros.com/how-to-edit-videos-like-alex-hormozi/)
  - [amemoto edit breakdown](https://amemotoeditors.beehiiv.com/p/editbreakdown-2-answer-the-public)
- The numbers in §2 are working values tested on Demo 002, not figures any source confirms.
