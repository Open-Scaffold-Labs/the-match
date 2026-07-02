---
type: synthesis
created: 2026-07-02
updated: 2026-07-02
tags: [the-match, eagle-eye, range-rings, dispersion, build-spec, phase-2-5, accuracy]
---

# Range-Rings + Club-Arc Dispersion Bands — Bulletproof Build Spec

Closes the two "accuracy refinements on the shipped GPS gate" residuals from the premium
plan: the **held concentric range-rings (2.5)** and **club-arc dispersion bands**. Companion
to `own-club-arcs-3.3-build-spec-2026-06-25.md` (whose dispersion model shipped but was
never wired to the renderer) and `eagle-eye-premium-plan-2026-06-23.md`.

> **North Star:** usability, accuracy, visual flow. This slice's thesis: **honest zones,
> not fake-precise circles** — and rings done the way the market actually validates, not
> the way the 2.5 line item originally imagined them.

---

## 1. What the research changed (agent, 2026-07-02, cited in session log)

The 2.5 rings were "held pending a live-map clutter check." The competitive research
delivered that check's answer:

- **Nobody ships always-on concentric rings from the player.** The market splits into one
  arc for one decision (Garmin driver arc), opt-in fixed **layup arcs to the green**
  (TheGrint GPS 2.0: 100/150/200/250, toolbar-toggled, persisted), and club-anchored arcs
  (GolfLogix/18Birdies/Hole19, premium-gated). Clutter is the #1 vendor-confessed failure.
- **Dispersion leaders (Arccos, Shot Scope/DECADE) render one club's soft cone/zone at a
  time**, from real data where available; crisp boundaries = false precision. 18Birdies
  uses a user-declared accuracy baseline when data is thin.
- Cartography best practice: stroke-only rings, thin dark-halo labels ≥4.5:1, never fill
  ring interiors, feather dispersion edges.

**Decision:** rings ship as **green-anchored layup arcs (100/150/200/250), opt-in via a
persisted RINGS toggle** — the market-validated semantic ("what do I leave myself?") —
NOT player-centered concentric circles. Dispersion ships as **one soft zone at a time**.

## 2. The accuracy bug this fixes

`HoleMapGL.redrawAim()` draws the selected-club landing zone as `ringCoords(landing, 11)`
— a **fixed 11-yard circle**, same for a lob wedge and a driver. Meanwhile
`clubModel.dispersionEllipse()` (1 SD ≈ 5% of distance, short-skew 1.3, 4-yd floor —
sourced in the 3.3 spec) shipped 2026-06-25 and **is not imported by the renderer**. The
zone the user sees today asserts a precision that isn't real and doesn't scale with club.

## 3. Build slices

### S1 — `lib/mapOverlays.js` (new, pure, unit-tested)
- `projectPoint(start, bearingDeg, yards)` (pure copy of the proven local helper —
  additive; does NOT touch geo.js or HoleMapGL math).
- `dispersionZonePolygon(landing, bearingDeg, {depthYds, widthYds, shortSkew})` → ellipse
  ring (48 pts), long axis along the shot line, **short-side semi-axis × shortSkew**
  (amateurs miss short more than long — the zone must extend TOWARD the player).
- `arcBandPolygon(center, bearingDeg, radiusYds, {depthYds, shortSkew}, halfDeg)` →
  annular sector between `radius − depth×skew` (inner) and `radius + depth` (outer) —
  the highlighted club's dispersion band in ARCS mode.
- `layupRingsInPlay(distToGreenYds)` → subset of [100,150,200,250] with ring ≤ dist − 15.
- New test file wired into the client `test` script.
→ verify: node --test — skew extends inward not outward; polygon closes; rings filter
  (par-3 160y + GPS 140 → none in play from player; 435y → all four).

### S2 — `HoleMapGL.jsx` renderer (additive; distance math untouched)
- **Token bridge** (the Phase-4.3 HoleMapGL pattern, established here): `eeColor(name,
  alpha?, fallback)` reads `--tm-ee-*` via `getComputedStyle` at layer-creation (MapLibre
  paint does NOT resolve CSS `var()`). Literal fallbacks so a failed read can never blank
  a layer. New layers only — existing layer literals untouched (no drive-by).
- **Landing zone** → `dispersionZonePolygon` replaces the fixed 11-yd circle; softer
  paint (lower fill opacity + blurred outline, no crisp 2.5px line); label gains the
  honesty tilde: `Driver · ~230y`.
- **ARCS mode**: new `bagArcBand` source/fill under the arc lines — the **highlight club
  only** gets its band (annular sector, feathered edges via low-opacity fill + blurred
  edge lines). Other clubs stay thin lines.
- **Layup rings**: new `rangeRings` source + stroke-only lines (white ≈ raw-distance
  semantic, ~1.5px, low opacity, subtle dark under-glow for fairway legibility) swept
  around the green→player bearing; small dark label chips ("150") at the arc's right end.
  Added below the club layers in z-order. Drawn only when toggled on AND in play.
- Cleanup: new marker refs nulled in the existing unmount block.

### S3 — `EagleEye.jsx` RINGS toggle
- Third pill on the right control rail (above ARCS, same glass style, tokens):
  `RINGS`, `aria-pressed`, persisted `localStorage['tm-eye-rings']`, passed as a prop.
- Default **off** (research: opt-in is the category-correct default; empty map stays clean).

### S4 — Gates + audits + ship
- lint + build + geo.test 31/31 + full `npm test` (incl. new S1 tests) per slice.
- audit-before-claim on all claims; design-critique pass on the rendered overlay specs.
- Wiki log + this spec's checklist + handoff updated; push to `main` (beta).

## 4. Risk register

| # | Risk | Sev | Mitigation |
|---|------|-----|-----------|
| D1 | False precision — crisp zone edge / decimals | 🔴 | Feathered fills, no hard outline, `~` whole yards, zone labeled by club only, never a dispersion figure on screen |
| D2 | Clutter (the market's #1 failure) | 🔴 | One club's band at a time; rings opt-in + persisted OFF; stroke-only rings; ≤4, in-play filtered |
| D3 | Skew rendered the wrong way (zone extends long) | 🟠 | S1 unit test asserts inner > outer extension; geometry pure + testable |
| D4 | MapLibre paint can't resolve CSS var() | 🟠 | `eeColor` getComputedStyle bridge + literal fallbacks (never a blank layer); pattern documented for the Phase-4.3 HoleMapGL slice |
| D5 | Touching load-bearing distance math / teeOffset | 🔴 | Additive only; geo.test 31/31 gate; no edits to redrawAim's yardage lines |
| D6 | Perf regression on drag (per-frame redraw) | 🟡 | Geometry is trivial (≤4×34 + 48 pts/frame); no new timers; sources setData in the existing redraw path |
| D7 | Ring labels collide with arc labels when both on | 🟡 | Ring chips at right arc end (bag labels default left); accepted v1 residual, note for device pass |
| D8 | Marker leaks on course switch | 🟡 | New refs added to the existing null-out cleanup block |
| D9 | Untrusted GPS skews ring bearing | 🟢 | Bearing-only cosmetic use (existing landing-ring pattern); quoted numbers still gated by GPS_ACCURACY_GATE_M |

**Rollback:** each slice its own commit; rings behind the user toggle (default off) are
also a behavioral off-ramp.

## 5. Progress checklist

**Planning**
- [x] Competitor research (agent, cited) — 2026-07-02
- [x] Spec grounding: premium 2.5 hold-reason, 3.3 dispersion model, HoleMapGL pipeline — 2026-07-02
- [x] This spec + risk register
- [x] S1 lib/mapOverlays.js + 6 unit tests (skew-direction asserted — D3 closed) — 2026-07-02
- [x] S2 HoleMapGL renderer (zone, arc band, rings, eeColor token bridge w/ fallbacks) — 2026-07-02
- [x] S3 EagleEye RINGS toggle (persisted `tm-eye-rings`, default off, control rail) — 2026-07-02
- [x] S4 gates green (lint ✓ build ✓ geo 31/31 ✓ tests 10/10 ✓) → design-critique vs the
      research do/don't list (all "do"s ✓ except zoom-declutter = accepted v1 residual;
      zero "don't"s violated) → **SHIPPED `d904347` to `main`** — 2026-07-02
- [x] Self-review catch: `clearAll()` in redrawAim now clears rangeRings + bagArcBand +
      ring chips so nothing survives a hole with missing tee/green data
- [ ] On-device pass (Matt, on the beta): clutter check with ARCS+RINGS both on, band
      reads as a zone not a target, rings legible over bright fairway. Also note: the
      RINGS/ARCS pills share the existing ~33px rail height (below the 44px ideal —
      pre-existing rail convention; revisit in Stage C if it bothers on device).

## 6. Scope guardrails

- No dispersion FIGURES on screen ever (no "±", no yard-width numbers) — standing rule.
- Entered bag data only — no fabricated distances (3.3 correction, Matt).
- No always-on overlays added; default map stays exactly as it is today.
- No edits to distance math, teeOffset, geo.js internals, or existing layer paint.

## Sources
- Agent research report 2026-07-02 (TheGrint GPS 2.0, Garmin manuals, Shot Scope
  MyStrategy, Arccos AI Strategy, 18Birdies dispersion, GolfLogix arcs; cartography:
  Dawson/Peterson/ESRI halo practice) — full cites in session log.
- `own-club-arcs-3.3-build-spec-2026-06-25.md` §dispersion model + risk A1/A4.
- `build-plan-bulletproof-2026-06-23.md` 2.5 hold note; `next-session-handoff-2026-07-02.md`.
- Live reads: `client/src/pages/HoleMapGL.jsx`, `client/src/lib/clubModel.js`.
