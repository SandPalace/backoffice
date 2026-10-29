# Ad Architecture

**Thesis.** A direct-response spot is not a small commercial. It is a
*conversion machine* wearing a film's clothes, and it is stricter than the
soap-opera line it sits beside: where an episode has three seconds to earn the
next three seconds, a spot has 1.5 to earn them, and every second after that
must move the viewer through a fixed sequence of beliefs — this is a problem I
have → this product fixes it → I trust the claim → I know exactly what to do
next — on the way to one measurable action. Craft that does not move a viewer
along that sequence is decoration, no matter how well it is shot. Everything in
this document is judged by one question: **does this beat change what the
viewer believes, or does it just look nice?**

---

## 1. The hook-by-1.5s rule

`CONVENTIONS.md`'s 3-second rule (hook = the first 0-3s, no setup) is the
drama-line budget. Ads compress it further because the viewer arrived with a
transactional guard up (they know an ad might follow) and the algorithm scores
completion within the first 1-2 seconds of impression.

| Rule | Drama episode | Ad spot |
|------|----------------|---------|
| Hook window | 0-3s | 0-1.5s |
| What must be true by the end of the window | Conflict, reveal, or question is on screen | The problem, claim, or contrast is on screen — never a logo, brand intro, or setup |
| Cost of missing it | Lower hold rate | Ad is skipped before impression counts as a view; hook rate collapses |

**Practical test:** freeze the spot at 1.5s. If the frame shows a logo
animation, a establishing wide with no conflict, or a person about to start
talking with no stakes yet, the hook fails. The frame at 1.5s must already
contain the reason to keep watching.

---

## 2. Beat roles

A beat role is not a shot size or a scene — it is a job the beat does on the
viewer's belief state. Every beat must change one of: attention, belief about
the problem, trust in the solution, or willingness to act. A beat that changes
none of these is cut, same as an idle beat in an episode (`00-production-bible.md`
gate: "no idle beats").

| Role | What it must change in the viewer | Typical duration | Fails by |
|------|-----------------------------------|-------------------|----------|
| `hook` | Attention — the reason to keep watching, in frame by 1.5s | 1.5-3s | Setup, logo, or a slow build before the conflict/claim lands |
| `problem` | Belief that a specific, recognizable problem exists (for them, now) | 3-8s | A generic problem no one recognizes as their own |
| `agitate` | The stakes of the problem — cost of doing nothing, escalated | 2-7s | Repeating the problem beat without raising stakes |
| `solution` | Belief that a specific product is the fix, introduced output-first | 3-10s | Explaining features before the viewer believes there's a problem to solve |
| `demo` | Belief that the product actually works, shown mechanically | 4-14s | More than 3 discrete steps; a demo that reads as a features list |
| `proof` | Trust — a quantified or third-party-validated result | 3-10s | An unquantified superlative ("amazing results") with no substantiation |
| `offer` | Clarity on what exactly is being offered and at what cost | 2-6s | Ambiguous pricing/terms, or an offer buried under brand voice |
| `cta` | Willingness to act right now, with the action named and on screen ≥2.5s | 2.5-8s | A CTA that's spoken but never written, or written for <2.5s |

Not every format uses every role — `psa-15` skips `agitate`, `proof`, and
`offer` entirely because its duration budget can't afford them (see the format
catalogue below). A role that doesn't earn its seconds in a given duration
budget should be cut, not compressed to the point of unreadability.

```prompt
vertical 9:16, on-screen text card "Your listing photos aren't the problem." in
upper-third safe zone, sans-serif bold, high contrast, held 2.5s, static camera
```

---

## 3. Format catalogue

Each format is a fixed skeleton of beat roles with a duration budget; the
machine-readable version of every row below lives in
`../specs/ad_templates.json`.

| Format id | Duration budget | Skeleton (roles in order) | Best for |
|-----------|------------------|-----------------------------|----------|
| `problem-solution` (`psa-15`) | 15s | hook → problem → solution → cta | Short-budget placements, retargeting where trust is already partial |
| `before-after` (`before-after-20`) | 20s | hook → problem → solution → demo → proof → cta | Any product with a visually verifiable transformation |
| `demo` (`demo-30`) | 30s | hook → problem → demo → proof → cta | Software/mechanism products where the "how" is the sell |
| `ugc-testimonial` (`ugc-testimonial-30`) | 30s | hook → problem → solution → proof → cta | Products with a real, rights-cleared user willing to speak on camera |
| `listicle` (`listicle-3-reasons-30`) | 30s | hook → problem → agitate → solution → cta | Educating an audience that doesn't yet know the category exists |
| `pov` (`pov-host-20`) | 20s | hook → problem → agitate → solution → cta | Unaware audiences scrolling without ad-intent; needs UGC register throughout |
| `founder` (`founder-45`) | 45s | hook → problem → solution → demo → proof → cta | Trust-building for most-aware/product-aware audiences via a personal why |
| `comparison` (`comparison-30`) | 30s | hook → problem → demo → proof → cta | Audiences actively evaluating "old way" vs. "new way" |

**Format selection is not aesthetic.** Pick the format from the awareness stage
first (below), then from the duration the placement allows, then from what
proof the campaign can actually substantiate — never from what looks most
cinematic.

---

## 4. Awareness stages and hook/format mapping

Eugene Schwartz's five awareness stages describe how much persuading a viewer
still needs, and they are the single strongest predictor of which hook and
format will hold attention. Getting this wrong (e.g. opening with a hard offer
on an unaware audience) is the most common way a technically well-shot spot
still fails.

| Stage | Viewer's state | What the spot must do first | Hook types that work | Formats that work |
|-------|------------------|-------------------------------|------------------------|---------------------|
| `unaware` | Doesn't know the problem exists as a named problem | Make the problem visible/relatable before naming any product | `before-after-flash`, `pov-caption`, `pattern-interrupt`, `direct-callout` | `pov`, `before-after` |
| `problem-aware` | Knows the problem, doesn't know solutions exist | Name the problem precisely, then introduce the category | `pain-question`, `negative-hook`, `number-list`, `direct-callout` | `problem-solution`, `listicle`, `pov` |
| `solution-aware` | Knows solutions exist, is comparing | Differentiate on mechanism or proof, not on problem restatement | `bold-claim`, `curiosity-gap`, `social-proof` | `demo`, `comparison`, `before-after` |
| `product-aware` | Knows this specific product, hasn't converted | Remove the last objection — proof, price clarity, urgency | `bold-claim`, `social-proof`, `curiosity-gap` | `demo`, `ugc-testimonial`, `founder`, `comparison` |
| `most-aware` | Ready to buy, needs the offer and the nudge | State the offer, minimize everything else | `social-proof`, `bold-claim` | `ugc-testimonial`, `founder`, short cuts of any format |

The full hook catalogue (pattern, generic example line, first-frame rule, and
risk) lives in `../specs/ad_hooks.json`.

---

## 5. CTA grammar

The CTA beat has one job: convert willingness into an action the platform can
register. Grammar varies by platform and awareness stage — the full matrix is
`../specs/ad_cta.json`; the rules that apply everywhere:

- **On screen ≥ 2.5s.** A CTA spoken but not written, or written for less than
  2.5s, does not count as a CTA for the quality gate in
  `00-production-bible.md` §8.
- **One verb, one destination.** Never stack two calls to action ("try it free
  — or subscribe — or comment below") in one spot; it splits the click.
- **Position:** center or lower-safe (never inside the bottom 15% UI-contested
  band from `CONVENTIONS.md`'s three zones).
- **Match the awareness stage.** An unaware viewer gets "see how"/"follow", not
  "buy now" — see the CTA table for the full progression.

```prompt
vertical 9:16, lower-safe zone (above bottom 15% UI band), bold sans-serif on
screen "Try it free — link in bio", high contrast card, held 3 seconds, static
camera, product frame continues softly out of focus behind the text
```

---

## 6. On-screen text rules

- ≤ 7 words per card (per `CONVENTIONS.md` Ads line section).
- ≥ 44px-equivalent size at 1080x1920 — legible on a 6-inch screen at arm's
  length, sound off.
- Position is always `upper-third`, `center`, or `lower-safe` — never the top
  10% or bottom 15% UI-contested bands.
- Every quantified on-screen claim ("2x faster", "50% less time") must have a
  matching entry in `compliance.claims` with a `substantiation` — see §9.

---

## 7. Retention economics: paid vs. organic

Paid and organic placements are scored differently, and a spot cut for one
without adjusting for the other underperforms.

| Dimension | Organic | Paid |
|-----------|---------|------|
| Ad-intent guard | Lower — viewer doesn't expect an ad, so subtlety (UGC/POV register) works | Higher — viewer expects a pitch; a bold, fast hook outperforms subtlety |
| Success metric the platform rewards | Completion, shares, comments, saves | Hook rate + CTR direct into CPA |
| Safe CTA aggression | Soft (follow, save, "see how") | Can be direct (buy now) if awareness stage supports it |
| Format fit | `pov`, `ugc-testimonial`, `listicle` | `demo`, `comparison`, `founder`, `problem-solution` |
| Iteration cadence | Slower — algorithmic discovery takes time to read | Fast — hook-rate signal available within hours of spend |

---

## 8. What to measure, and what beat it points to

| Metric | Formula | What it diagnoses | Beat it maps to |
|--------|---------|---------------------|-------------------|
| Hook rate | 3s views ÷ impressions | Whether the hook earns attention past the 1.5s window | `hook` |
| Hold rate | Completions (or 75%-watched) ÷ 3s views | Whether the middle beats sustain belief-building without a drop-off | `problem`, `agitate`, `solution`, `demo` |
| CTR | Clicks ÷ impressions (or ÷ 3s views for hook-adjusted CTR) | Whether the offer and CTA convert attention into intent | `offer`, `cta` |
| CPA | Spend ÷ conversions | Whether the whole funnel (spot + landing page) converts intent into the paid action | End-to-end; if CTR is healthy but CPA is bad, the problem is downstream of the spot |

A weak hook rate means fix the `hook` beat and its hook type, not the CTA. A
weak hold rate with a strong hook rate means a specific middle beat is losing
belief — check `demo` first (most common failure: too many steps) and
`problem` second (most common failure: a problem the audience doesn't
recognize as theirs). A weak CTR with strong hold rate means the `cta` beat or
its on-screen text is the failure, not the hook. This routing mirrors
`performance-report`'s approach for episodes: metrics point to a beat, never
to "the spot" as an undifferentiated whole.

---

## 9. Claims and compliance

Every quantified claim on screen or in VO — a number, a percentage, a
superlative implying a measurement ("fastest", "most") — requires a matching
entry in `spot.json`'s `compliance.claims`: the claim text, its
`substantiation` (where the number is proven), and a `status` of `approved`,
`pending`, or `rejected`. A spot with a `pending` or `rejected` claim still on
screen does not ship. Never invent a substantiation to fill the field — leave
it `"TODO: substantiation pending"` and the status `pending`, and flag it in
`review.md` for the client to confirm or correct.

---

## 10. Selling a SaaS/video-engine product

A typical client in this line sells a video engine that generates
listing videos for vacation-rental hosts and property managers. This is a software
product whose entire value proposition is a piece of output (a finished
listing video) produced from a mechanism (the engine) — the same shape as most
SaaS and tool products this line will sell next. Four rules specific to this
shape:

**Show the output first.** Open on the finished listing video, not the
software that made it. A viewer scrolling past does not care about an
interface; they care whether the output looks like something that gets more
bookings. The `demo-30` and `before-after-20` templates both lead their hook
beat with output, not tool.

**Before/after the listing, not the software.** The transformation that
matters to a vacation-rental host is "my listing looked amateur, now it looks like a
professional shoot got me" — not "the dashboard used to have fewer buttons."
Frame every before/after around the *listing's* presentation (the photos, the
walkthrough, the guest's first impression), never around the *product's* UI
history.

**Screen-recording beats are a demo, not a tutorial.** A screen-recording shot
inside the `demo` beat exists to prove the mechanism is real and fast, not to
teach the viewer how to use the software. Cap it at 2-3 discrete UI actions
(see `../ads/product-cinematography.md`'s screen-recording framing rules); a
step-by-step tutorial reads as slow and belongs in onboarding material, not a
15-30s spot.

**Time-saved is the load-bearing proof, but it must be substantiated.** "What
used to take a full afternoon of shooting and editing now takes minutes" is
the single strongest claim shape for this product category — but every
version of that claim ("in minutes", "10x faster", a specific time figure)
needs a `compliance.claims` entry with real substantiation from the client.
Never estimate or round a client's stated numbers upward.

**The trap: features-over-outcome.** The single most common failure mode for
SaaS/tool spots is spending the `demo` beat narrating features ("it has AI
color correction, automatic pacing, a template library...") instead of
showing one outcome per beat. A feature list does not move a viewer through
the belief sequence in §0 — it assumes belief that's not there yet. Every
`demo` beat must answer "what changed for the host," never "what the tool can
do" in the abstract. If a beat's intent field reads like a spec sheet line
instead of a change in viewer belief, cut it.

```prompt
vertical 9:16, phone in hand framing, screen shows a listing video editor
mid-render, real UI elements sharp and legible, thumb visible at bottom edge of
frame, soft daylight through a window behind the hand, static camera, 4 seconds
```

---

## Sources

- Eugene Schwartz, *Breakthrough Advertising* (1966) — the five stages of
  market awareness this doc's §4 maps hooks and formats against.
- `../00-production-bible.md` — the retention-machine framing and the
  beat/gate methodology this document mirrors for the ads line.
- `../CONVENTIONS.md` — the 9:16 non-negotiables and shot vocabulary this
  document assumes throughout.
