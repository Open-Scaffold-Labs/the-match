---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, eagle-eye, club-arcs, dispersion, build-spec, phase-3]
---

# The Match — Phase 3.3 Build Spec: Own-Club Distance Arcs (with handicap-seeded empty state)

*Build-ready spec. Prepared 2026-06-25. Companion to `build-plan-bulletproof-2026-06-23.md` and `eagle-eye-premium-plan-2026-06-23.md`. Backed by two competitive-research passes (UX + data/accuracy) run this session.*

> **The bar (Matt):** biggest name in golf apps worldwide — perfected on **usability, accuracy, visual flow.** Verify, don't claim. Build it better than the market, now.
>
> **Competitor-naming rule:** this committed doc refers to rival products **generically only** ("a leading shot-tracking platform," "the consensus-cleanest GPS app," "a mature sensor-based app"). Standards (USGA, Rule 4.3, Trackman as a data source) may be named.

> **⚠ CORRECTION (2026-06-25, Matt) — supersedes the handicap-seeding thesis below.** Handicap does NOT map to how far a player hits each club; seeding distances from it (even anchored to one club) is a guess, and guessing breaks the accuracy promise that is this app's whole point. **We use ONLY the player's own entered bag distances** (`tm_user_clubs.avg_yards`) — far more accurate than any model. When the bag has no distances, the UI **prompts the player to set them** (opens My Bag); it never fabricates. `clubModel.js` was reduced to `realBag()` (entered data only) — the gapping-ratio / handicap-anchor seeding was removed. The "useful on hole 1 via seeding" wedge below is RETRACTED; the real wedge is making real-distance entry effortless + the visualization beautiful + honest. **Foundational follow-up Matt flagged: add a proper gender/tee-gender profile field and strengthen the club-distance entry flow — a top-tier app needs real player attributes, not workarounds.** Sections 1–2 below are kept for history but read them through this correction.

---

## 1. What we're building and why it wins

Draw the player's **own club distances** as honest landing **zones** on the satellite hole — so a glance answers "which of *my* clubs reaches here, from where I'm standing." We already draw a single landing ring for one selected club; 3.3 turns that into the personalized, decluttered, hole-1-useful "bag on the map" that the market half-does and no one nails.

**The competitive landscape (researched this session):** leaders have moved from a single carry arc → personalized shot-dispersion overlays (arcs for tee shots, ovals for approaches) with a draggable target and an expected-score readout. But **no incumbent clears the full triad of honest + uncluttered + premium-on-free**, and every one fails at least one leg loudly:

- The richest dispersion app dumps data on the map as always-on **clutter** (its #1 complaint).
- The polished ones are clean because they're **spare** (front/middle/back only), not because they show your clubs well.
- All of them are **blank until you've tracked 5–10 rounds** — and the ones that guess from 2 manual points guess badly.
- Premium polish (3D, LiDAR, satellite) is **paywalled**; serious caddie features are **subscription/hardware-gated** (~$100–200/yr).

**Our four ownable wedges** (each a documented incumbent failure):

1. **Useful on hole 1, round 1 — via seeded distances.** *No leading app we surveyed seeds club distances from a player's profile;* they're blank until tracked. We seed a full bag — **anchored to the user's one known club** (onboarding collects a first club) and scaled across the bag, with handicap as the fallback scale — shown as clearly "estimated," refining as the user enters real numbers. **Verified this session:** `user.handicap` is on file (migration 001 + onboarding) and `stats.handicap` refines it; **no gender field exists**, which is exactly why anchoring to a real known club (gender-agnostic) is the right seed, not a guessed men/women table. This is the single biggest differentiator.
2. **Calm by default, detail on tap.** The map stays clean; club zones are *summoned* (via the existing BAG view), never always-on clutter. Show only the club(s) that actually bracket the target, not a wall of rings.
3. **Honest zones, not fake-precise arcs.** A landing **band/zone** sized by a dispersion model — never a 1-yard ring that asserts laser precision a GPS amateur shot doesn't have. "~" not decimals, "avg" labelled.
4. **Premium-feeling and free.** No mid-round upsells, no paywall on the core view.

---

## 2. Accuracy model — the data, stated precisely (from research)

**Club distance semantics.** `tm_user_clubs.avg_yards` is a single number per slot with no carry/total split and no sample count. Research is firm that carry ≠ total (roll ranges ~0 yd for wedges to ~20–30 yd for driver) and that the honest map mapping is: **carry → front edge / forced-carry lines; total → resting center / lay-up**. v1 treats `avg_yards` as the **total (resting) distance** — which is what a GPS-derived or user-typed average represents — and places the zone *center* there. Carry-vs-total split (and a firm/soft roll toggle) is **deferred** (§6) and flagged honestly in-UI ("typical landing — total distance").

**Dispersion (how big the zone is).** Amateur scatter is large and grows with distance. Public working model (well-corroborated): **1 SD ≈ 5% of shot distance, 2 SD ≈ 10%**, applied to both depth and width on a full swing; the pattern is an **ellipse**, **skewed short** (amateurs miss short more than long), and **offset** from the aim line for a habitual fade/draw. v1 dispersion: an ellipse with depth semi-axis ≈ `DISP_SD = 5%` of the club distance (1 SD ring), width similar, with a modest short-skew. No measured per-player variance yet (deferred — needs shot-level data), so the zone is a *model estimate* and is labelled as such. Iron-specific widths (Tour ~10 yd, mid-handicap ~20–30 yd) are rules-of-thumb, not single studies — we do not publish precise dispersion figures.

**Default-distance table (the seed).** No official USGA per-club table exists; the de-facto standard is the large tracked-shot datasets (Shot Scope / Arccos / Trackman, consolidated by public charts). The table is a **gapping profile** (relative spacing between clubs), expressed as a ratio to a reference club (7-iron = 1.0): e.g. Driver ≈ 1.53, 3W ≈ 1.40, 5i ≈ 1.10, 7i = 1.00, 9i ≈ 0.88, PW ≈ 0.79, SW ≈ 0.55. The **absolute scale comes from the user's one known club** (anchor): if they have a real 7-iron at 150, the whole bag scales from it — gender-agnostic, captures the player's actual distance profile. **Only when the user has zero clubs** do we fall back to a handicap-scaled absolute baseline (representative 15-HCP 7-iron ≈ 154 yds, scaled by handicap band) — and that fallback is labelled estimated + nudges the user to set one real distance. (Gender isn't stored, so we never guess a men/women table; anchoring sidesteps it.) Full ratios in the seed module — our own compilation from public datasets, no competitor IP.

**Averaging/trust (for when real data flows — mostly deferred).** Best practice: **trimmed mean of clean shots** (drop both tails, exclude near-pin chips), **rolling window**, **stock not best** (amateurs over-club off a remembered best by ~20+ yd), **tiered confidence by sample size** (<5 estimated · 5–9 building · ≥10 confident), always show "based on N shots." Our schema has no per-club sample count today, so v1 shows real-vs-estimated as a binary (entered vs handicap-seeded); the richer confidence ladder is deferred with the shot-tracking work.

**Honesty guardrails (non-negotiable, from research + our standing rule):**
- Never imply laser precision. Whole-yard "~" values; internal ±5 yd honesty budget on any drawn line.
- Draw a **zone, not a point/arc**, for club landing (a crisp arc over-promises).
- Label the number as an **average/typical**, not "your 7-iron."
- Visual confidence scales to data: estimated/seeded → dashed + translucent + "based on your handicap"; entered → solid.
- Keep **plays-like separate** from the arcs (don't fold wind/elevation into the club zone — it launders model error into the number the player trusts most). Plays-like stays the separate badge we shipped in 3.1.

---

## 3. Slice sequence — each ships independently, builds+lints+checks clean, device-verified

### Slice A — Seed + dispersion model (`lib/clubModel.js`, new, pure)
- `CLUB_GAP_RATIOS` — per-slot gapping ratios vs the 7-iron (our compilation), + a handicap→reference-7i baseline for the zero-club fallback.
- `seedBag(realClubs, handicap)` → fills missing slots: **anchor to the user's nearest real club** via the ratios; if no real clubs, scale from the handicap baseline. Every filled slot `{slot, label, yards, estimated:true}`. No gender param (not stored).
- `mergeBag(realClubs, seeded)` → effective bag: real entries win, seeded fills gaps (every gap labelled estimated).
- `dispersionEllipse(yards)` → `{ depthYds, widthYds }` using `DISP_SD` (5%) + short-skew, for the renderer.
- `clubsForTarget(bag, targetYards)` → the 1–2 clubs that bracket the target (declutter selector).
→ **verify:** node assertions — anchoring to a real 7i scales the bag correctly, zero-club falls back to handicap baseline, real overrides seed, dispersion grows with distance, bracket selector picks the neighbours of a target; putter excluded; no-handicap + no-clubs handled without NaN.

### Slice B — Multi-club zone rendering (`HoleMapGL.jsx`)
- Generalise the single `landing` ring into a `bagArcs` source that renders N club zones along the player→aim bearing: an **ellipse** per club (depth/width from the model), highlighted club solid, others faint; estimated clubs dashed/translucent; per-club label ("7i · ~154y", "est"). Reuse `projectByYards` + add an ellipse polygon generator (extend `ringCoords`).
- Declutter: render only the bracket set by default; the full bag only when explicitly in "show all" — never a wall of rings.
- Teardown nulls all new refs (the marker-vanish lesson from the MapLibre work).
- **Design-audit fixes folded in (2026-06-25):** (1) labels sit in a **dark glass chip** (reuse the existing yardage-pill language) for sunlight legibility over bright NAIP — never raw text on satellite; ≥13px, tabular-nums. (2) **Estimated ≠ opacity-only** (WCAG): dashed outline **+** an "est" text tag, not just translucency. (3) **One accent** — bracket club solid gold `#F5E070`, others muted/outline-only; no rainbow. (4) Fill opacity low (~0.18–0.25) so the hole reads through the zone. (5) Zones render **beneath** the aim line / split pills / puck so they never occlude the live readouts. (6) Animate in on summon; reduced-motion aware.
→ **verify (DOM, not screenshots):** correct number of zone features for a target; estimated styling distinct (dashed + tag, not color-only); switching target/club updates; no orphaned layers on course switch.

### Slice C — Wire bag + seeding into Eagle Eye (`EagleEye.jsx`)
- Compute the effective bag = `mergeBag(myBag, seedBag(myBag, user.handicap))` (handicap from `user.handicap`, verified present; `stats.handicap` is a nicer source if already loaded). Anchor to real clubs; handicap baseline only when the bag is empty + a one-tap "set your distances" nudge — never show nothing.
- Drive the bag-arcs view from the existing BAG toggle / BagSheet (calm default; arcs summoned). Keep the current single-club ring behaviour reachable.
- Surface the "estimated — refines as you set your distances" affordance (no mention of gender; anchored to the user's own club).
→ **verify:** seeded bag shows for an empty/sparse-bag user; real clubs override; arcs declutter to the bracket; distance never blocks.

### Slice D — App-wide tabular-nums sweep — **NOT NEEDED (verify-before-claim catch)**
- Investigated before touching anything: `tokens.css:139` already applies `font-variant-numeric: tabular-nums` to `body` globally, and a `.tm-nums` utility exists (`tokens.css:309`). So "tabular numerals everywhere" is **already in place** — the premium-plan claim was stale and the 3/58 file count was misleading (the body rule covers the rest). A redundant sweep would only add churn. **Skipped, by evidence.**

### Slice E — Verify, audit, ship
`build`+`lint`+`node --check` → reproduce on the **real deployed app** (Claude-in-Chrome, loaded course) → audit-before-claim + design-critique → commit per slice → push → end-of-session wrap (log, trust anchors, notebooklm `verify_failed:0`, preflight).

---

## 4. Risk register — what could go wrong, and the built-in mitigation

| # | Risk | Severity | Mitigation |
|---|---|:--:|---|
| D1 | **Map clutter** — 14 rings/zones bury the hole (the market's #1 complaint) | 🔴 | Declutter to the 1–2 bracket clubs by default; arcs summoned via BAG, never always-on; "show all" is opt-in |
| A1 | **Fake precision** — a crisp arc implies laser accuracy GPS doesn't have | 🔴 | Draw a **zone** sized by the dispersion model; "~" whole yards; "typical/avg" label; ±5 yd honesty budget |
| A2 | **Biased/garbage distances** seeded wrong → "the app is wrong" reviews | 🔴 | Seed from researched skill-anchored table, scaled to a known club; clearly "estimated"; user can edit any club (top incumbent complaint is refusing edits) |
| A3 | **Carry vs total conflation** misplaces zones by up to a driver's roll | 🟡 | Treat `avg_yards` as total → zone center; label "total/typical landing"; carry split deferred + flagged, not faked |
| A4 | **Dispersion over/under-stated** (no per-player variance yet) | 🟡 | Model-based estimate labelled as such; conservative `DISP_SD`; real-variance deferred to shot-tracking; never publish precise figures |
| A5 | **Stale averages** drift with season/gear/age | 🟡 | v1 uses entered values as-is; flag freshness later; rolling-window/trimmed-mean methodology documented for the shot-tracking phase |
| L1 | **USGA legality** — plays-like + club recs are non-conforming in competition (Rule 4.3 / MLR G-5) | 🟡 | **Flagged for a Tournament-Mode follow-up** (disables plays-like + recs); pre-round averages are legal; out of 3.3 build scope but tracked (§6) |
| U1 | **Empty/sparse bag** shows nothing (every competitor's failure) | 🔴 | Handicap-seeded bag → useful hole 1; if no handicap, sane default + "set your distances" nudge; never a blank |
| U2 | **Estimated vs real indistinguishable** → false confidence | 🟡 | Estimated zones dashed/translucent + "based on your handicap"; entered zones solid |
| P1 | **Perf** — many GL layers/labels janks the map over a round | 🟡 | One `bagArcs` source, declutter limits feature count; reuse existing source pattern; no per-frame redraw; null refs on teardown |
| C1 | **Marker/layer leak on course switch** (the prior MapLibre bug) | 🔴 | Null every new ref on teardown; verify no orphaned layers/labels after a switch (DOM check) |
| C2 | **`api.x` / id-coerce / server-only-in-client** repo conventions | 🟡 | Grep `api.` before adding calls; String-coerce id compares; client never imports server-only fns; lint `no-undef` + `node --check` gate |
| V1 | **Visual flow** — zones fight the aim line / split pills / puck | 🟡 | design-critique pass; muted palette, one accent for the bracket club; animate in on summon; reduced-motion aware |

**The three that most decide success:** D1 (clutter — the market's loudest failure), U1/A2 (the empty-state + honest seeding that is our wedge), A1 (zone-not-arc honesty — the accuracy pillar).

---

## 5. Progress checklist

> ☐ not started · ◐ in progress · ☑ done

**Pre-build**
- ☑ Competitive research (UX + data/accuracy) — two agent passes
- ☑ Codebase recon — landing ring, bag model, handicap availability
- ☑ Spec + risk register (this doc)
- ☑ Audit the plan: audit-before-claim (caught the missing gender field → anchor-to-known-club; verified `user.handicap` exists) + design-critique (label chips, dashed+tag estimated state, one accent, opacity, z-order)

**Slice A — model**
- ☐ Default table + `seedBagFromHandicap` + `mergeBag` + `dispersionEllipse` + `clubsForTarget`
- ☐ node assertions green

**Slice B — rendering**
- ☐ `bagArcs` source: multi-club ellipses, highlight/faint/estimated styling, labels
- ☐ declutter to bracket set; teardown nulls refs
- ☐ DOM verification

**Slice C — wiring**
- ☐ effective bag (real + seeded); confirm `user.handicap`; fallback nudge
- ☐ driven by BAG view; estimated affordance; distance never blocks

**Slice D — polish**
- ☐ app-wide tabular-nums sweep + spot-check

**Slice E — ship**
- ☐ build+lint+check; reproduce on real deployed app; audit-before-claim + design-critique
- ☐ commits per slice → push → wrap (log, trust anchors, notebooklm, preflight)

---

## 6. Deferred (flagged, not silently dropped)

- **Tournament Mode** (USGA Rule 4.3 / MLR G-5) — a toggle disabling plays-like + club recommendations for competition legality; affects 3.1 too. Near-term follow-up.
- **Measured dispersion** from shot-history variance (real ovals, not modelled) — needs shot-level tracking + variance calc.
- **Carry vs total split + firm/soft roll toggle** — needs a roll model and/or launch-monitor carry input.
- **Sample-size confidence ladder** (<5 / 5–9 / ≥10, "based on N shots") — needs a per-club shot count in the schema.
- **Draggable target → which clubs cover it** (the premium interaction) — natural next iteration once zones render.

---

*Sources: two competitive-research passes this session (UX patterns + data/accuracy) citing public tracked-shot datasets (Shot Scope, Arccos, Trackman consolidations), strokes-gained/strategy authorities (Broadie, Fawcett/DECADE), USGA Rules 4.3 / MLR G-5 + DMD FAQ, gps.gov accuracy, and shipping-app docs; codebase recon of `tm_user_clubs`, `routes/clubs.js`, `EagleEye.jsx` (ClubToggle/BagSheet), `HoleMapGL.jsx` (landing ring). Competitor products referenced generically per the OpenScaffold naming rule.*
