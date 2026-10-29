# The Static Flyer/Poster

> **Back Office note:** craft reference only. The pipeline it cites (`static-flyer` skill, `generate-plate`,
> Remotion compositing `render/src/Flyer.tsx`, `knowledge/validate.py`, `knowledge/schemas/`, the `client-review`
> skill, sample renders) belongs to AI Studios and is **not included** in this plugin.

**Thesis.** A static is not a cheaper substitute for a video spot — for a
large class of offers it is the *better* conversion machine, and the studio
should stop treating "generate a video" as the default just because this is
a video-generation pipeline. This document is the craft manual for
`static.json` (`knowledge/schemas/static.schema.json`), the ads line's second
output shape alongside `spot.json`.

---

## 1. What converts (rank by cost-per-conversation, never CTR)

Measured across a sibling account's paid history (225-333 days of real
spend, cost per WhatsApp conversation — never ROAS, there was no pixel):

| Format | Cost per conversation | Note |
|--------|------------------------|------|
| Static offer flyer | **best** — cheapest observed run beat target by 2.4x | Winner: offer + urgency + CTA printed on the creative |
| Event carousel | close second | Cheapest mould in the same range as the best static |
| Spoken-hook / talking-head video | the one video exception that works | Still 1.4-1.7x worse than the best static |
| AI cinematic / production video | **worst**, by a wide margin | One cinematic b-roll piece spent real budget for zero conversions |

Sibling account provenance, cited because the number is the argument, not
the design: *"same layout, static A (with price + urgency printed) converted
at ~8 MXN/conversation; static B (identical layout, no price, no urgency)
converted at ~30 MXN/conversation on the same audience and placement."* The
delta between those two pieces was not design quality — it was the *offer*
on the creative. Keep that distinction sharp: a flyer can be beautifully
composed and still lose, if the beautiful version is also the one with the
offer trimmed off.

**The operating rule this produces:** when a client's product has a
`compliance.claims`-clean, printable offer (a price, a date, a quantified
result) and the placement supports a static (feed, story, forward, DM), do
not default to a generated video spot. Bring the choice to `campaign-lead`
as a real option, priced on conversion economics, not on which pipeline
happens to be wired up. **Rank formats by measured cost-per-conversation
once a campaign has data; before that, rank by the table above and this
document's §2-§4.**

---

## 2. Offer-first vs. value-first (`static.json`'s `offer_model`)

Two theses, and the schema requires picking one per static because they
produce structurally different copy:

- **`offer-first`** — price and urgency lead. The winning-layout evidence
  above is offer-first: a struck-through anchor price, a discounted price, a
  concrete deadline or scarcity line, all above the fold. This wins for
  **low-ticket, one-off purchases** — a single workshop, a seasonal course,
  anything where price is the last real gate between an interested buyer and
  a yes.
- **`value-first`** — the tangible result leads; price appears once, small,
  never as the headline. This wins for **high-consideration or recurring
  purchases** — a monthly enrollment, a subscription, anything where the
  buyer is evaluating whether the whole commitment is worth it, not hunting
  a discount. Leading with the recurring price on this class of offer reads
  as a red flag and can kill the conversation before it starts; lead instead
  with the concrete thing the buyer walks away with, a future-facing benefit,
  or a safety/quality signal, and hold price to a small secondary line (or a
  one-time secondary incentive, never the recurring figure itself).

**Scope caveat, carried forward exactly because it is the trap:** do not
generalize the offer-first evidence past the low-ticket/one-off shape it was
measured on. A client's recurring-revenue product forced into an
offer-first flyer is applying a workshop-flyer lesson to a subscription
product — check which shape the client's `brief.json` offer actually is
before picking `offer_model`.

---

## 3. Formats and layouts

### Formats (`static.json`'s `formats[]`)

| Format | Role |
|--------|------|
| `4:5` | Primary feed format — Instagram/Meta feed default |
| `9:16` | Primary story/status format — also the forward-by-WhatsApp shape |
| `1:1` | Secondary — cross-posts cleanly, rarely the lead format |
| `1.91:1` | WhatsApp/Kommo template header (1200×628). The chat bubble crops any taller image to roughly this band — a 4:5 header sent as a template showed only its middle (y≈390–960 of 1350), headline and CTA cut off until tapped (Sales Agent, 2026-10-01). One idea per piece: headline plus the deciding fact. |

A static package can render more than one format from the same `static.json`
— the copy and theme are shared; each format is its own immutable render
(§8), not a re-authored piece.

### Layouts (`Flyer.tsx`'s `layout` prop)

| Layout | What it is | Use when |
|--------|-----------|----------|
| `band` | Headline band / photo band / data band, stacked (the proven default — see the sibling `FlyerWhatsAppHogar` composition) | Default choice; works for almost every offer |
| `overlay` | Full-bleed photo with text on a scrim | The plate itself is strong enough to carry the whole frame and a band would waste it |
| `type-only` | No plate at all — typography carries the piece | No usable photo exists yet, or the offer is abstract enough that a photo would mislead (see §6 on inventing plates) |

---

## 4. Variants and the CTA mechanism

`static.json`'s `variant` field decides which CTA mechanism the piece
carries, and this is not cosmetic — printing the wrong mechanism for the
placement breaks attribution or wastes the piece's only chance to convert.

| Variant | Where it lives | CTA mechanism | Why |
|---------|----------------|----------------|-----|
| `forward` | Sent directly, or printed, or dropped into a chat | **Printed phone number or URL** | It leaves the studio's control at the first forward. It must stand alone — a piece that says "comment below" means nothing once it's three forwards deep in someone else's chat. |
| `paid` | A click-to-message ad | **Printed keyword**, never the phone number | The button already opens the chat; a printed number is redundant. The keyword is the *only* attribution mechanism available: platform referral metadata frequently fails to reach the CRM, so a human typing the keyword first is how a conversion gets traced back to this specific creative. |
| `template` | The header image of a WhatsApp/Kommo message template | **A reply prompt** ("Responde para apartar tu lugar"); no keyword, no printed number | The recipient is already in the chat and the message text carries the contact; a keyword invitation there is noise, and a printed number duplicates the sender. Usually paired with the `1.91:1` format (§3). |
| `organic` | A feed post, not boosted | **Comment keyword or profile link** | No button exists; the CTA has to ask for a platform-native action (a comment, a profile tap) since there is no click-to-message affordance. |

The badge and headline are identical across variants of the same offer — the
only thing that changes is the `copy.cta` object (`channel`, `phone` vs.
`keyword` vs. `url`). Never blend mechanisms (a `paid` piece that prints
both a keyword and a phone number splits attribution for no benefit).

---

## 5. Anatomy and hierarchy

Every static, regardless of layout, resolves to the same information
hierarchy, because the hierarchy is what survives a chat thumbnail — most
statics are *seen first* at roughly 120px wide, before anyone opens the
image full-size.

1. **Badge** — the top chip. The one element that must read at ~120px:
   audience, permission, or category ("for adults, no tech knowledge
   needed"), never a countdown or a day-specific line (see below).
2. **Headline + accent** — the hook, split across a plain line and an
   accent-colored second line.
3. **Subhead** (optional) — one sentence expanding the headline.
4. **Bullets** — what the buyer takes away. **Four maximum.** A fifth
   bullet is not a style violation, it is a layout failure: it pushes the
   CTA bar off the bottom of the frame on the `band` layout.
5. **Price chip** — amount, optional struck-through anchor, optional note.
   Present or nearly absent depending on `offer_model` (§2).
6. **Details** — dates, schedule, venue. One line each, three lines max.
7. **CTA bar** — the mechanism from §4, always the visually loudest
   element in the piece (the sibling reference reserves a dedicated color —
   WhatsApp green — for this bar alone, deliberately breaking the piece's
   own accent-color consistency, because "this is where you reply" needs to
   read faster than color harmony matters).
8. **Reassurance** (optional) — a short risk-reversal line ("no tech
   knowledge needed", "small groups").

**No countdown, no "this Thursday," in an evergreen piece.** A flyer that
prints a specific relative date becomes trash the day after and forces a
same-day purchase decision on someone who just received it forwarded three
times removed from the original post. Put the badge's real estate to work on
audience/permission instead (§1's "for adults" example) and let the actual
date live in `copy.details` and in the conversation that follows — a
`forward`-variant piece especially needs to survive being read a week after
it was first sent.

---

## 6. The plate

**Never composite text, a logo, or a QR code inside a generated image.**
Every word in `static.json`'s `copy` is composited by Remotion
(`render/src/Flyer.tsx`) — deterministic and free. The generator's only job
is producing a clean photographic plate.

- **Prefer a real client photo** (`plate.source: "client-asset"`) over a
  generated one whenever the client has supplied one, or can. A real photo
  of the actual product/venue/moment reads as credible in a way a generated
  plate cannot fully match, and it sidesteps every rule below.
- **`derived_from` must point at a real photo or the brief — never at
  another generated or already-rendered sales asset.** This is the
  copy-of-a-copy failure mode, documented verbatim in a sibling project's
  incident log: *"it was generated using the prior generated asset itself as
  the main reference instead of the real photos. Copy of a copy → identity
  drift. Do not repeat this method."* Every generation traces back to a
  primary source, never to the studio's own prior output.
- **No generated people, and never generated minors.** A real photo
  including a minor requires documented parental consent on file before it
  is used, let alone generated as a stand-in.
- **Stray baked-in text gets a text patch, not a re-roll.** Generators
  routinely bake in text despite an explicit no-text negative prompt (a
  serial number, a "Nutrition Facts" label, a stray UI element). Record each
  offending region in `plate.text_patches[]` as a fraction of the plate's
  width/height (so it survives every crop) and blur it at composite time,
  rather than spending another generation trying to suppress it.
- **`generate-plate`'s no-text negative block is appended by the CLI, not
  authored here** — write the subject/scene prompt only; the tool owns the
  enumerated negative (the AI Studios `static-flyer` skill, not included here, has the
  exact invocation).

```prompt
A candid snapshot taken on a phone, not a professional photo. Slightly
imperfect framing, visible sensor noise and grain, mixed indoor lighting,
mild lens softness at the edges, natural handheld feel. Not studio-lit, not
glossy, not an advertisement.
```

That "phone snapshot" register, not "photorealistic cinematic," is the
single highest-leverage prompt change a sibling project found for this shape
of creative — a polished stock-photo register reads as an ad and gets
discounted; a candid register reads as evidence. Use the polished register
only when the format explicitly calls for product-hero language (clean
studio light, gradient background) — that is a deliberate exception, never
the default.

---

## 7. Brand and neutrality

- `static.json`'s `theme` is resolved from `brand.json` at authoring time —
  the render never reads `brand.json` itself, matching the ads line's
  brand-constrained house style rule (`.claude/agents/visual-designer.md`
  §Ads line).
- **If `brand.json` carries a color/logo restriction** (a neutrality period,
  a forbidden hex, a licensing constraint), **verify compliance by measuring
  pixels in the rendered PNG, not by eyeballing the composed frame.** A
  sibling incident logged "0 purple pixels" only because someone actually
  counted; eyeballing a restricted color under different lighting or
  compression is unreliable enough to be worthless as a check.
- A restricted palette does not mean "no color" — it means picking accent
  colors from the *opposite* family of any forbidden hex, so the piece is
  visibly not the same family even under casual inspection (e.g. a
  forbidden reddish-violet ruled out in favor of a blue-violet, not a
  desaturated version of the same hue).

---

## 8. Files are immutable once shown; the manifest vocabulary

**Once a render has been shown to anyone for review — internally or to the
client — it is never overwritten.** Bump the letter:
`render/4x5_a.png` → `render/4x5_b.png`. This is not a naming preference; a
reviewer's comment ("I liked version A") only keeps meaning if the file at
that name never changes underneath the reference. `render:static` enforces
this — it never overwrites, only appends a new letter.

`manifest.json` is an **append-only render log** — never delete an entry, only
add. Status vocabulary is exactly three values:

- `unreviewed` — the default on every new render.
- `approved` — set only after a literal client `APPROVE` (see
  `.claude/skills/client-review/SKILL.md`), never before, and never on the
  strength of an informal comment ("this looks good") that isn't the literal
  reply the loop requires.
- `rejected` — set on a literal `CHANGES` covering that specific render.

A render sitting at `unreviewed` indefinitely is not a bug — it means no one
has reviewed it yet. Do not invent a fourth status to describe "looks fine
but nobody said so."

---

## 9. Checklist before review

Before a static package reaches `client-review`:

- [ ] Every string in `copy` that is a fact (price, date, place, phone,
      quantified result) has a matching `claims[]` entry sourced to
      `brief.json`/`brand.json` — nothing printed is invented (non-negotiable
      8, `CLAUDE.md#ads-line`).
- [ ] `offer_model` matches the offer's actual shape (§2) — not
      offer-first by default.
- [ ] `variant`'s CTA mechanism matches where the piece will actually live
      (§4) — no printed phone number on a `paid` piece, no bare keyword on a
      `forward` piece.
- [ ] Badge reads at a ~120px simulated thumbnail; no countdown/"this
      Thursday" wording anywhere in an evergreen piece (§5).
- [ ] `bullets` is four items or fewer.
- [ ] `plate.derived_from` points at a real photo or the brief, never at
      another generated or rendered asset (§6).
- [ ] Any stray baked-in text is recorded in `plate.text_patches[]`, not
      left uncovered.
- [ ] Theme colors checked against `brand.json`'s restrictions by measuring
      the rendered PNG, if a restriction applies (§7).
- [ ] Every rendered PNG and every thumbnail has actually been looked at —
      not just the schema validated (AI Studios `static-flyer` skill, not included here).
- [ ] `python3 knowledge/validate.py` passes.
- [ ] No render has been overwritten; every shown version still exists at
      its original letter.
