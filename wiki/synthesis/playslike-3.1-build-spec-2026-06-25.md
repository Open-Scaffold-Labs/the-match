---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, eagle-eye, plays-like, elevation, build-spec, phase-3]
---

# The Match — Phase 3.1 Build Spec: Transparent, Adjustable Plays-Like (with real DEM elevation)

*Build-ready spec. Prepared 2026-06-25. Companion to `build-plan-bulletproof-2026-06-23.md` (the phased plan) and `eagle-eye-premium-plan-2026-06-23.md` (the design vision).*

> **The bar (Matt, this session):** become the biggest name in golf apps *worldwide*. To get there this feature must be perfected on three axes — **usability, accuracy, visual flow.** Nothing ships that isn't device-verified and audit-clean. Build it better now; don't defer what can be done right.

---

## 1. What we're building (and why it wins)

The single biggest documented gap in the category: the best plays-like science is hidden behind hardware + subscriptions; the best plays-like UX is paywalled. **We ship a transparent, adjustable plays-like as the free default.** Tap the live yardage's "plays like" readout → a glass bottom sheet breaks the number into its causes (wind / elevation / temperature), each labeled with its auto-derived value and each individually overridable. The golfer sees *why* 247 plays as 252, and can correct any factor we got wrong.

Two halves:
- **Transparency** — show the breakdown, not just a total. Trust comes from seeing the work.
- **Adjustability** — let the golfer override any factor (the wind gusted, the pin's cut back). Auto values are labeled "auto"; an override is labeled "manual" with one-tap reset.

The differentiator inside the differentiator: **elevation is auto-derived for real**, from a terrain model (USGS 3DEP, 1 m, verified working 2026-06-25), not a manual guess. Most free apps can't do uphill/downhill at all.

---

## 2. Accuracy model — the math, stated precisely

`computePlaysLike(baseYds, opts)` currently models three additive terms and returns `{ plays, adj }`. We extend it to **return the per-factor split** and **add an elevation-change term**, fully backward-compatible.

| Term | Physical effect | Sign convention | Source |
|---|---|---|---|
| **Wind** | Headwind plays longer, tailwind shorter; crosswind partial via `cos(θ)` where θ = shotBearing − windFromDeg | + headwind / − tailwind | open-meteo `wind_speed_10m`, `wind_direction_10m` |
| **Temperature** | Cold air is denser → ball flies shorter → plays longer | + when colder than 70°F | open-meteo `temperature_2m` |
| **Altitude (ASL)** | Thinner air at altitude → ball flies farther → plays shorter | − at higher ASL | GPS `alt` or barometric from `surface_pressure` |
| **Elevation (NEW)** | Target higher than ball (uphill) → ball must climb → plays longer; downhill shorter | + uphill / − downhill | DEM delta: `targetElevFt − playerElevFt` |

**Critical distinction (not double-counting):** *Altitude (ASL)* is the absolute height where you're playing (Denver vs sea level → air density). *Elevation (NEW)* is the **delta** between target and ball (uphill/downhill ball flight). A Denver uphill shot legitimately gets both: thinner air (shorter) **and** uphill climb (longer). Both terms coexist.

**Elevation magnitude (tunable constant, documented, not over-claimed):** uphill/downhill is applied as `elevation_yds ≈ elevDeltaFt × K_ELEV`. We start with a defensible, conservative constant and expose it as a named constant so it can be tuned against on-course truth. We will **not** advertise a precision figure (per the marketing stance in the bulletproof plan — never publish an error margin, never claim "laser").

**Return shape (new):**
```
{ plays, adj, base, factors: { wind, temp, alt, elevation } }   // each factor rounded yards, signed
```
`plays` and `adj` stay byte-identical to today so nothing downstream breaks.

---

## 3. Slice sequence — each ships independently, builds+lints clean, device-verified before the next

### Slice A — Math foundation (`lib/geo.js` + `EagleEye.jsx` mirror)
Extend `computePlaysLike` in **both** copies (they are an intentional mirror — the `lib/geo.js` header says so; diverging them is a latent bug). Add the elevation term + factor split. Add a small node-run assertion harness covering: headwind > 0, tailwind < 0, crosswind ≈ partial, cold > 0, hot < 0, uphill > 0, downhill < 0, all-zero → adj 0, factor sum ≈ adj.
→ **verify:** `node` runs the assertions green; existing `plays`/`adj` outputs unchanged for the current call sites.

### Slice B — Cached DEM elevation service (server + migration 029)
- Migration `029_tm_elevation_cache.sql`: `(lat_round, lon_round, elevation_ft, source, fetched_at)`, PK on rounded coords. Append-only; apply by hand on Matt's Mac (`psql $DATABASE_URL -f`).
- Server route `GET /api/eagle-eye/elevation?lat=&lon=` (grep first for `api.` namespace collisions): rounds coords to ~5 dp (~1 m), L1 in-memory + L2 Supabase cache (mirrors the OSM-cache pattern from 1.2), provider abstraction `getElevation(lat, lon, { provider })` with `usgs` (EPQS, US, 1 m) default and an `open-meteo` worldwide fallback stub.
- **Validation gate:** reject any out-of-range/sentinel value (EPQS's exact no-data format for ocean/off-grid is **to be confirmed in this slice** — gate on a sane absolute range so it's robust regardless), return `null` elevation rather than a wild number. Elevation is static per coordinate → cache effectively forever.
→ **verify locally:** cold call → row persisted → warm call cache-hit (ms); ocean/non-US coord → graceful `null`, no crash; `node --check` on the route.

### Slice C — Wire elevation into the live model (`EagleEye.jsx`)
- Throttled fetch (like the weather throttle) of **player** elevation (by rounded live position) and **target** elevation (green/aim — same target the distance uses), compute `elevDeltaFt`, feed into `computePlaysLike`.
- **Hard rule:** the distance number and every existing readout must **never block on or break from** elevation. Missing elevation (non-US, no-data, fetch fail) → the elevation factor is simply absent; wind/temp still compute.
→ **verify:** DOM/console (not screenshots — they cache stale per the 6-24 lesson); elevation factor appears for a US course, absent + non-fatal for a fabricated non-US coord.

### Slice D — `PlaysLikeSheet` + tappable HUD chip (`EagleEye.jsx` / new component)
- Replace the 8px `PLAYS` row with a legible, obviously-tappable chip coupled to the hero distance (`PLAYS LIKE 252 ▸`). Always shown on trusted distance + conditions (including the +0 case — a vanishing tap target is a bad tap target).
- Bottom sheet (native-iOS pattern): base yardage → Wind / Elevation / Temp rows. Each row: auto value + "auto" tag; tap to override → slider (temp), stepper (elevation ft), speed + draggable direction dial (wind); overridden rows show "manual" + reset. Footer: **the total plays-like as the sheet's hero** — large tabular numeral, factor rows visually secondary to it.
- **Design-audit fixes folded in (2026-06-25):** (1) **wind dial is shot-relative, not compass-north** — headwind at top (into your face), matching the course-up map + golfer intuition; (2) **"manual" state uses a badge/icon, not color alone** (WCAG — never color-only); (3) reuse the existing PLAYS color tokens (warm `#F0A868` = plays longer / green `#5ED47A` = shorter) so the sheet speaks one language; (4) **no sub-~13 px labels** — the 8 px tell is the thing we're removing; (5) iOS **grabber handle** as the swipe-dismiss affordance.
- Reduced-motion aware (existing pattern), all controls ≥ 44 px, `font-variant-numeric: tabular-nums` on every number, swipe-down + scrim-tap dismiss.
- **Override lifecycle:** overrides reset when the hole changes (a stale manual wind silently corrupting hole 12 is a real trust bug). Active overrides are visually unmistakable while they apply.
→ **verify:** design-critique pass; on Matt's iPhone — open/dismiss feel, legibility in daylight, override + reset, no map occlusion of markers.

### Slice E — Verify, audit, ship
`npm --prefix client run build` + `lint` + `node --check` on changed server files → individual commits per slice → push to `main` (beta) → Matt device-tests → `audit-before-claim` + `design-critique` on the result before "done." End-of-session: `wiki/log.md`, trust-anchor refresh (CLAUDE.md/index.md), `notebooklm-wiki-refresh.py` (`verify_failed: 0`), preflight green.

---

## 4. Risk register — what could go wrong, and the built-in mitigation

Sorted by threat to **accuracy / usability / trust**.

| # | Risk | Severity | Mitigation (built in from the start) |
|---|---|:--:|---|
| A1 | **Elevation sign backwards** (uphill shown as shorter) — destroys trust instantly | 🔴 | Single documented sign convention (`target − player`, + = uphill = longer); unit assertion in Slice A locks it; device sanity check on a known uphill hole |
| A2 | **Unit mismatch** (feet vs yards vs meters) → silent 3× error | 🔴 | EPQS queried in feet explicitly; one conversion point; assertion + a logged worked example |
| A3 | **DEM returns no-data sentinel** for ocean/off-grid/non-US and we render a wild number | 🔴 | Absolute-range validation gate in Slice B → `null`, never a fabricated yardage; non-US drops the term. (Exact EPQS no-data format unconfirmed — gate is range-based so it holds regardless) |
| A4 | **Elevation constant over/under-states** the effect | 🟡 | Conservative tunable `K_ELEV`, documented; no advertised precision; tune against on-course truth post-launch |
| A5 | **Double-counting ASL altitude and elevation delta** | 🟡 | Explicitly separate physical terms (§2); ASL uses absolute height, elevation uses target−player delta |
| P1 | **Querying USGS on every GPS fix** → latency, rate-limit, cost | 🔴 | Throttle + cache by rounded coord (player moves slowly within a hole); target elevation fetched once per hole |
| P2 | **USGS EPQS slow/down** (gov service) blocks the round | 🔴 | Server L2 cache; elevation never blocks the distance; term simply absent on failure; self-recovers |
| P3 | **iOS memory over a 4-hr round** (uncatchable reload) | 🟡 | No new map instances/canvases; sheet is one lightweight DOM node mounted on demand; release on close |
| U1 | **Sheet traps the user / occludes the map mid-round** | 🔴 | Bottom sheet never auto-opens; swipe + scrim dismiss; map stays visible above; markers not occluded (the top-left instrument stays put) |
| U2 | **Sticky overrides silently corrupt later holes** | 🔴 | Overrides reset on hole change; "manual" badge while active; one-tap reset per factor |
| U3 | **Tap target vanishes** when conditions flicker | 🟡 | Chip shown on trusted distance + conditions incl. +0; debounce the conditions presence |
| U4 | **Numbers dance / reflow** as they update | 🟢 | tabular-nums everywhere (existing discipline) |
| U5 | **Touch targets too small / low contrast in sun** | 🟡 | ≥44 px controls; AA contrast at each glass elevation; legibility is a competitive feature here |
| V1 | **Sheet motion janky / not reduced-motion aware** | 🟡 | transform/opacity only, 200 ms ease-out; honor `prefers-reduced-motion` (existing pattern) |
| C1 | **Mirror divergence** — extend one `computePlaysLike`, not both | 🔴 | Slice A edits both copies identically with a cross-reference comment; assertion runs against both |
| C2 | **`api.x` vs `api.x.y()` namespace shadowing** | 🟡 | grep the `api.` surface before adding the elevation call (standing repo convention) |
| C3 | **Server-only fn leaks into client bundle** (the `estimateAltFromPressure` ReferenceError class) | 🔴 | Client fetches elevation via the API only; `lint` `no-undef` + `node --check` gate before push |
| C4 | **Migration edited in place / not applied** | 🟡 | New numbered file 029, append-only; applied by hand on Matt's Mac; db.js schema check updated if needed |
| W1 | **Worldwide ambition vs US-only DEM** — USGS is US-only | 🟡 | Provider abstraction from day one; US = USGS (1 m, matches NAIP launch); non-US = open-meteo DEM (90 m) **stubbed** now, wired when worldwide imagery lands; non-US gracefully shows wind+temp, elevation overridable-manual |
| W2 | **open-meteo elevation contract UNVERIFIED** (timed out 2026-06-25) | 🟡 | Treated as unverified — must confirm contract before wiring the non-US path; not on the US launch path so not a launch blocker |

**The three that most decide success:** A1/A3 (elevation honesty — a wrong or fabricated elevation number is worse than none), U1/U2 (the sheet must never trap the user or silently corrupt later holes), C1/C3 (the boring repo-convention bugs that have bitten this codebase before).

---

## 5. Progress checklist

> ☐ not started · ◐ in progress · ☑ done

**Pre-build**
- ◐ Spec + risk register written (this doc)
- ☐ Audit the plan: `audit-before-claim` over claims + `design-critique` over the sheet design

**Slice A — Math**
- ☐ Extend `computePlaysLike` in `lib/geo.js` (factor split + elevation term)
- ☐ Mirror the change in `EagleEye.jsx` (keep copies identical)
- ☐ node assertion harness green (sign / magnitude / zero / factor-sum)

**Slice B — DEM elevation service**
- ☐ Migration `029_tm_elevation_cache.sql` written + applied by hand
- ☐ `GET /api/eagle-eye/elevation` with USGS provider + validation gate
- ☐ L1 + L2 cache; provider abstraction; open-meteo stub
- ☐ verify cold→DB→warm + graceful null on bad coord

**Slice C — Live wiring**
- ☐ Throttled player + target elevation fetch by rounded coord
- ☐ `elevDeltaFt` fed into `computePlaysLike`; distance never blocks
- ☐ verify via DOM/console (US present, non-US absent + non-fatal)

**Slice D — Sheet + chip**
- ☐ Tappable `PLAYS LIKE ▸` chip replaces the 8px row; always shown on trusted distance+conditions
- ☐ `PlaysLikeSheet`: base → Wind/Elevation/Temp rows, overrides + reset, total
- ☐ Reduced-motion, 44px targets, tabular-nums, swipe/scrim dismiss, overrides reset on hole change
- ☐ design-critique pass + Matt device test

**Slice E — Ship**
- ☐ build + lint + node --check clean
- ☐ audit-before-claim + design-critique on result
- ☐ commits per slice → push to `main` → Matt verifies on iPhone
- ☐ End-of-session: log, trust anchors, notebooklm refresh (`verify_failed:0`), preflight green

**Operational follow-ups (not this slice)**
- ☐ Verify + wire open-meteo worldwide DEM (W2)
- ☐ Tune `K_ELEV` against on-course truth (A4)

---

*Sources: USGS 3DEP / EPQS (verified live 2026-06-25, 1 m, public domain); open-meteo elevation API (UNVERIFIED — timed out, to confirm); existing `computePlaysLike` model in `client/src/lib/geo.js` + `client/src/pages/EagleEye.jsx`; the-match repo conventions (CLAUDE.md); the two companion plan docs in this folder.*
