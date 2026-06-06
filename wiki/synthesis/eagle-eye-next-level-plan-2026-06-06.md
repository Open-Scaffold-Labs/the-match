---
type: synthesis
created: 2026-06-06
updated: 2026-06-06
tags: [the-match, eagle-eye, plan, gps, osm, build-plan]
---

# Eagle Eye — Next-Level Build Plan: Tap-to-Measure + Front/Center/Back Green

**Goal:** finish Eagle Eye to a standard a golfer deletes other apps for — done right from the
start, with every risk anticipated and a fallback so the worst case is "feature absent," never
"app broken." Branch: `feat/eagle-eye-upgrades`. Nothing deploys until Matt ships.

## 0. Where we are (verified this session)

- **Shipped on `feat/eagle-eye-upgrades` (commit 438bdb5), build-passing, NOT device-tested:**
  pull-to-refresh data-loss fix (course+hole persist/resume), Wake Lock, plays-like on the live
  GPS number.
- **Reliability fix lives on a separate branch** `fix/osm-mirror-only` (kumi demoted + 10s
  per-mirror timeout) — **unmerged**. This branch's OSM route is still the pre-fix version
  (verified: `eagle-eye.js` mirrors[0] = kumi, no AbortController).
- **OSM green-polygon coverage — measured (lz4 mirror, 2026-06-06):** Augusta 43, Pebble Beach 32,
  Rancho Park muni 48 green polygons; **0** node-only greens. Bethpage + St Andrews returned HTTP
  429 (rate-limited by rapid probing — operational signal, not absence). *Encouraging but a small,
  US-biased, famous-course sample; counts include practice greens, so polygon→hole association is
  mandatory.*
- **leaflet-rotate click→latlng under bearing rotation: UNVERIFIED.** Top risk for Feature A.

## 1. Guiding principles (the five axes)

- **Function:** distances must be correct or absent — never confidently wrong. Authoritative
  source order: real OSM geometry → fallback to today's single center number → never crash/NaN.
- **Usability:** glove-friendly targets (≥44px), one-glance hierarchy, sunlight-legible contrast,
  every new control clearable/obvious. No new taps required to get core value.
- **Adaptability:** works with or without GPS, with or without green polygons, on a rotated or
  north-up map, on a course OSM has barely mapped. Each capability degrades independently.
- **Security/Privacy:** no new PII; GPS stays on-device; OSM stays behind our server proxy; map
  labels rendered as text (no HTML injection); only non-sensitive values persisted (course id,
  hole #).
- **Design:** matches the Augusta-night token system (`--tm-*`), gold/green palette, the existing
  glass HUD; additions feel native, not bolted on.

## 2. Pre-build gates (MUST pass before feature code)

- **G1 — Reliability foundation.** Merge `fix/osm-mirror-only` → main, rebase
  `feat/eagle-eye-upgrades` on it, so F/C/B's server edit sits on the mirror-fixed route. Verify:
  `git log` shows the timeout/reorder in this branch's `eagle-eye.js`; build clean.
- **G2 — Broaden coverage sample.** Probe `golf=green` ways across ~12 varied courses (muni,
  international, links, obscure) with backoff to avoid 429. Verify: record %-of-holes-with-polygon;
  decide whether F/C/B is on-by-default or behind a "data available" check.
- **G3 — Resolve rotation math.** Read leaflet-rotate 0.2.8 source for `mouseEventToLatLng` /
  `containerPointToLatLng`, OR build a tiny harness logging `e.latlng` at known taps on a rotated
  map. Decide: trust `e.latlng`, or convert via `map.containerPointToLatLng`. Verify: a tap at a
  known feature returns coordinates within a few yards.
- **G4 — Device loop.** Confirm Matt can run the branch on a real iPhone (PWA or TestFlight) for
  the on-course checks I cannot run from here.

## 3. Feature A — Tap-to-Measure (BUILD FIRST; no server change)

- **A1 Live refs.** Add `gpsLiveRef` in HoleMap updated by a `[gps]` effect (handler reads current
  player pos; `livePosRef.greenPt` already live — verified :645/:725). → verify: build clean.
- **A2 Handler + marker.** `map.on('click')` drops/moves a distinct measure marker; compute
  `carry = haversine(gpsLive, tap)`, `toGreen = haversine(tap, greenPt)`; render a Leaflet
  `divIcon` label set via `textContent` (no innerHTML — XSS-safe). Tapping the marker clears it.
  → verify: build + code review.
- **A3 Lifecycle.** Clear on hole change + in the existing unmount teardown (add to the ref-null
  block). → verify: grep teardown covers `measureMarkerRef`.
- **A4 Rotation (depends on G3).** Use the G3-decided latlng path. → verify: device tap test.
- **A5 Polish (design/usability).** Marker/label styled to tokens; ≥44px hit area; no-GPS →
  show only "to green from here," never NaN; label sits in the marker pane, not under the HUD.
- **Failure register A:** stale closure → refs; tap on existing aim marker → target guard; rotation
  skew → G3; no GPS → partial readout; label z-index → marker pane; raw touch listeners → use
  Leaflet events only.

## 4. Feature B — Front/Center/Back Green (BUILD SECOND; server change)

- **B0 (=G1).** Reliability merge done first — hard dependency.
- **B1 Server, additive.** New query `type=greengeom` → `way["golf"="green"](bbox);out geom;`.
  Existing `holes`/`teegreen` untouched (zero regression). Inherits per-mirror timeout. Validate
  `type` against an allowlist. → verify: `node --check`; curl returns polygons for a known course.
- **B2 Client parse + associate.** 3rd parallel fetch; parse `way.geometry`→polygon; match each
  polygon to a hole by nearest centroid to existing `greenPositions[hole]` within a threshold
  (~40y); store `greenPolys[hole]`. **Bump OSM cache version** (precedent: commit c1fa817) so
  stale cached payloads without polys fall back cleanly. → verify: parse against saved fixtures;
  assert correct hole association.
- **B3 Compute (pure, unit-tested).** `greenFCB(player, polygon, centerPt)`: front = nearest
  vertex to player, back = farthest, center = existing centroid; player = GPS else tee;
  `<3 vertices → null`. → verify: Node unit tests on synthetic + real-fixture polygons.
- **B4 UI.** Three numbers (F/C/B) when available; big number = center; plays-like stays on center;
  **unavailable → today's single number, unchanged.** Optional front/back dots on the green. →
  verify: build + visual review against tokens.
- **B5 Coverage gate.** Per G2, only show 3 numbers when a polygon is actually matched; otherwise
  silent fallback. → verify: forced no-poly path still renders single number.
- **Failure register B:** server/mirror tangle → B0; no polygon → center fallback; wrong polygon →
  centroid threshold + skip-if-ambiguous; player off-axis (nearest≠true front) → documented v1
  approximation, flagged for on-course check; stale cache → version bump; greengeom fetch fails →
  F/C/B absent, core distance unaffected; mistagged feature → filter `golf=green` only.

## 5. Test strategy (pyramid — the "prevent anything wrong" layer)

- **Unit (many, free, run now in Node):** pure helpers — `haversineYards`, `calcBearing`,
  `computePlaysLike` (incl. wind-sign cases), `greenFCB`, polygon centroid + polygon→hole match.
  Add `client/src/pages/__tests__/eagleeye-geo.test.mjs`. Target: 100% of the geo/math helpers,
  including edge cases (no GPS, <3-vertex poly, player behind green, tie distances).
- **Integration (some):** run the OSM parser against **captured real fixtures** (save the
  Augusta/Pebble/Rancho JSON) → assert tee/green/poly counts + hole association. Catches OSM-shape
  regressions without the network.
- **Build gate (every phase):** `npm --prefix client run build` + `node --check` server.
- **Manual/E2E (device, Matt — the part I can't run):** on-course checklist in §9.
- **Coverage targets:** geo/math 100%; OSM parse covered by ≥3 fixtures; UI fallback path exercised.

## 6. Security & privacy review

- No new personal data; GPS never leaves the device (used client-side; only lat/lon already sent to
  the OSM proxy via bbox, not identity). New `type=greengeom` validated against an allowlist (no
  injection into the Overpass query beyond the existing bbox path). Map labels use `textContent`,
  not `innerHTML`. Persisted values (`tm-shared-course`, `tm-eye-hole`) are non-sensitive. No new
  secrets, no new third parties.

## 7. Rollout & rollback

- A and B as **separate commits**. Guard each feature behind a simple `const ENABLE_X` toggle so a
  problem can be switched off without a revert. Preview-deploy smoke test before merge
  (anti-pattern #11: never skip the preview check). Matt triggers all deploys.

## 8. Definition of done (acceptance criteria)

- Build + `node --check` clean; geo unit tests green; every new path has a verified fallback; no
  crash/NaN with GPS off, polygons missing, or OSM 429; commits separated; preview smoke-tested;
  on-course checklist passed by Matt.

## 9. On-course validation protocol (Matt, on a real round)

1. Tap-to-measure: tap a known sprinkler/yardage plate → carry within ~3y; rotate map → still
   correct.
2. F/C/B: compare to a scorecard/yardage book on 3 holes → within a few yards.
3. Unmapped-course path: load a course OSM barely covers → confirm graceful single-number fallback.
4. Pull-to-refresh mid-round → course + hole resume (the already-shipped fix).
5. Screen-awake holds; no crash/reload across 18 holes.

## 10. Consolidated risk register

| Risk | Likelihood | Prevention |
|---|---|---|
| Rotation latlng wrong | Med | G3 resolve before A4; device test |
| OSM green coverage thin on some courses | Med | G2 sample; silent fallback; (long-term: licensed data) |
| Server change reintroduces mirror regression | Low | G1 merge first; additive query only |
| Wrong polygon→hole match | Med | centroid threshold + skip-if-ambiguous |
| Stale OSM cache breaks parse | Low | cache-version bump |
| Off-axis front/back inaccuracy | Med | v1 nearest/farthest approximation; flagged + on-course check |
| Label XSS | Low | textContent only |
| Regression in working single-number distance | Low | additive paths + fallback + unit/fixture tests |

## Next decision for Matt

Approve the gate order (G1→G4 before feature code), then I build A, then B, unit-testing the math
as I go, committing separately, presenting diffs — no deploy.
