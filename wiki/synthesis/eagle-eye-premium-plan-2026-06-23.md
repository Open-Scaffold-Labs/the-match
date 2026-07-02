---
type: synthesis
created: 2026-06-23
updated: 2026-07-02
tags: [the-match, eagle-eye, roadmap, build-plan]
---

# The Match — Premium Look & Eagle Eye Upgrade Plan

*Design audit + competitive research + prioritized roadmap. Prepared 2026-06-23.*
*Competitors referred to generically throughout (per the no-competitor-names rule).*

---

## 1. The thesis (where we win)

The category leaders each own **one** signature "wow" — a deep AI caddie + shot-tracking platform; a 3D-flyover-and-AR app; an all-in-one with the deepest plays-like panel; a no-subscription hardware play. **None** combine all four of these at once:

1. A **premium-looking, generous, ad-free free rangefinder** (rivals paywall the good stuff and stuff free tiers with ads/in-round pop-ups).
2. **Glanceable, large-type legibility** (the loudest "cheap" tells in the category are tiny fonts and one-chart-per-page clutter — golfers read this mid-round, in sun, often older eyes).
3. **Transparent, adjustable plays-like as the free default** (best science is hidden behind hardware+subscription; best UX is paywalled).
4. **Genuinely crafted polish** — haptics, motion, map cinematics, considered loading/empty states. Most rivals feel *functional*, not *crafted*.

**Eagle Eye is the hero surface that anchors all four.** The plan below makes it look obviously more expensive and high-tech than rivals, then carries that polish across the app.

---

## 2. Honest design critique — Eagle Eye today

The current screen is already **above the category's floor**: satellite map, course-up bearing, draggable aim point, tap-to-measure, F/C/B distances, a plays-like number, a glassy dark HUD, and intentional (not gratuitous) animation. That's a real foundation. But against a "looks expensive / high-tech" bar, here's where it falls short.

**First impression (2 seconds).** The landing hero (spinning dual-ring crosshair + "Know Every Yard. Play Every Shot.") is good. But the *actual* rangefinder — the thing that has to feel like a $400 instrument — currently reads as "a satellite map with a dark info card in the corner," not a designed HUD.

**Usability / hierarchy.**
- The hero distance (36px number in a corner card) doesn't dominate the way it should. On rival flagships the distance *is* the screen.
- Multiple floating controls (ANALYZE pill bottom-left, BAG toggle right edge, hole strip up top, yardage card top-left) compete without a clear spatial system.
- "Plays-like" exists but isn't transparent/adjustable — the single biggest unmet need in the category is a hero plays-like number you can break apart (wind / elevation / temp) and override.

**Visual maturity — specific tells holding it back:**
- **Raster satellite tiles** (ESRI via Leaflet). Soft on a 2× phone screen; reads as a "cheap embed" next to vector/3D-cartography rivals. *This is the #1 premium signal in the whole category and our weakest link.*
- **No cinematic map motion.** Holes pan/zoom; rivals fly *down the fairway at a pitch angle* on tee-up. That one move is the biggest perceived-quality lever available.
- **System fonts only**, no tabular-figure discipline everywhere, no "instrument" numerals for the hero distance.
- **Flat shadows / hardcoded colors** in Eagle Eye (190+ inline styles, not using the design tokens; dark theme is bespoke per element). Brittle and inconsistent.
- **Spinner/"Loading…" text**, no skeletons; no haptics; no number-roll on the live distance.

**Accessibility.** Some small text (e.g., 8px labels) on low-opacity overlays is borderline for contrast/legibility — and legibility is a *competitive feature* here, not just compliance.

**Verdict:** the aesthetic instincts are sound; the *execution* is mid-tier. The gap to "expensive" is closeable with focused work, and most of it is concentrated in the map + the hero readout.

---

## 3. The upgrade plan (phased, prioritized)

Ordered by **perceived-quality gained per hour**. Phase 0 is mostly find-and-replace and moves the needle most for least code. Each phase ships independently and is build/lint-verified per our beta discipline.

### Phase 0 — Foundation: the "expensive in an afternoon" pass (app-wide)

> **STATUS — PARTIAL** (code-verified 2026-07-02; spec: `phase0-foundation-build-spec-2026-06-30.md`). The primitives are in the codebase; the app-wide sweep + inline-style→token refactor (Phase 3 below / build-plan Phase 4.3) are NOT done. Per item: **(1) tabular numerals ☑** (verified app-wide, `tokens.css:145-146,323`). **(2) elevation + layered shadows ◐** — `--tm-shadow-layered` token + utility exist (`tokens.css:92,331`), but app-wide application unverified. **(3) palette tells ◐** — pure-`#fff`/`#000` sweep not confirmed. **(4) motion discipline ◐** — reduced-motion block present (`tokens.css:360`); full vocabulary conversion unverified. **(6) grain overlay ◐** — present on the Eagle Eye hero (`EagleEye.jsx:2014`), not confirmed on all dark surfaces. **(5) type system — DROPPED by decision** (Matt, 2026-06-30): keep the system SF Pro stack; instrument feel from size/weight/tabular + depth/motion/grain, not a typeface (removes the WKWebView font-loading risk). ⚠ The spec §7 checklist shows these `☐` and the 06-30 log says "C/D/F deferred," but the code shows the primitives landed — code above is ground truth; finish the app-wide application in Phase 3 / build-plan Phase 4.3.

These are the 80/20 wins. Low risk, high visible payoff, set the system the rest builds on.

1. **Tabular numerals on every live number** (`font-variant-numeric: tabular-nums`) — distances, scores, timers. One line; stops numbers "dancing" as they update. Highest ratio on the list.
2. **Real elevation + layered shadows.** On dark surfaces, elevation = *lighter surface*, not shadow (base `#0A0A0A`/our `#070C09` → tiered lighter surfaces). On light surfaces, replace single grey `box-shadow`s with stacked hue-tinted shadows (one consistent light direction). New tokens.
3. **Fix the palette tells:** never pure `#000` or pure `#FFF` text; desaturate accents for dark mode; verify AA contrast at each elevation. Mostly token edits.
4. **Motion discipline:** animate only `transform`/`opacity`, 200ms ease-out (`cubic-bezier(0.4,0,0.2,1)`) as the default; springs for gesture-driven moves. Makes existing motion feel intentional, kills jank.
5. **Type system:** adopt one UI sans + one mono/tabular face (strong free options exist), a single derived type scale, em-based tracking, optical sizing. The mono/tabular face becomes the "instrument" numerals for Eagle Eye.
6. **Faint grain overlay** (~8% SVG noise) on dark surfaces — removes the "flat digital" look and gradient banding.

### Phase 1 — Eagle Eye becomes the hero instrument

The showcase. This is where we visibly pass rivals.

1. **Move the map to vector + hybrid satellite (MapLibre GL).** Free, no token, premium by default: crisp vector geometry at any zoom, a **custom branded style** in our green/gold palette, satellite base with transparent vector fairway/green overlays. Retires the soft raster look. *Biggest single visual upgrade in the plan.*
2. **Cinematic hole intro:** one `flyTo` on tee-up — look down the fairway at a pitch angle (bearing tee→green, pitch ~70°), ~3.5s, reduced-motion-aware. The category's biggest "wow" for ~10 lines.
3. **Redesign the hero distance as an instrument:** large tabular/mono numeral with an **animated number roll** (odometer) + a **270° SVG arc gauge** driven by the *same spring* as the number. The distance becomes the screen, not a corner card.
4. **Premium glass HUD:** proper glassmorphism (blur + saturate + the inset top-rim highlight that actually sells it), one coherent spatial system for the floating controls instead of four competing islands.
5. **Yardage arcs from Turf.js geometry** (true ground distance, not screen-pixel circles), a **smoothly-lerped player puck** (rAF interpolation between GPS fixes, not teleporting), and a clean center reticle.
6. **Skeletons instead of "Loading…"**, plus tasteful haptics where the platform allows (Android; iOS web has none — design so haptics are never the only feedback).

### Phase 2 — Signature features that *leapfrog* (not just match)

> **Status (updated 2026-07-02):** #1 transparent adjustable plays-like, #3 own-club distance arcs, and #5 data→practice loop are **SHIPPED** (build-plan Phase 3.1/3.3/3.5). The **handicap & scoring-accuracy track** shipped (gender foundation, gender-correct ratings, Course Handicap, a WHS-faithful index rewrite, 9-hole/solo fixes) — `handicap-accuracy-audit-2026-06-25.md`. And the entire **F.5 "never lose your round" data-model rework is COMPLETE** (S1–S7 live: OCC, idempotent offline, guests→rows, row-derived readers, designated-scorer mode, rows-as-sole-store) — `build-plan-bulletproof-2026-06-23.md` Track F.5. **So scoring reliability (thesis pillar) is now best-in-class.** Remaining leapfrogs: #2 ad-free generous free tier, #4 green slope+putt-line, #6 clean AR. **UPDATE 2026-06-30 → 07-02: Phase 0 foundation is PARTIAL** (tabular numerals verified app-wide; layered-shadow token + grain-on-hero + reduced-motion primitives in code, but the app-wide sweep + inline-style→token refactor are open = Phase 4.3; custom-font item dropped by decision — keep SF Pro), and Eagle Eye accuracy advanced materially — the **plays-like coefficients were rebuilt to sourced values + a carry cap**, **Option B aim-retarget** shipped, and the **on-map segment distances were corrected to true great-circle math** (Matt verified accurate on-course). **The remaining VISUAL-FLOW + ACCURACY-polish layer:** Phase 3 app-wide polish + the Eagle Eye 190+ inline-style → token refactor (still NONE done; = build-plan Phase 4), plus accuracy refinements on the shipped GPS gate — club-arc dispersion bands, battery discipline/instant-on, the held concentric range-rings. **NOTE (marketing rule):** do **not** build a graded/±-margin confidence chip — showing an error figure anywhere was ruled out (Matt, 2026-06-30). See `next-session-handoff-2026-07-02.md`.

Each maps to a documented category gap. Sequence by appetite.

1. **Transparent, adjustable plays-like — free.** Hero plays-like number you tap to expand into wind / elevation / temperature, each individually overridable (slider + draggable compass). Best science is hidden behind hardware+sub elsewhere; best UX is paywalled. Shipping it free + transparent beats both.
2. **A genuinely generous, ad-free free rangefinder.** No in-round pop-ups, no paywalled tap-to-measure. This is the clearest wedge — it makes us feel radically more generous than every incumbent on day one.
3. **Distance arcs drawn from the player's *own* club averages** rendered on the map — personal, data-driven, visually rich (ties into the existing bag/club model).
4. **Pro-grade green view:** slope/break shading and a putt-line, ideally backed by a credible contour data source.
5. **The data → practice loop nobody closes:** turn on-course Eagle Eye + shot data into structured practice/range sessions. The biggest category-wide unmet need — a true differentiator.
6. **AR live-camera distance overlay, done cleanly** (we already have a camera/scan flow to build on) — currently the top-of-market flex.

### Phase 3 — App-wide premium polish

Carry Eagle Eye's bar across every screen.

- **Skeletons** on all content/map loads; **view-transition** page morphs where supported.
- **Performance as polish:** RAIL budgets (100ms input, 60fps), `content-visibility:auto` on long scorecards/history (measured ~7× render win), optimistic UI on score entry. Perf *is* premium.
- **Score-entry micro-interactions, empty states, first-run animation** — the crafted details rivals skip.
- **Consolidate Eagle Eye's 190+ inline styles** into a small `<Sheet>`/HUD component set on tokens — pays down the brittleness the audit flagged and keeps the new look consistent.

---

## 4. Effort vs. impact — recommended sequencing

| Phase | Effort | Visible impact | Risk |
|---|---|---|---|
| 0 — Foundation tokens/type/motion | Low | High (whole app feels tighter) | Low |
| 1 — Eagle Eye hero (MapLibre, flyTo, arc gauge, glass HUD) | Med–High | **Highest** (the showcase) | Med (map migration) |
| 2 — Leapfrog features (plays-like, free rangefinder, own-club arcs, greens, practice loop, AR) | High | High + strategic moat | Med–High |
| 3 — App-wide polish + refactor | Med | High (consistency) | Low–Med |

**Recommendation:** do **Phase 0 first** (fast, derisks everything), then the **MapLibre + cinematic flyTo + instrument hero distance** slice of Phase 1 as the flagship demo, then pick Phase 2 features by appetite. The map migration is the one genuinely meaty engineering item and the single biggest look upgrade — worth staging carefully (keep the current Leaflet path behind a flag until the MapLibre path is device-tested).

---

## 5. Decisions I need from you

1. **Scope of the first build** — Phase 0 only (quick, safe, whole-app lift), or Phase 0 **+** the Eagle Eye map/hero slice (the flagship)?
2. **Map migration appetite** — green-light moving off raster Leaflet to vector MapLibre? It's the biggest look win but the biggest single change.
3. **Free vs. paid line** — are we committing to "generous, ad-free, plays-like-included free tier" as the strategic wedge? It shapes what goes where.
4. **Which Phase 2 leapfrog** excites you most (transparent plays-like / own-club arcs / green slope+putt-line / data→practice loop / AR) — I'll sequence around it.
5. **Brand fonts** — OK to introduce a UI sans + mono "instrument" pair (free web fonts), or keep system fonts?

Give me direction on these and I'll turn the chosen slice into a concrete, build-ready spec and start shipping it through the beta with the same test-and-audit discipline as today.
