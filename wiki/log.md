---
type: log
created: 2026-04-29
updated: 2026-06-25
---

# Activity Log

Chronological, append-only. Every entry starts with `## [YYYY-MM-DD] <op> | <label>` where `<op>` is one of `ingest`, `query`, `lint`, `refactor`, `schema`.

## [2026-06-25] refactor | Mixed-gender matches: per-player gender ratings for Course Handicap (beta)

Closes the limitation flagged with the Course-Handicap work: a mixed-gender match (couple, mixed foursome — common in friend golf) was applying ONE tee rating (the picker's gender) to everyone. Now each player's Course Handicap uses THEIR gender's rating. Spec: [[synthesis/per-player-gender-ratings-2026-06-25]].

- **Store + capture (`011821b`):** migration 031 adds `tee_ratings JSONB` ({male:{cr,sr},female:{cr,sr}}) to `tm_outings` (applied by hand, verified). CreateWizard captures both genders' CR/SR for the picked physical tee (matched by total_yards) at match-create → create payload → INSERT. Live-outing GET returns `tee_ratings`, and the participant SELECT now carries `u.gender`.
- **Per-player net math (`011821b`):** shared `playerTeeRatings(gender, meta)` in `handicapClient.js` returns the player's-gender rating (falls back to the single rating → then no-op). `netStrokes` + the `MatchScoreboard` mirror both compute each player's Course Handicap from their own gender. 17 node assertions (male→men's 71.5, female→women's 76.8, same index → different CH, all fallbacks).
- **Bounded + verified:** NET-mode only; same-gender + unrated + old-outing matches unchanged (fallback); single shared helper keeps the two spots in lockstep; node --check + lint + build clean.
- **⚠ Flag:** verify on a real MIXED-gender net match. **Deferred:** per-player Course Handicap transparency UI (show each player their CH); per-gender round-differential capture (the INDEX side).

This completes the rating-correctness arc: gender field → gender-correct tee ratings → USGA differential (index) → Course Handicap (match strokes) → per-player gender ratings (mixed matches).

## [2026-06-25] refactor | Match net strokes now off slope-based Course Handicap (gender + slope flow into results)

The final rating-correctness piece. Match NET strokes were allocated from the raw handicap index; now they're off the WHS **Course Handicap** = Index×Slope/113+(CR−Par), using the outing's (gender-correct) captured ratings — so slope and gender actually change the strokes a player gets. Spec + risk register: [[synthesis/course-handicap-match-strokes-2026-06-25]].

- **Helper + server (`013e51f`):** shared pure `courseHandicap(index,{slope,rating,par})` in `client/src/lib/handicapClient.js` (9 node assertions; graceful fallback to raw index when unrated). Live-outing GET now returns `course_rating`/`slope_rating` (were stored on `tm_outings` but not selected).
- **Wiring (`013e51f`):** both client net-stroke implementations — `netStrokes()` and the `MatchScoreboard` inline mirror — convert the index via the shared helper + `outingRatings` before the existing allowance×floor. Single helper keeps them in lockstep. **Lint caught a real scope bug** (`outingRatings` undefined in MatchScoreboard — the ReferenceError class) before it shipped; fixed by threading it as a prop.
- **Bounded + safe:** NET-mode only (GROSS untouched); unrated/free outings unchanged (fallback). `node --check` + lint + build clean; 9 assertions pass.
- **⚠ BEHAVIOR CHANGE flagged:** net results on RATED matches shift to the WHS-correct basis — **Matt should verify on a real net match.** **Limitation flagged:** the outing stores ONE tee rating (the picker's gender), so a mixed-gender match applies that gender's rating to everyone — a strict improvement over raw-index (slope-adjusted) but not per-player-gender-correct. Full correctness needs per-player gender ratings stored/fetched (deferred). Also deferred: strict WHS integer-rounding of CH before allowance.

## [2026-06-25] refactor | Gender wired into handicapping — gender-correct tee ratings + USGA differential enabled (beta)

Matt: "no point having genders if they aren't correctly wired." Recon found TWO gaps (both verified in code): (1) `dedupeTees` iterated men's tees first and dropped the women's-rated duplicate of a shared physical tee → a woman captured the **men's** course_rating/slope; (2) `handicap.js` forced the **par-based** differential (`USE_USGA_DIFFERENTIAL = false`), so ratings/slope — and therefore gender — never touched the index at all. Full spec + risk register: [[synthesis/gender-handicap-wiring-2026-06-25]].

- **Gender-aware ratings (`0f11c60`):** `dedupeTees(teesObj, gender)` takes the player's-gender tee list as primary, so the captured CR/SR matches the player's gender. Threaded `user.gender` through the **CreateWizard** tee picker (the handicap-capture path → `tm_rounds`) and the EagleEye course picker. Default `'male'` = unchanged for null-gender users (no regression). 8 node assertions (female now gets women's 76.8 rating, not men's 71.5; suffix logic; null→male).
- **USGA differential enabled (`0f11c60`):** removed the kill-switch; rated rounds (valid rating+slope) now use WHS `(score−rating)×113/slope`, unrated fall back to par-based. 7 node assertions (rated→USGA, unrated→par, women's rating → correct different differential, guards). **BEHAVIOR CHANGE flagged:** users with rated rounds recalc to the proper USGA method (reversible, gated on rating presence; unrated/free rounds unaffected).
- **Verified:** node --check (handicap.js), client lint+build clean, 15 total node assertions pass. The math (`(score−rating)×113/slope`) matches the WHS formula.
- **Deferred (flagged):** Course Handicap (slope-based) for *match strokes* — matches currently use the raw index + per-hole stroke index + allowance, not `Index×Slope/113+(CR−Par)`; implementing that is a bigger, separate change. Retro-fixing old rounds' captured ratings only matters for historical rated rounds.

## [2026-06-25] schema | Player-data foundation — gender field (migration 030) + profile/onboarding UI (beta)

Greenlit by Matt after he (rightly) rejected guessing distances from handicap: a national-scale golf app needs real player attributes, not workarounds. Shipped the gender field end-to-end. Full spec + risk register: [[synthesis/player-data-foundation-2026-06-25]].

- **Server (`2f60060`):** migration `030_tm_users_gender.sql` adds `gender TEXT` (nullable, app-constrained male|female) to `tm_users` — applied to Supabase by hand, column verified. Added `'gender'` to the shared `USER_PUBLIC_COLUMNS` (`server/src/lib/user.js`) so `/me` + `middleware/auth` + `profile` all carry it. `profile/update` accepts + allowlist-validates gender, COALESCE-guarded so an unrelated save never wipes it.
- **UI (`2f60060`):** segmented Male/Female control in the Home profile-edit modal (reads `user.gender`, saves via `profile/update`), and folded into the onboarding handicap step (no step renumber — lower risk than a new STEP). Optional everywhere; null is valid; never gates onboarding.
- **VERIFIED end-to-end on the live deployed app:** `/api/auth/me` now returns `gender` in the user object (`null` default for existing users) — migration + USER_PUBLIC_COLUMNS + propagation all confirmed in production. `node --check` clean, build+lint clean. The gender *control* rendering wasn't screenshotted (couldn't find the edit-modal trigger via clicks in-session) but is build-clean and uses the identical pattern to the working handicap/bio fields.
- **Distance entry:** the prompt is already present (Home shows "N clubs · tap to manage distances"; the 3.3 ARCS empty-state opens the bag). Deeper "effortless entry" UX polish is a light follow-up, not built this session.

**Why this happened (lesson):** in 3.3 I let a clever research finding ("no app seeds club distances from handicap") override the obvious truth that the finding's *absence* might be because seeding from handicap is a bad idea — it is (handicap ≠ club distance). Matt caught it; removed all guessing (own-club arcs now use entered distances only), and added the gender field that the audit had flagged but I'd worked around instead of recommending. **Follow-ups:** gender-aware tee defaults (wire the new field into tee selection), auto-derive distances from tracked shots (the zero-effort accurate long game), Tournament Mode (USGA legality, still open from 3.1/3.3).

## [2026-06-25] refactor | Eagle Eye Phase 3.3 SHIPPED to beta — own-club distance arcs with handicap-seeded empty state (on-map visual NOT yet device-verified)

Greenlit by Matt with the full bulletproof treatment incl. competitive research via agents. The category's empty-state gap closed: a glanceable "which of MY clubs reaches here" overlay, decluttered and useful from hole 1. Shipped to `main` (beta), four commits, each `build`+`lint` clean. Full spec + risk register + research synthesis: [[synthesis/own-club-arcs-3.3-build-spec-2026-06-25]].

**Competitive research (two agent passes, sourced):** leaders moved from single carry arcs → personalized shot-dispersion overlays (arcs for tee shots, ovals for approaches) with a draggable target + expected-score readout, but **no surveyed app clears the triad of honest + uncluttered + premium-on-free**, and the loudest failures are map clutter (always-on overlays), blank-until-5-rounds empty states, and paywalls. **Ownable wedge: no surveyed app seeds club distances from handicap** — every one is useless on hole 1. Competitor names kept in research only; the committed spec is generic per the rule.

**Slices (each build+lint clean):**
- **A — model** (`35ffa93`, `client/src/lib/clubModel.js`): gapping-ratio table + `effectiveBag()` that seeds missing slots **anchored to the user's own known club** (audit caught there's no gender field → anchoring is gender-agnostic + more accurate; handicap baseline only when the bag is empty), `dispersionEllipse()` for honest zones, `clubsForTarget()` bracket selector. **22 node assertions pass.**
- **B — rendering** (`9dcb868`, `HoleMapGL.jsx`): new `bagArcs` source + data-driven layers (bracket club solid gold, others muted, estimated/seeded clubs dashed, low fill opacity), `drawBagArcs()` projects each club along player→aim and draws a dispersion-sized ZONE (honest "typical landing", not a precise arc) with a glass label; single-club ring suppressed in arcs mode; all new refs nulled on teardown.
- **C — wiring** (`a1b8775`, `EagleEye.jsx`): ARCS toggle summons the zones (calm default, mutually exclusive with single-club select); effective bag = real + handicap-seeded; declutters to the 1–2 clubs bracketing the displayed distance.
- **D — tabular-nums sweep: SKIPPED by evidence** — `tokens.css:139` already applies `font-variant-numeric: tabular-nums` to `body` globally; the premium-plan claim was stale. Verify-before-claim avoided redundant churn.

**HONEST verification status (audit-before-claim):** VERIFIED — clubModel (22 assertions), build+lint clean every slice, the ARCS toggle renders + activates live on the deployed app, 3.1 plays-like still works, deployed bundle live (`index-DvhjMxoQ.js`). **NOT verified — the on-map zone rendering itself:** the deployed map failed to load this session (`[HoleMapGL] init failed: map load timeout (20s)`) — the documented **NAIP tile throttle** triggered by my ~50 test reloads across the session, NOT a code defect (zero errors from bagArcs/clubModel; the arcs draw *on* the map, so they can't be seen until the base loads). Per the standing gotcha, NAIP self-recovers; **the bag-arcs visual must be confirmed on Matt's device / a fresh IP.** Follow-ups unchanged from the spec: Tournament Mode (USGA legality, affects 3.1 too), measured dispersion from shot history, carry/total split, draggable-target interaction.

**CORRECTION same session (`4e074d3`) — Matt rejected the handicap seeding (rightly):** handicap doesn't map to club distance, so seeding from it is a guess that breaks the accuracy promise. Removed ALL seeding from `clubModel.js` → now just `realBag()` using the player's entered `avg_yards` only; empty bag prompts the player to set distances in My Bag, never fabricates. The "useful on hole 1 via handicap seeding" wedge is RETRACTED — the real wedge is effortless real-distance entry + a beautiful honest visualization. 14 node assertions repass on the real-data-only model; build+lint clean; shipped. **Matt also flagged a foundational gap: the audit found no gender field and I worked around it instead of recommending we BUILD it. For a top-tier app we should add a proper gender/tee-gender profile field + a strong club-distance entry flow — recommended, awaiting go-ahead (schema migration + profile UI).** Lesson: when the accuracy pillar is on the line, don't let a clever research finding ("no one seeds from handicap") override the obvious truth that the finding's absence might be because it's a bad idea.

## [2026-06-25] refactor | Eagle Eye Phase 3.1 SHIPPED — transparent, adjustable plays-like with real DEM elevation (beta)

Greenlit by Matt. The category's biggest gap closed: a **transparent, adjustable plays-like** as the free default. Tap the live yardage's **PLAYS LIKE** chip → a glass bottom sheet breaks the number into Wind / Elevation / Temperature (+ a read-only Altitude row), each labeled auto/manual and each individually overridable. Shipped to `main` (beta), four commits, each `build`+`lint` clean; verified end-to-end by Claude in a real browser before push (Matt's "check it yourself now" rule).

**The win that makes it best-in-class: elevation is auto-derived for real.** Earlier framing said uphill/downhill couldn't be done well (GPS vertical accuracy is poor) — wrong instrument. The fix is a terrain model: **USGS 3DEP EPQS** (US, ~1 m, public domain, keyless), queried at the player + green coords, delta → plays-like term. Verified live (foothills 5804 ft > downtown 5237 ft; correct uphill sign; mid-Pacific off-grid → null). Worldwide (open-meteo DEM) stubbed behind a provider abstraction — non-US gracefully shows wind+temp + manual elevation until wired.

**Slices (each verified):**
- **A — math** (`bc78e7e`, `client/src/lib/geo.js` + EagleEye mirror): `computePlaysLike` now returns `{plays, adj, base, factors:{wind,temp,alt,elevation}}` + a new elevation term (`PLAYSLIKE_K_ELEV` = 1/3 yd/ft, tunable). Byte-identical `plays/adj` for existing callers. 20 node assertions (sign/magnitude/zero/reconciliation/backward-compat) pass.
- **B — DEM service** (`285b135`, `server/src/routes/eagle-eye.js`, `index.js`, `migrations/029_tm_elevation_cache.sql`): `GET /api/eagle-eye/elevation` with USGS provider, L1+L2 cache (mirrors the OSM-cache pattern, migration 028), absolute-range no-data gate, DB-gate skip like `/osm`. Migration 029 applied to Supabase by hand; L2 persistence verified (rows written, no "relation does not exist").
- **C — wiring** (`615dd26`): throttled (~11 m moves) player+green elevation fetch feeds `elevDeltaFt` into the live model; distance never blocks on it.
- **D — sheet + chip** (`615dd26`): tappable `PLAYS LIKE ▸` chip replaces the 8px row; bottom sheet with shot-relative wind dial (headwind at top, matching course-up map), steppers, MANUAL text badge (never colour-only), per-factor + reset-all, overrides reset on hole change. Reduced-motion aware, 44px targets, tabular-nums, grabber, scrim dismiss.

**Bug caught in-browser before shipping (the value of verifying):** the breakdown didn't reconcile — rows summed to −2 but the total read −7. The hidden term was altitude-above-sea-level (air density), in the total but with no row. Fixed by surfacing a read-only **Altitude** row when non-zero, so rows ALWAYS sum to the chip total — the whole point of a transparent breakdown. Confirmed `reconciles: true` in the browser; dial drag flips headwind→tailwind and updates the total live.

**Follow-up fix #1 (same session, `021ac18`):** Matt reported the chip wasn't visible. First root cause: the chip was gated on `gpsToGreen` (trusted fix + matched green), but the hero distance shows the tee/remaining fallback when GPS isn't pinpoint — so a distance showed with no chip. Fixed: base plays-like on `displayYards`.

**Follow-up fix #2 (same session, `8031c00`) — the actual cause:** still not showing. Reproduced on the DEPLOYED app via Claude-in-Chrome (Matt's logged-in Pebble Creek session): HUD showed `FROM TEE 340` but no chip AND no `±Xm` GPS chip — GPS hadn't fixed. The chip also requires `weather`, and `weather` was only fetched inside the GPS watch handler → no fix ⇒ no weather ⇒ no chip, even with a distance. Fix: seed weather from the course geometry (green/tee coords) on load, decoupled from GPS; a real fix still refines it. **Verified live on the deployed app:** chip now shows `PLAYS LIKE 335 −5`, opens the sheet (Temperature −5 from 84°F; Wind unavailable / Elevation "SET" off-course, as designed). Lesson: the chip's data dependencies (weather) weren't reproduced in my isolated harnesses — verifying on the real deployed app with real course state is what caught it. Note for Matt: iOS PWA may serve a cached bundle — force-close + reopen to get the new build (`index-DOO7obdc.js`).

**Still on-course only:** `K_ELEV` calibration against real holes (A4), and the final iPhone/WKWebView touch-drag feel. **Follow-ups:** verify + wire the open-meteo worldwide DEM (W2). Full spec + risk register: [[synthesis/playslike-3.1-build-spec-2026-06-25]].

## [2026-06-24] refactor | Eagle Eye Phase 2.1/2.2 SHIPPED — MapLibre is the sole renderer; Leaflet removed; offline tiles (beta)

Continuation of the same long Cowork session (supersedes the "MapLibre blocked" note in the entry below — that was a verification-environment artifact, not a real blocker). All shipped to `main` (beta), each `build`+`lint` clean, individually committed. Matt verified the key behaviours on his iPhone.

**Project framing corrected (important for every future session):** The Match is a **native iOS app for the Apple App Store** (WKWebView shell over the web app), NOT "just a PWA". CLAUDE.md (top callout + Stack + Design) and `wiki/overview.md` updated. Consequence baked in: WebGL2 is guaranteed (iOS 15+), so **never write browser-framed fallbacks** ("use a newer browser"); every decision is an App-Store-readiness decision.

**MapLibre GL is now the ONLY hole-map renderer (Leaflet fully removed):**
- `b1d8535` first shipped MapLibre behind a flag with a Leaflet auto-fallback (3 nets: error boundary, init-error, load-timeout). It rendered on Matt's phone (cinematic flyTo, NAIP, branded overlays).
- Discovered the renderer was **inconsistent** (cold load → Leaflet fallback, warm → MapLibre) and the fallback was the culprit. Matt's call: kill Leaflet entirely. Confirmed the legal issue was always **ESRI imagery, not Leaflet** (Leaflet is BSD; we'd already swapped to NAIP), so the fallback carried no legal benefit — only the inconsistency + two codepaths.
- `f524a1a` removed ~800 lines: the Leaflet `HoleMap`, `HoleMapSwitch`, the error boundary, the leaflet/leaflet-rotate CDN preload+inject, all `.leaflet-*` CSS, the `ENABLE_MAPLIBRE`/`ENABLE_TAP_MEASURE` flags, and the orphaned `projectPoint`/`getDefaultAim`/`pointAlongGeometryAtYards` helpers. Verified in-browser: `window.L` undefined, 0 leaflet scripts, MapLibre sole renderer. **The tee/green/course-layout intelligence is untouched — it lives in EagleEye.jsx + lib/geo.js + the server, renderer-agnostic.** Parity hardened first: real OSM green polygons (`greenPolys`) passed through + rendered, hole-length-adaptive zoom, red pin-flag marker.
- `7bba6da` graceful retry card on genuine load failure (replaces the now-gone fallback).

**Eagle Eye `HoleMapGL` (new MapLibre component) — full feature surface:** NAIP raster base + branded green/gold vector overlays (tee dot, green polygon, dashed tee→aim→green line), course-up bearing, cinematic `flyTo` (pitch ~62°, reduced-motion aware), smooth rAF-lerped player puck + true-ground accuracy halo, **draggable aim point** with split-proportional yardage pills, **per-club landing-zone ring**, tap-to-measure. `66a0289` ported aim/landing; `81d220d`/`787c9b3` design-audit fixes (label declutter, 44px aim hit-area, zoom moved off the instrument card, attribution de-collided).

**Offline tile caching (bad-coverage resilience) — SHIPPED, and the path to it is instructive:**
- Tried a **service-worker** tile cache first (`2765868`): verified in-browser it does NOT work — MapLibre fetches raster tiles from its **worker thread**, which the SW doesn't intercept (only a manual main-thread fetch cached). Reverted the SW changes.
- The correct mechanism is **MapLibre `addProtocol`** (`naipc://`), which routes EVERY tile load (worker included) through a main-thread handler doing cache-first Cache-API storage. First attempt looked like it "broke raster" and I reverted (`7564e3c`) — but **research corrected that**: per [maplibre-gl-js discussion #4480](https://github.com/maplibre/maplibre-gl-js/discussions/4480) the raster contract is `return { data: ArrayBuffer }` of the encoded JPEG file bytes (which mine did); the failure was actually **NAIP rate-limiting my test IP** (the plain-https build timed out in the same window). Re-shipped `addProtocol` (`479dd40`); Matt confirmed imagery renders on-device → offline tile caching is live (FIFO-capped at 2000 tiles, cache `naip-tiles-v1`). Also added `importMaplibre()` chunk-load auto-retry (self-heals transient blips).

**Lifecycle + correctness fixes:**
- `313387d` **markers vanished after a course switch** (Matt-reported, then fixed): switching courses re-runs the init effect → `map.remove()` destroys DOM markers, but the cleanup only nulled `mapRef`, leaving `teeMarkerRef`/`greenMarkerRef`/`aimMarkerRef`/`puckRef` + label refs dangling → drawHole called `setLngLat` on destroyed markers (no-op) instead of re-creating. Fix: null ALL marker/position refs on teardown (the Leaflet path did this; the GL path didn't). Verified by Matt (switch courses, markers persist).
- `0ad8eb7` disabled the app pull-to-refresh on Eagle Eye (full-screen map never scrolls → every downward pan was reloading the page) via the existing `data-no-pull-refresh` hook.
- `b3e832c` F/C/B only from a TRUSTED GPS fix (was measuring front/back from a misplaced OSM tee → "502/534 on a 360-yd hole").

**Process notes for the next session:** (1) My Chrome-MCP test tab became unreliable late-session — lagging/stale screenshots, persisting console from old bundles, and NAIP throttling my IP after ~40 reloads. **DOM checks (canvas/leaflet/cache counts) are ground truth; screenshots are not.** (2) Two credibility misses this session: called the Leaflet *fallback* "striking MapLibre" off a screenshot, and prematurely blamed `addProtocol`. Both caught by Matt; both fixed by verifying via DOM/research instead of vibes. Audit-before-claim, hard. (3) Matt's standing bar: *don't push off what can be built better now; functionality must be flawless + feel expensive; verify, don't claim.*

## [2026-06-24] refactor | Eagle Eye Phase 1 (correctness/cost-safety) + Phase 2 hero polish (beta)

Autonomous session, Matt green-lit Phases 1+2 of the bulletproof build plan ("functionality, usability, visual flow are paramount; don't push off what can be done better now"). Six slices shipped to `main` (beta), each `build`+`lint` clean and committed individually. The map renderer swap (2.1/2.2) is **not** shipped — see the blocker below.

**Phase 1 — correctness & cost-safety (all shipped + verified):**
- **1.1 GPS accuracy gate** (c819c69) — read `coords.accuracy` on every fix; a live yardage is only quoted when the 68% radius ≤ 10 m (`GPS_ACCURACY_GATE_M`). Coarse cold-start/canopy fixes show an amber "ACQUIRING GPS · ±Xm" chip instead of a confidently-wrong number; trusted fixes show a green "±Xm". All distance math (green dist, plays-like, F/C/B, bearing) keys off `trustedGps`, so an untrusted fix can never produce a confident number. GPS pill reflects trusted/acquiring/off.
- **1.2 Durable OSM cache** (45538b2) — migration `028_tm_osm_cache` + two-tier cache in the `/osm` route (L1 in-memory, L2 Supabase). The public Overpass API is now hit at most once per (osm_type, bbox); previously the in-memory cache was wiped on every Vercel cold start → we were hammering the mirrors. Stale rows served if all mirrors are down. **Verified locally**: cold call 4490 ms (Overpass) → row persisted (14 elements) → warm call 1 ms (cache hit). Migration applied to Supabase by hand.
- **1.3 Replace keyless ESRI imagery** (57e1ba1) — the ESRI World Imagery keyless endpoint is a commercial ToU violation. Swapped for **USDA NAIP** (`USDA_CONUS_PRIME` ImageServer tile cache) — public-domain US gov ortho, ~0.6 m/px to z18, free, no key. `maxNativeZoom:18`; non-CONUS falls back to the branded dark canvas + OSM overlays. Imagery attribution now shown. **Verified**: NAIP tiles serve z16–18 across Augusta/Pebble/Orlando; z19 404s (hence the cap).

**Phase 2 — hero polish (3 of 5 shipped):**
- **2.3 Hero distance instrument** (95717ee) — the live yardage is now a 270° SVG arc gauge wrapping an odometer number-roll, both driven by the SAME rAF ease-out tween (lockstep, reduced-motion aware). Hand-rolled tween instead of a number-roll dep — zero bundle cost. Gauge geometry **verified** via a faithful standalone render (142/168/247/305 yds) in Chrome.
- **2.4 Glass HUD + unified controls** (1ee636a) — restyled Leaflet's default white zoom control + grey attribution into the dark-glass HUD language (blur+saturate, gold accents) — the plan's #1 "cheap embed" tell. Added real backdrop-blur + inset top-rim highlight to the BAG toggle, club-toggle arrows, and the ANALYZE primary.
- **2.5 Smooth player puck + accuracy halo** (1d38fce) — the GPS dot rAF-glides (~700 ms easeOut) between fixes instead of teleporting, with a translucent halo whose radius is `coords.accuracy` in METRES (a real `L.circle`, not a pixel ring) so uncertainty is honestly visible. All map ops guarded; rAF cancelled on new fix + teardown. Concentric yardage range-rings deliberately held (clutter judgment needs a live-map view).

**2.1 MapLibre + 2.2 cinematic flyTo — INVESTIGATED, NOT SHIPPED (blocker found).**
Built a standalone MapLibre proof (NAIP raster + branded green/gold vector overlays + pitched flyTo). It did **not** render. Root-caused via Chrome DevTools:
- NAIP imagery is **not** the problem — it loads fine as a CORS-clean `<img>` (256×256, crossOrigin ok), so it is MapLibre-compatible.
- MapLibre's renderer relies on a **web worker that never initializes in the available verification environment** — even MapLibre's own official `demotiles` style fails to load (0 tiles, no error, `isStyleLoaded()` false). So the renderer swap **cannot be validated headlessly at all**, and there is no on-course device test available this session.
- Per the plan's own rule ("keep the current Leaflet path behind a flag until the MapLibre path is device-tested") and the anti-pattern "clean build ≠ runtime-valid", shipping an unverifiable renderer to the beta would be reckless. **Held.** The Leaflet+NAIP map is premium and live in the meantime.
- **Recommended next step**: a supervised session where Matt can device-test — build `HoleMapGL` behind `ENABLE_MAPLIBRE` (default off), NAIP raster base (works) + branded vector overlays + `flyTo` (bearing tee→green, pitch ~70°, ~3.5 s), feature-parity port of markers/aim/tap-measure/landing-zones, then flip on after an on-course test.

## [2026-06-24] refactor | Premium-design pass + PWA update fix + profile/border + Matches↔Leagues consistency (beta)

Continuation of the same long Cowork session. Strategy + research deliverables (zero-cost build plan, Eagle Eye premium plan) live in the Hub workspace, not this repo. All code shipped to `main` (beta), each build+lint verified, most verified live on the deployed app via Claude-in-Chrome + DOM inspection.

**Strategy/decisions locked (Matt):**
- Goal: build the world's best golf app; perfect usability/accuracy/visual flow; build (and host) for **$0 new spend** — the OpenScaffold org already pays for Vercel Pro + Supabase Pro, so the-match just **migrates off the free tiers** (no new cost). Verify the project is on the org's Pro plans before launch.
- **Satellite imagery: US-only at launch on free public-domain NAIP**; worldwide photographic coverage is a future roadmap upgrade. Non-US gets the free vector hole view.
- Full deliverables: `the-match-build-plan-bulletproof.md` + `the-match-eagle-eye-premium-plan.md` (Hub workspace folder).

**PWA stale-bundle fix** (280d490) — root-cause: the SW's activate handler (cache sweep + reload broadcast) only re-runs when `sw.js`'s BYTES change, but `sw.js` was static → installed PWAs (Matt's iPhone 16e) ran stale bundles; *none* of the day's fixes were reaching the device. Fix: `client/scripts/stamp-sw.js` (postbuild) rewrites a `self.SW_BUILD` token in `dist/sw.js` with the commit SHA so it changes every deploy; vercel.json no-cache on `/` + `/index.html`. Deploys now propagate within seconds.

**Premium token foundation** (d27f9ab, Phase 0) — additive design tokens: dark-mode elevation surfaces (`--tm-dark-0..3`), layered hue-tinted shadow, Material ease-out, `.tm-glass` HUD utility, app-wide tabular numerals. No element styles changed → no regression.

**Grass-background / framing fixes** (b1a86f8, 8918711, f9b7353, 52fac2d, a21cdac) — the grass photo bled at screen edges on phones wider than the 430px app frame. Fixes: TabPanel opaque base for non-grass tabs; Tour kept grass; outer wrapper opaque (dark for Eagle Eye, parchment else) on non-grass tabs; Home reports its sub-view so the outer wrapper drops grass on My Profile; **My Profile re-mounted as a full-screen `position:fixed` portal on `#0E1F13`, identical to a friend's profile** (FriendProfile structure) so borders match edge-to-edge. Verified via DOM (grass element absent; edges = `#0E1F13`).

**Eagle Eye hero — first visual slice** (55e0830) — distance HUD upgraded to premium frosted glass (blur+saturate+inset rim, layered shadow) with the hero yardage enlarged 36→54px + soft shadow. Visual-only. *Remaining hero work (MapLibre vector+NAIP map, cinematic flyTo, odometer number-roll, 270° arc gauge) NOT done.*

**Matches ↔ Leagues consistency** (eb2c353, 45f6536, 13a74e9) — established the "Augusta tournament-board" card language and applied it to the Matches page: cream-gradient page background (Leagues `hubBase`); live-match card gets the gold accent strip + cream/gold board card + serif title (hero); friends + finished cards share the cream/gold surface without the strip (secondary). Matches + Leagues are now a matched pair = the standard for the app-wide rollout.

**Design language (the standard):** surfaces = cream gradient `#FFFCF3→#F4E9C4`; cards = gold border + layered shadow, hero cards add the gold accent strip + serif (Georgia) title, secondary cards share surface w/o strip; accents = Augusta gold `#C9A040` + forest green; ink `#0D1F12`. Profile/Eagle-Eye dark surfaces use `#0E1F13`/`--tm-dark-*`.

Pages touched: `App.jsx`, `Home.jsx` (ProfileView portal + homeView callback), `Outing/OutingHub.jsx` (cards + bg), `EagleEye.jsx` (HUD), `design/tokens.css`, `public/sw.js` + `scripts/stamp-sw.js` + `package.json` + `vercel.json`.

**Open / next session:** app-wide consistency rollout is ONLY partway — Matches + Leagues done; Home dashboard cards, tee-time/inbox cards, Eagle Eye landing, and other surfaces still need the board language. The bulletproof build plan's Phase 1 (GPS accuracy gate, cache OSM geometry to stop live Overpass, replace keyless ESRI imagery) and Phase 2 (MapLibre map migration) are NOT started. See the session handoff for the pick-up order.

## [2026-06-23] refactor | Team assignment + background + one-active-match + /end tie fix (shipped to beta)

Build-and-verify session (Cowork). Everything shipped to `main` (beta), each build+lint verified, most verified live on the deployed app via the Claude-in-Chrome browser.

**Drift cleanup (session start)** — synced `tools/limitless-preflight.sh` + `tools/notebooklm-wiki-refresh.py` from the LimitlessStack canonical (canonical had gained activity-feed producers, a per-user capability snapshot, and a NotebookLM auth-retry guard); added the helper scripts the synced code calls (`report-activity.sh`, `scan-capabilities.py`); indexed `synthesis/eagle-eye-next-level-plan-2026-06-06.md`; gitignored generated scoring-capability exports. (5a64b7c, 81ae0a6)

**Team assignment for best-ball / large outings** (628e173) — fixes a 6-player 3-teams-of-2 best-ball match that rendered "2 teams of 2 + 2 solo players":
- `POST /:code/guests` now calls `assignParticipantToGroup` (hand-added players were team-less → solo teams).
- `PUT /:code/teams` mirrors membership onto `participant.team_id` and clears unassigned → manual assignment is authoritative for best-ball scoring (was diverging from the auto join-order `team_id`).
- New `outingUsesTeams()` gates the Set Teams button + auto-open on `best_ball`/`team_breakdown`/saved teams — was keyed on `team_format` alone, so it was OFF entirely for >4-player best-ball (no team UI at all).
- Hydration prefers explicit `state.teams` membership over stale auto `team_id`; Set Teams seeds the right team count from field size ÷ breakdown (6-player doubles → 3 teams).
- Verified live: create 6-player best-ball → Set Teams auto-opens with 3 teams; hand-added guest lands in roster (not solo); best-ball scores by the assigned team.

**Home grass background bleed** (b1a86f8, 8918711) — non-Home pages showed the home grass photo around their content. `TabPanel` now paints an opaque `var(--tm-bg)` parchment base; Home AND Tour opt out (`opaque={false}`) to keep the grass hero. Verified via DOM + visual sweep across tabs.

**One active match at a time** (f6f1edf) — new `useActiveMatchGuard` hook + `ActiveMatchModal` (in-app bottom sheet; replaces the host-only `window.confirm`). Detects any other active match via participant-scoped `/api/outings/recent` (catches joined matches too). On confirm: host → `/end`; participant → `/withdraw` (self). Broadened `POST /:code/withdraw` to allow self-withdraw (`isHost || isSelf`; host-self still blocked). Wired into create (CreateWizard) + join (JoinSheet, now receives `user`). Verified live: modal fires on join, correct host messaging, cancel aborts safely, confirm ends the old match → 0 active.

**`/end` tie bug** (32cc700) — surfaced by the full-confirm test: ending a match with a tied pair 500'd. Root cause (Vercel runtime logs): `/end` wrote `tm_match_history` tie rows with `winner_id/loser_id = null`, but the `tm_update_h2h` trigger's tie branch reads them as the two players via LEAST/GREATEST → null `player_a_id` violated `tm_h2h_records` NOT NULL. Broke ending ANY individual match with ≥2 real users + a tied pair (incl. matches ended before scoring), and silently defeated the one-active-match guard. Fix: pass both participant ids for ties; `is_tie` disambiguates and every reader (friends/profile aggregates, rivalry list `won = is_tie ? null : i_won`) checks it. Verified live: 8G49 (500'd 3×) ended cleanly → 0 active. **Implication:** pre-fix, any tie-ending match would 500 and stay OPEN — other stuck-open matches may now be endable.

Pages touched: server `routes/outings.js`; client `App.jsx`, `Outing.jsx`, `Outing/CreateWizard.jsx`, `Outing/JoinSheet.jsx`, `Outing/Commissioner.jsx`, new `Outing/useActiveMatchGuard.jsx`.

## [2026-06-06] refactor | Eagle Eye next-level build — 5 features on branch (NOT deployed)

All work on branch `feat/eagle-eye-upgrades` (pushed, undeployed; awaits on-course test + G1 merge). Verification = build + Node unit tests only — **no on-device test yet**.

**Shipped (commits):**
- `438bdb5` — pull-to-refresh **data-loss fix**: `sharedCourse` now persists to localStorage (`tm-shared-course`) in App.jsx + current hole per course (`tm-eye-hole`) in EagleEye; a reload (pull-to-refresh / SW update) resumes the round instead of dumping to empty. Also Wake Lock (screen stays awake on a course) + plays-like (wind/temp/altitude) on the live GPS-to-green number.
- `86a4c02` — `client/src/lib/geo.js` + `geo.test.mjs`: pure geometry kit (`haversineYards`, `calcBearing`, `computePlaysLike`, `polygonCentroid`, `greenFCB`, `matchPolygonsToHoles`). **21/21 Node tests pass** (`node client/src/lib/geo.test.mjs`).
- `35182ec` — **Feature A: tap-to-measure** — tap the satellite for carry-from-player + to-green-from-tap; circleMarker pin + divIcon label; clears on hole change. Uses `e.latlng` (rotation = device-test item; one-line `mouseEventToLatLng` fallback known).
- `f365ecf` — **Feature B: Front/Center/Back green** — additive server `type=greengeom` (golf=green polygons, allowlisted query type) + client parse + `matchPolygonsToHoles` association + `greenFCB`. Card shows F/B flanking the center number; falls back to single number when no polygon. OSM cache bumped v2→v3.
- `03b12c2` — feature flags `ENABLE_TAP_MEASURE` / `ENABLE_FCB` (one-line kill switch; both degrade safely off).
- `2d34ec0` — GPS status pill is now a button → `requestLocation()` (turns GPS on when off, refreshes exact high-accuracy fix when on; watch guarded against duplicates).

**Empirical findings:** OSM green-polygon coverage measured across 11 courses (US munis, UK links, Australia, small-town muni) — 11/11 have green polygons, 0 node-only → F/C/B viable on free OSM. (Caveat: counts include practice greens → association required, done.) Plan + risk register: `wiki/synthesis/eagle-eye-next-level-plan-2026-06-06.md` (`c6899ec`).

**Remaining (Matt):** on-course device test (tap accuracy under rotation, F/C/B vs yardage book, reload-resume, wake lock, GPS refresh); merge `fix/osm-mirror-only`→main (G1, now pushed); untangle the concurrent marketing commit `836833f` from the branch for a clean PR; preview smoke-test → deploy. `main` is 1 local commit ahead (diagnosis log). Conscious skip: OSM-parser fixture test (avoided refactoring the sensitive parse path; new math already unit-tested).

## [2026-05-06] refactor | PushNudgeBanner — close the loop on missing push subs

After Matt scheduled a tee time for two friends (Daniel christie + James
Ashe) using the new manual scheduler, he asked whether they'd received a
push notification. They hadn't — a DB query against `tm_push_subscriptions`
showed both invitees had **0 rows**. The server-side push code in
`POST /api/games` ran cleanly but had no endpoints to push to, so it
silently no-op'd. The in-app surface was unaffected (game showed up in
their Upcoming Tee Times next time they opened the app, since that
polls `tm_game_participants` directly), but the OS-level alert never
fired.

Root cause was an awareness gap: invitees who skipped the
`PermissionsPrompt` on first sign-in never get re-prompted, so their
device's `Notification.permission` stays at `default` and
`ensurePushSubscription()` never registers them.

**Fix — `PushNudgeBanner.jsx`** (commit `5baf7ed`):
- Inline reminder rendered at the top of the TEE TIMES section on Home,
  only when the current user isn't subscribed
- Three states:
  - **`pwa-install`** — iOS Safari outside a home-screen install. Web
    push is impossible here until the app is installed. Banner shows
    "Add to your Home Screen" hint (Share → Add to Home Screen).
  - **`default`** — permission hasn't been asked. Inline "Turn on"
    button calls `Notification.requestPermission` then
    `ensurePushSubscription` — single tap to fix the gap.
  - **`denied`** — user previously declined. Banner explains
    "Enable in Settings → The Match → Notifications" because we can't
    re-prompt programmatically.
- Dismissible per user via `localStorage` (`tm-push-nudge-dismissed-<userId>`)
  so it doesn't nag once they've explicitly opted out.
- Re-checks state on `visibilitychange` (user came back from Settings).
- After a state flip to granted, calls `ensurePushSubscription()` once
  to make sure the server-side row gets written.

Wiring: imported into `Home.jsx`, placed inside the TEE TIMES
translucent-glass box just above the "+ Schedule a Tee Time" button.
Color tokens lean gold/amber to read as a heads-up rather than
urgent (red).

Why this surface specifically: TEE TIMES is where the missing-push
consequence bites hardest — when you invite a friend to a tee time and
they don't see the OS-level alert, they only discover it next time they
happen to open the app.

**Files:**
- `client/src/components/PushNudgeBanner.jsx` (new, ~165 lines)
- `client/src/pages/Home.jsx` (import + one usage)

Build passes (warnings about pre-existing duplicate `display` keys in
LiveOuting.jsx are unrelated; not drive-by fixed per code-discipline rule).

## [2026-05-06] refactor | Post-polish bug-cluster + UX fixes (live-fire pass)

After the polish pass landed (commit d472d35), Matt walked through it on
prod and surfaced a cluster of issues — some real bugs my "build clean +
math correct" self-review hadn't caught, some pre-existing latent bugs
that the polish pass exposed by exercising new code paths, and a stack
of UX gaps. Seventeen commits total, all on `main`.

**Real regressions / latent bugs found and fixed:**

- `0e6e157` — **TDZ on `handicap_overrides`** in LiveOuting. Function
  declarations like `netStrokes` are hoisted, but their bodies read
  `const handicapOverrides` which isn't. `computeBestBall(... netStrokes ...)`
  at line ~1959 invoked netStrokes ~100 lines BEFORE handicapOverrides
  was declared at line 2068. Latent for everyone whose scoring_formats
  didn't include `best_ball` — Matt's PLSL match was best_ball, so
  every Resume crashed with "Hooked Left · cannot access 'ci' before
  initialization". Fix: hoisted hcpAllowance / handicapOverrides /
  effectiveHandicap / netStrokes / netTotal above the bestBallData
  block.
- `ddd01d0` — **team_id missing on participants**. computeBestBall
  groups by `p.team_id` but the team mapping only exists on
  `state.teams[].member_ids`. Without hydration, every player fell
  into a `solo:user_id` bucket → leaderboard treated 4-player best
  ball as 4 singles. Fix: build a Map<userIdString, teamId> from
  state.teams before the participants pipeline, enrich each
  participant with team_id during the .map chain.
- `6a691dc` — **Best Ball ignored the GROSS/NET toggle**.
  computeBestBall received `netStrokes` unconditionally → totals were
  always net-adjusted even when the user had GROSS selected. Fix:
  pass a no-op `() => 0` when netMode is off; the real netStrokes
  only when on. Matches every other net-handicap path in LiveOuting.
- `8ace043` — **React error #310 (Rules of Hooks)**. My GROSS/NET
  auto-popover useEffect (`33f2898`) was placed after the
  `if (loading) return` and `if (!outing) return` early returns. On
  first render the early returns fired before reaching it; on the
  next render it executed → different hook count between renders →
  minified error #310 ('Rendered more/fewer hooks than during the
  previous render') → Hooked Left boundary. Fix: move the useEffect
  above the early returns, compute hasHandicaps inside the effect
  from outing.state directly. Audit script run across all polish-
  pass files confirmed no other hooks-after-return patterns.

**UX gaps closed:**

- `7744e62` — **Set Teams → 'Save & Start Match →'** label for
  first-time team setup (was the unhelpful "Save Teams"); editing
  mid-match still reads "Save Teams". Disabled state when no
  players are assigned + a soft hint underneath.
- `33f2898` — **GROSS/NET tooltip**. Small `?` icon next to the
  GROSS/NET chip; tap opens a portal modal with plain-language
  definitions of each term. Auto-pops once per user the first time
  they open a match where any non-guest has a handicap (gated by
  `tm-gross-net-help-seen` localStorage flag).
- `714ae0f` — **Tee picker dedupe** for the create wizard. Lifted
  EagleEye's existing `dedupeTees` helper into `client/src/lib/tees.js`
  and reused it in CreateWizard so each physical tee box renders as
  one row instead of one per gender (M / W / etc).
- `c5d774f` — **'+ Add Player' button** inside the TeamSetup sheet
  itself. Right after the wizard creates a match, the host has only
  themselves as a participant — there was no UI to actually build
  the roster from inside the team-setup sheet. Now opens GuestModal
  (search-as-you-type for app users, fall back to named guest), then
  re-fetches the outing so the new player appears in unassigned and
  can be tapped onto a team.
- `7cd86f0` — **SCORECARD/BOARD toggle visibility**. Earlier
  translucent-white on cream was washed out; redesigned as a solid
  forest-green pill with a gold-gradient active capsule. Same bar
  as the GROSS/NET chip and the +Add Player button.

**Multi-format scoring (the big one):**

- `e66803c` + `8cc80b5` — **Team standings + team match-play in BOTH
  scorecard AND board views**. Previously the team-standings card
  was gated on `isBestBallFormat` AND `effectiveViewMode === 'board'`,
  so picking Match Play with 2 teams of 2 (= four-ball match play)
  rendered as singles. Now any team-shaped outing computes
  bestBallData; for `match` format with exactly 2 teams the card
  also shows live match-play state ("Matt/V · 1 UP · thru 4",
  "DORMIE 2", "WINS 3&2", etc.). Card bg moved to solid green for
  contrast on the cream page.
- `00955cb` — **Wizard format step → multi-select**. Each format is
  now an independently-togglable card with a gold-gradient checkmark
  square; default is `['stroke']`; at least one required; gold hint
  banner at the top teaches the two common combos:
  `Match Play + Best Ball = four-ball match play` and
  `Stroke + Skins = round with skins side bet`. Fixes Matt's
  question 'four ball match play literally is match play + best ball
  no?' — yes, so let users pick both explicitly.
- `8b263d3` — **'Active formats' chip strip** above the leaderboard
  showing every selected scoring_format as a gold-border pill so
  the user knows what the rest of the page is rendering.
- `2712447` — **Explicit section headers** inside the team-standings
  card and above the per-player MatchScoreboard:
  `MATCH PLAY` / `BEST BALL · TEAM TOTALS` / `STROKE PLAY · INDIVIDUAL`
  (label adapts: SKINS · INDIVIDUAL when skins, STABLEFORD when
  stableford, MATCH PLAY · HEAD TO HEAD for 1v1 match). Closes
  Matt's confusion 'im only seeing scores for stroke im not seeing
  the scores for match'.
- `21faecb` — **Team card visual unification with the individual
  board**. Restyled to translucent white-glass with backdrop blur,
  dark text, gold border (matching MatchScoreboard exactly).
  Side-by-side 38px square avatars per team member (Matt:
  'profile pictures side by side for each team member in the team').
  Up to 3 visible avatars per team with a `+N` chip for foursomes.

**Tab + match management:**

- `c09bd0c` — **Pull-to-refresh preserves tab**. Earlier reload
  always landed on Home because tab state was in-memory only. Now
  saved to `localStorage` under `tm-last-tab` on every tab switch,
  read via lazy initializer on mount, validated against the TABS
  whitelist on read.
- `28dc459` — **Warn-on-create when host has an unfinished match**.
  At the start of `handleCreate`, fetch `/api/outings/recent`, find
  any outing the user hosts with status='active'. If found, native
  confirm prompts to end-it-and-continue. Cancel bails out of the
  wizard; OK auto-ends the stale match via `POST /:code/end` then
  proceeds. Best-effort guard — network errors don't block creation.

**DB-side cleanup (manual, not a commit):**

Three stale `active` outings that had accumulated in Matt's account
from testing (NMPC, 75LQ, GFB5) were closed via direct
`UPDATE tm_outings SET status='closed'` so Live Now would be honest
again. Done in conjunction with `28dc459` so the going-forward guard
prevents re-accumulation.

**Process lessons captured:**

- Bundle-hash diff is a cheap, decisive proof that source changes
  actually reached the artifact. After my first Stats.jsx "fix"
  produced byte-identical output (rollup deduplicated the
  export+import to the same code), I now check the bundle hash
  changed before declaring a fix shipped.
- 'Build clean' ≠ 'works'. Vite/rollup can't catch hooks-after-
  return (runtime-only) or mid-render TDZ on hoisted-function
  closures. Need an actual end-to-end click-through before the
  push or risk shipping regressions like the #310.
- For any new useEffect / useState added to a file with early
  returns (like LiveOuting's `if (loading) return`), grep for
  early-return lines BEFORE the new hook and confirm placement.

## [2026-05-06] refactor | Polish-pass batch — tasks 1-8 + 10 (App-Store prep)

Shipped a 9-feature polish pass on the live app in one session. Order: 1-4 → self-review → 5-7 → self-review → 8 + 10 → self-review.

**Task 1 — Haptic feedback on score entry.** New `tmHaptic(ms)` helper in `Outing/shared.jsx` (guarded `navigator.vibrate`, no-ops on iOS). Wired into all five score-commit sites: ScoreModal save + Save&EagleEye, BulkScoreModal handleSave, ActiveRound quick-pick par chips + Save Round button.

**Task 2 — Pull-to-refresh Augusta pin-flag.** Replaced the chevron in App.jsx PullIndicator with a hand-drawn pin-flag SVG. Flag triangle scales out (scaleX 0.05 → 1.0) as the user pulls — "raising the flag" metaphor. Pole color flips white-on-green when ready; spins via tm-spin while refreshing. Forced flagScale=1 once `ready` so the spinning state doesn't show a sliver flag.

**Task 3 — Better empty states.** New `components/primitives/EmptyState.jsx` with three Augusta-tinted SVG icons (pin-flag, scorecard, trophy), tone-aware (light vs dark modal). Wired into FollowList (Following/Followers), RoundHistory ("Your scorecard's blank"), RivalryHistory ("No rivals yet").

**Task 4 — Match-end share image.** New `Outing/MatchEndShare.jsx` — 1080×1080 Canvas card with trophy icon, winner name + score, top-3 podium, optional highlights line, date footer. Reuses HighlightShare's pipeline. Triggered from EndMatchScreen via a "Save share image" button alongside the existing text + live-link share buttons.

**Task 5 — Achievements / badges.** New migration `020_tm_achievements.sql` (table + UNIQUE (user_id, type) + earned-DESC index). New server lib `lib/achievements.js` — three v1 types: `first_eagle`, `sub_80`, `streak_week` (≥3 rounds in last 7 days, counts both tm_rounds and tm_outing_participants). Hooked into all three score-write paths: PUT /:code/scores, PUT /:code/scores/host (credits the player not the writer), POST /api/rounds. New endpoint `GET /api/profile/achievements`. Client: `components/AchievementToast.jsx` (mounted at App level, listens to `tm:achievement-earned` window event so it survives ActiveRound's post-save unmount), `components/AchievementsRow.jsx` (Profile badge row, refreshes on event).

**Task 6 — Handicap-trend milestone copy.** New `computeHandicapMilestone(rounds)` in Stats.jsx — five priority signals (personal best / first sub-80 / improving vs prior 5 / declining vs prior 5 / steady). Renders as a single gold-bordered line above the Score Trend chart inside HcpBadge, hidden when no notable signal.

**Task 7 — Side bets MVP (Nassau, presses, skins).** New migration `021_tm_side_bets.sql`. New compute lib `client/src/lib/side-bets.js` — pure functions for Nassau (front 9 / back 9 / total 18 with manual presses) and Skins (carryovers, multi-player). Server endpoints (host-only declare/press/delete) appended to outings.js. New `Outing/SideBets.jsx` — declare wizard + standings card (Nassau segment chips, Skins ranked list with carryover banner). Side Bets button on LiveOuting header for both host AND non-host.

**Task 8 — Live group chat per outing.** New migration `022_tm_outing_messages.sql`. Server endpoints `GET /api/outings/:code/messages?since=ID` (cursor pagination) and `POST` (500-char cap). Membership-gated — must be a participant or host. New `Outing/OutingChat.jsx` — bottom-sheet with avatar+name+relative-date bubbles, polling every 5s while open, optimistic-ish append on send, Enter-to-send / shift+Enter for newlines, autoscroll, empty state with personality.

**Task 10 — Year-end recap card.** New `Outing/YearRecap.jsx` — pulls from `/api/rounds?limit=400`, aggregates client-side (rounds played, best round + diff, sub-80 count, eagles, birdies, top course), renders 1080×1080 Canvas card with stats grid + share/download. Profile entry button "Your year in golf — YYYY".

**Self-review notes:** All three batches built clean (final bundle 911 kB / 233 kB gzip). Server-side achievement detection awaited (Vercel lambda freeze pattern). All animations use existing keyframes (`tm-celebrate-pop`, `tm-spin`, `tm-saved-flash`). Ten new files; one canonical migrations sequence (020/021/022) applied to Supabase via psql.

**Deferred to future sessions (also tracked in mlav1114.md):**
- **9. Eagle Eye automatic shot tracking** — ~half-day; needs design conversation about GPS pinging cadence + battery cost.
- **11. Privacy policy + delete-my-account flow** — App Store submission prereq. Need policy text + a `DELETE /api/me` endpoint that cascades the user's data.
- **12. Sentry / error telemetry** — wire `@sentry/react` + `@sentry/node`, scrub PII, instrument the score-write + auth paths.
- **13. Anthropic spend cap** — Matt to set a budget alert on console.anthropic.com (no code change).

## [2026-05-03] refactor | User-shape centralization + 10-round audit

Two prod bugs shipped in one earlier session because `/login` and `/signup` had drifted from `/me`'s SELECT. Login was missing `onboarding_completed_at` (made every existing user re-see the wizard) and `tier` (blocked Matt — `elite` admin — from leagues with a "free tier upgrade" wall). DB had the right values; response shape was wrong.

**Fix architecture (defense-in-depth):**

- `server/src/lib/user.js` (NEW) — single `USER_PUBLIC_COLUMNS` constant. `USER_PUBLIC_COLUMNS_WITH_PIN_HASH` for the one place that needs it (login bcrypt). `sanitizeUser()` strips pin_hash before res.json. `REQUIRED_USER_FIELDS` lets tests assert the contract.
- `server/src/routes/auth.js` — all three endpoints (`/signup`, `/login`, `/me`) now select via `USER_PUBLIC_COLUMNS`. `/login` passes through `sanitizeUser()` before responding.
- `server/src/middleware/auth.js` — `req.user` hydrated with the FULL user shape, eliminating the silent-undefined footgun where a narrow SELECT misses a field.
- `server/src/routes/profile.js` — `GET /` already used the constant; the `UPDATE` statements in `/profile/update` and `/profile/avatar` had narrow `RETURNING` projections (returned 7 / 3 columns instead of 13). Both now `RETURNING ${USER_PUBLIC_COLUMNS}`.
- `server/src/middleware/requireElite.js` — re-fetches `tier` directly from DB on every gated request, so even future `req.user` drift doesn't break tier gating.
- `server/test/user-shape.test.js` (NEW) — 13 Vitest unit tests pinning the contract; `npm test` runs in 3ms.
- `scripts/smoke-test-auth.js` (NEW) — 50 HTTP-level checks against prod (signup → login → /me round trip + security boundaries). `npm run test:smoke`.

**10-round audit results — all green:**
1. Auth shape smoke test → 50/50 pass
2. profile.js `RETURNING` projections → fixed (commit 236b1b4)
3. OWASP sweep (SQLi, CORS, rate limits, stack leaks, pin_hash exposure) → clean
4. Push notification stack (VAPID trim, test push) → HTTP 201
5. Friends/follows endpoints, mutuals removal verification → clean
6. Signup → login → /me round trip producing identical shapes → ✓
7. Tier gates: elite passes, free gets clean 402 with structured payload → ✓ both directions
8. Pending changes committed + post-deploy verified → ✓
9. Smoke test re-run vs post-deploy prod → 50/50 pass
10. Vitest unit tests + final state → 13/13 pass

**Commits:** `7877440` (login onboarding fix), `590f87c` (login tier fix), `fc70cd5` (centralize), `2c075c7` (extend to middleware/profile), `038763f` (vitest), `236b1b4` (profile.js RETURNING).

**Known follow-up (tracked in `wiki/HIGH-PRIORITY-TODO.md`):** prod `JWT_SECRET` is still the literal placeholder `"change-me-to-a-long-random-string"`. Rotation will log everyone out, so deferred until after tomorrow's round.

The class of bug — "endpoints that return the same conceptual object hand-roll different SELECT lists" — is now both impossible to introduce by accident (constant) and caught immediately if introduced anyway (vitest + smoke test).

## [2026-04-30] refactor | Match page perfection — 4-phase rebuild

After light-theme conversion, Match page still had information-design gaps. Critique surfaced 7 specific issues; this pass closes them all.

**Phase 1 — content density:**
- `/api/outings/recent` enriched: now returns `opponent_names[]`, `created_at`, `updated_at` (subquery over `tm_outing_participants` filtered to `user_id <> $1`).
- New `<RecentMatchCard />` reads "You vs Dale" / "You vs Dale & Chris" / "You vs Dale +2" instead of repeating the boilerplate match name.
- `relDate(iso)` helper produces "Today / Yesterday / Mon / Mar 12" labels.
- `copyCode(code)` async helper with `navigator.clipboard.writeText` + textarea fallback for older browsers and iOS PWA.
- Tap-to-copy code chip with 1.4s `✓ Copied` confirmation flash.
- `EmptyRivalries` collapsed from 200px card to 40px one-liner.

**Phase 2 — Live Now strip:**
- New `<LiveMatchCard />` promoted ABOVE primary CTAs when any match has `status === 'active'`.
- `.tm-live-pulse` keyframe in `tokens.css` — 1.6s opacity+scale loop.
- Header copy adapts: "You have 2 matches in progress." vs default subtitle.
- Live cards use green-tinted gradient (`rgba(46,158,69,0.18)` → `rgba(255,255,255,0.85)`) to differentiate from regular cards without going dark-on-dark.
- `Recent Matches` now filters to `status !== 'active'` (no double-rendering).
- LIVE cards capped at `MAX_LIVE = 3` with `+ N more in progress` expand link to prevent stale-data tail dominating the page.
- "You vs <match name>" bug fixed: when `opponent_names` is empty, title falls back to `o.name` and a `Waiting for players` chip renders instead of awkward "You vs Matt Lavin's Match".

**Phase 3 — CTA hierarchy:**
- Solo Round + Leaderboard demoted to thin icon-pill row (~30px tall vs ~50). Smaller text, smaller icons, lighter background.
- Reclaims ~40px vertical for actual match content.
- "+ Create" stays the dominant primary action.

**Phase 4 — polish:**
- Search input appears next to "Your Rivalries" header at `rivalries.length >= 5`.
- "No rivalries match 'X'" empty state for filtered search.
- Course pin icon on cards once `course_name` is set.

**Files touched:** `server/src/routes/outings.js`, `client/src/pages/Outing.jsx`, `client/src/design/tokens.css`. No schema changes. No Eagle Eye changes (preserved the careful work from 2026-04-29).

**Commits:** `f23ea41` (initial 4-phase rebuild), `49c2680` (cap + "Waiting for players" fix). Both deployed to Vercel via `vercel --prod --yes` after each commit (auto-deploy still broken, see open todo).

## [2026-04-30] refactor | Augusta Scoreboard — surface + perfect Masters replica

User feedback: "i thought we built the augusta scoreboard for the match page" — the previous Match-page refactor demoted Leaderboard to a tiny icon button. Then: "it needs to replicate it perfectly" — the board itself was white-on-white, didn't actually look like Augusta. Then: "make the board take up the whole page too" — the board only filled the top half with empty green space below.

**Phase A — Match-page hero card:**
- Replaced the demoted Solo Round + Leaderboard icon row with a full-width Augusta-themed hero card.
- Forest green (#0F3D1E → #1a5c1a) gradient with gold M-flag emblem on the left, italic Georgia "Augusta Scoreboard" title, gold subtitle, and "Open →" affordance in gold.
- Subtle wood-grain stripes via `repeating-linear-gradient`.
- Solo Round demoted to a smaller secondary pill below the hero.

**Phase B — perfect Augusta board replica (`AugustaBoard.jsx`):**
- Body color: forest green (`#0F3D1E`) with deeper-green panel cells (`#0a2c14`) — was cream/parchment.
- "LEADERS" header: gold block letters on green with text-shadow (was black on white).
- HOLE row: white block letters on green (was black).
- PAR row: gold/yellow numerals on green — the iconic Masters detail (was black on white).
- Player rows: green panel for PRIOR + NAME + F9/B9/TOT columns. Player surname only, in white block-letter caps (real Masters board shows surnames not full names). Current user gets a 4px gold left-border accent and a slightly-lighter green row tint.
- Score cells: cream tiles (`#F4E9C1`) with thick black borders, red numerals for under-par (`#B22222`), ink for over-par (`#0F0F0F`). Birdie = single red circle, eagle = double red circle. Bogey = single black square, double = double square.
- Added F9 / B9 / TOT columns at the right (real Masters board has these; previous version was missing). Round total is gold and bigger.
- Removed the photo column (real Augusta board has no player photos).
- Wood-frame border (`#5a3a16`) around the entire board with deep `box-shadow`.
- Footer: gold "Augusta National Club Golf" italic on dark plaque with M-flag bookends.
- Add Player UI moved INSIDE the board frame, just above the footer — gold-on-deep-green so the entire board reads as one cohesive framed unit. Cream input field with gold border, gold "+ ADD PLAYER" button.

**Phase C — fill the whole page:**
- Outer wrapper: `display: flex, flexDirection: column, minHeight: 100dvh`.
- Board container: `flex: 1` to grow into the available viewport.
- Scrollable grid inside the board: `flex: 1` so the table fills the panel.
- Added 8 placeholder rows with cream-tinted score cells so the empty state reads as a real Masters board with open slots, not a half-empty grid.
- "Add a player ↓" italic gold hint in the first empty row when no players yet.
- Now the board reaches from the top of the viewport down to just above the bottom nav, with the Add Player input + Augusta plaque pinned to the bottom of the frame.

**Verified live by adding "MATT LAVIN", entering 3 (birdie) on hole 1 par 4, 8 (double bogey) on hole 2 par 5, 4 (par) on hole 3.** PRIOR column correctly shows `+2`. Red circle around the 3, double black square around the 8, no marker on the 4. All visual indicators working.

**Commits:** `ab0229b` (initial replica), `125e47b` (full-page fill + Add Player inside frame). Touched: `client/src/components/AugustaBoard.jsx`, `client/src/pages/Outing.jsx`. No schema, no Eagle Eye changes.

## [2026-04-30] refactor | Augusta board color correction (teal-sage, not forest green)

User shared a photo of the actual Masters scoreboard. The iconic Augusta panels are **pale teal-sage** (#A8C9C2), not forest green as I had built. Text on the panels is **black**, with red for under-par scores. Forest green is reserved for the wooden frame and the F9/B9/TOT divider strips.

**Color corrections in `AugustaBoard.jsx`:**
- Panel background: forest green → `MASTERS_TEAL #A8C9C2` (PRIOR, NAME, HOLE row, PAR row, empty placeholder rows)
- Player surname text: white → `MASTERS_INK #0F0F0F`
- PRIOR (score-to-par): gold/white → black for over-par, red for under
- PAR row numerals: gold → black on teal — the real board's iconic detail
- HOLE row numerals: white → black on teal
- F9/B9/TOT divider strips: still dark green with white numbers (matches the green dividers on the reference photo)
- LEADERS banner: gold-on-green → dark-green-on-cream (the real board has a cream/tan arched banner with dark green letters)
- Score tiles: warmer cream `#F2EBD3` (was `#F4E9C1`)
- Empty placeholder rows: teal panels with the cream tile slots
- 'Add a player ↓' hint: gold → dark ink (now readable on teal)
- Add Player section: gold-yellow gradient → simple teal button on dark-green strip (feels like the operator panel area at the back of a real roller board)
- Footer plaque: still dark green, but text now white (was gold) to match the cream-banner-on-green color logic of the rest of the board

**Commit:** `1b24a77`. Touched: `client/src/components/AugustaBoard.jsx`. No new dependencies.

## [2026-04-30] refactor | Scoreboard late-night polish marathon

Major aesthetic overhaul of the in-match scoreboard (LiveOuting + ScorecardTable + TotalsRow). Captured here as one entry; individual commits below.

**Premium tournament-board redesign** (`0a3997f`) — replaced the teal panel scheme with deep forest green panels, white block-letter HOLE row, gold PAR numerals, cream score tiles with inset shadows, embossed cream LEADERS plaque with gold rules, wood frame with gold pinstripe.

**Border / alignment cleanup rounds** (`167b1bc`, `fd2e484`, `bbee166`, `7c910e4` reverted, `3e4265f`, `56b0dad`, `76625f6`, `509cc4e`):
- Switched cell borders from full `border` (caused 2px between body cells vs 1px between header cells) to `borderLeft`-only so dividers run continuously through every cell.
- Unified score cell bg to solid cream everywhere (was `rgba(...,0.55)` over a green gradient = murky olive that read as "row ran out").
- Subtotal cells (OUT/IN) matched body color to header color (`AUGUSTA_GREEN_DEEP` everywhere) so the rightmost column reads as one continuous strip.
- Removed the `inset 0 -1px 0` bottom highlight that was making score cells look 1px taller than subtotal cells next to them.
- Each row now uses `width: max-content + minWidth: 100%` so the row's `borderBottom` spans the full content width, not just the visible scroll-container width — fixes the "lines cut off mid-row" bug after the avatar column was added.
- Restored `cellBorder()` helper that ScoreModal still referenced (regression).

**Tier-1 polish** (`c090480`):
- New leftmost RANK_COL with leaderboard position (1, T2, 3…). Leader's badge gets a gold gradient.
- Leader gold highlight on the surname (was just gold for current user).
- THRU subtitle ("THRU 7" / "F") under the player's surname instead of buried in the bottom totals row.

**Tier-2 polish** (`c6b2537`):
- Wood-grain texture on the frame (vertical repeating-linear-gradient grain lines + highlights over a brown gradient).
- Active-hole flag pin (small gold-flag SVG) sits on the HOLE row over the next-to-be-played hole.
- Match-play status banner promoted from inside the header to a prominent broadcast-style banner above the wood frame.

**Tier-3 polish** (`6f8ff99`):
- Score reveal animation — every score numeral wrapped in a span keyed by `score+par`. When score changes, React remounts → triggers `tm-score-reveal` keyframe (380ms scaleY 0.10 → 1.15 → 1.0 with bounce). Mimics manual-flip Masters scoreboard.
- Recent-event banner — when `saveScore` lands, a gold-or-green pill pops down for 4s with the player surname, score label (EAGLE/BIRDIE/PAR/BOGEY/DOUBLE), and hole number.

**Tap hint + instruction removal** (`d18e06b`):
- New `findTapHint()` walks sorted players to find the first empty cell the current user can edit. Returns null once any score has been entered.
- `tm-tap-hint` keyframe pulses a 2px gold inset ring + outer gold glow on the matched cell so first-time users know where to tap.
- Removed "Tap any cell to enter scores" instructional copy from the host-controls row — the pulsing cell teaches the same thing.

**Color swap + translucency experiments** (`ddbc0bf`, `651dcd2`, `f2ce728`, `ca40c78`):
- Green→white panel swap, white→green text swap.
- AUGUSTA_TEXT bumped to a richer #1A6B28.
- All AUGUSTA panel surfaces moved to rgba alphas (0.55–0.65) so the page fairway grass shows through. Cream tiles + wood frame translucent too. Backdrop-filter blur(10px) on the inner board for glass-morphism. `LiveOuting` page bg switched from dark green gradient to transparent so the fairway image is the new backdrop.

**Bug fixes from feedback**:
- `49c2680` — "You vs Matt Lavin's Match" string (when no opponents have joined): show "Waiting for players" subtitle instead.
- Scrolled-right border misalignment: unified body + header cells to share borderLeft pattern.
- LiveOuting header clipping behind iOS notch: `padding: calc(var(--safe-top) + 14px)` so it clears the safe-area-inset.

**Session commits (15+ total today)**: `0a3997f` `167b1bc` `fd2e484` `bbee166` `3e4265f` `56b0dad` `76625f6` `509cc4e` `c090480` `c6b2537` `6f8ff99` `d18e06b` `ddbc0bf` `651dcd2` `f2ce728` `ca40c78` and supporting wiki/log entries.

**Files touched**: primarily `client/src/pages/Outing.jsx` (the LiveOuting + ScorecardTable + TotalsRow) and `client/src/design/tokens.css` (3 new keyframes: `tm-score-reveal`, `tm-event-pop`, `tm-tap-hint`). No schema changes. No Eagle Eye changes.


## [2026-04-30] refactor | Path A — Augusta is the only scorecard

User direction: "this needs to be the scorecard for every match you enter, it shouldnt have its own button it should be the only scorecard and the size of the rows can be a minimum of 4 rows that fit the screen if its a match of only 4 or less".

Two paths considered. Picked **Path A** (Augusta visuals on `LiveOuting`, retire standalone `AugustaBoard`). Path B would have rebuilt scoring from `AugustaBoard` and ported all the server logic — too much regression risk for purely visual gain.

**LiveOuting + ScorecardTable + TotalsRow restyled:**
- Page background: dark forest green gradient (was transparent)
- Header strip: dark green with white italic title and gold code chip
- Wood-frame panel wrapping the scorecard with cream `LEADERS` banner
- HOLE / PAR rows: black numerals on pale teal panel (`AUGUSTA_TEAL #A8C9C2`)
- Player rows: white block-letter SURNAME caps on teal; current user gets a gold left-border accent
- Score cells: cream tile (`AUGUSTA_TILE #F2EBD3`) with red numerals for under-par, ink for over; birdie = single red circle, eagle = double; bogey = single black square, double = double square
- Subtotal columns (OUT / IN): dark green strip with white block letters
- TOTALS strip: dark green panel with white SURNAME, white TOT/+/-/THRU; gold for under-par, light red for over
- Match-play winning cells: light gold tile w/ green border; losing: light red tile w/ red border; halved: dashed border
- Augusta plaque footer with M-flag bookends

**Row sizing (the user's "min 4 rows that fit the screen" requirement):**
- `MIN_ROWS = 4`. When the match has ≤4 players, real rows render at 80px and the table appends `4 - participants.length` filler placeholder rows (teal panel + cream tile slots) so the board always shows 4 rows.
- When the match has >4 players, rows shrink to 56px and the body scrolls vertically.
- Avoids stretching a single LAVIN row to 180px tall (looked terrible).

**Add Player modal — search-as-you-type:**
- Type 2+ chars → debounced 250ms call to `/api/friends/search?q=…`
- Matching app users render as a tappable list with name + email + handicap; click to bulk-join via `/api/outings/:code/bulk-join`
- "Add as guest" button always available — falls back to the original `/guests` endpoint for players without an account
- Fixes the previous behavior where the only path was manual guest entry

**Removed:**
- `AugustaBoard` import (`from '../components/AugustaBoard.jsx'`) — the file still exists but is no longer wired up
- The standalone `view === 'board'` route in the main `Outing` wrapper
- The Augusta Scoreboard hero card on the Match tab
- The `onLeaderboard` prop wiring through `OutingHub`

**Color constants extracted to module level** at the top of `Outing.jsx` (`AUGUSTA_GREEN`, `AUGUSTA_TEAL`, `AUGUSTA_CREAM`, `AUGUSTA_TILE`, `AUGUSTA_RED`, `AUGUSTA_INK`, `AUGUSTA_WOOD`, `AUGUSTA_GREEN_DEEP`, `AUGUSTA_TEAL_HOVER`).

**Commits:** `fbe1774` (initial Path A), `825ae55` (filler-rows fix). Touched: `client/src/pages/Outing.jsx`. No schema, no Eagle Eye, no server changes (server already had `/api/friends/search` and `/api/outings/:code/bulk-join`).

## [2026-04-30] refactor | Profile pictures on the Augusta scorecard

User wanted player photos on the scorecard alongside the surname caps.

**Server change** — `/api/outings/:code` now enriches each non-guest participant with `u.avatar` (data URL) from `tm_users`. Guests don't have avatars (they have no account); they get the initials fallback.

**Client change** — new `<PlayerAvatar />` component in `Outing.jsx`:
- Renders an `<img>` of the user's uploaded photo when `avatar` is set
- Falls back to initials on a deterministic background color (same palette as the original AugustaBoard helpers — `#1B5E20`, `#0D47A1`, `#6A1B9A`, etc.)
- Configurable size + ring color so it can be themed differently in `ScorecardTable` (white-ish ring on teal panel) vs `TotalsRow` (gold ring on dark green strip)

**Layout adjustments:**
- `PLAYER_COL` bumped from 90 → 116 to fit the avatar + surname inline without truncation
- Avatar size auto-scales with `rowH` (capped at 36px) so larger row heights for ≤4-player matches show bigger photos
- Current user's avatar still gets the gold ring + the row's gold left-border accent

**Verified live** — joined a match, saw the LAVIN row with my actual profile photo to the left of the surname; entered scores 5 (bogey, black square), 3 (birdie, red circle), 6 (double, double square), 2 (eagle, double red circle), 4 (par, no marker). All markers + colors firing correctly.

**Commit:** `215cd2d`. Touched: `server/src/routes/outings.js`, `client/src/pages/Outing.jsx`. No schema (avatar/cutout columns already existed in `tm_users`).

## [2026-04-30] schema | Real per-hole pars from a course picker (closest-first)

User direction: "i want the hole number and par for the hole information show exactly what the course your playing is" — they want the actual pars for the course being played (not the synthetic 4/3/5 distribution from `estimateHolePars`). Then: "full picker but make courses closest to you start showing up first after you type first two letters".

**Migration `006_tm_outing_course_data.sql`** — applied to production Supabase. Added five nullable columns to `tm_outings`:
- `course_id INT` — GolfCourseAPI course ID
- `course_tee TEXT` — name of the chosen tee (Black, White, etc.)
- `hole_pars JSONB` — array of pars per hole
- `hole_yardages JSONB` — array of yardages per hole
- `hole_handicaps JSONB` — array of stroke indices per hole

**Server changes:**
- `POST /api/outings` accepts `courseId`, `courseTee`, `holePars`, `holeYardages`, `holeHandicaps` and stores them; legacy create calls without these fields still work (columns are nullable).
- `GET /api/outings/:code` already used `SELECT *` so the new fields flow through automatically.
- `/api/courses/search` accepts `?lat=Y&lng=Z`. When provided, computes Haversine great-circle distance to every result and sorts ascending (unknown distances go last). Falls back to API order without coords.

**Client changes (`Outing.jsx`):**
- New `<CoursePicker />` component replaces the free-text "Course name" input in CreateWizard step 0:
  - Requests browser geolocation silently on mount; passes coords to search if granted (so closest courses appear first per the user's request)
  - Debounced 250ms search after 2+ chars hits `/api/courses/search`
  - Results render with city/state and distance (auto-formatted: meters / km / rounded km)
  - Click a course → loads `/api/courses/:id` → tee selector renders with `par_total`, `total_yards`, `course_rating/slope_rating` per tee
  - Click a tee → captures full `hole_pars`/`hole_yardages`/`hole_handicaps` and shows "✓ Pebble Creek Golf Course / Black tees · Par 71 · 18 holes" with a Change button
  - Free-text fallback retained: "Can't find it? Just leave the name typed — we'll use your course name without the per-hole pars."
- `LiveOuting` now prefers `outing.hole_pars` (sliced to the match's hole count). Falls back to `estimateHolePars(coursePar, holeCount)` for legacy matches with no real data.

**Verified live** by creating a fresh match with Pebble Creek Golf Course → Black tees:
- Header reads "Pebble Creek Golf Course · Par 71" (was "TBD · Par 72")
- PAR row shows the real Pebble Creek Black-tee distribution: Front `4-4-4-4-4-3-4-3-5`, Back `4-3-5-3-4-5-3-4-5`
- Augusta scorecard birdie/bogey markers continue to compute against these real pars
- Geolocation in Chrome MCP wasn't granted so distance sort wasn't visible in the UI — graceful degradation worked (results came back in API order)

**Commit:** `50fbcbe`. Touched: `migrations/006_tm_outing_course_data.sql`, `server/src/routes/courses.js`, `server/src/routes/outings.js`, `client/src/pages/Outing.jsx`.

## [2026-04-30] refactor | PlayerCard: match the Tour-page PGA photo style exactly

User direction: "i want the photo generator for users to give that exact same look... right now the flags are diagonal with a white shade at the bottom and name and i dont want that, i want it to look exactly like how the actual pga players pictures look on the tour page".

Reference look — `PlayerPhoto` in `PGAScores.jsx` is a faded full-cover country flag (`opacity: 0.18`) with the headshot layered on top, top-aligned. Nothing else. Mirrored that treatment in the avatar generator:

**`PlayerCard.jsx` — flag definitions:**
- Each entry now carries an ISO code (`us`, `gb-eng`, `gb-sct`, `jp`, `fr`, `kr`, etc.) instead of a stripe-color array.
- New `flagUrl(iso)` helper returns `https://flagcdn.com/w1280/<iso>.png` — CORS-enabled, supports subdivisions like `gb-eng` and `gb-sct` for England/Scotland.

**`buildCard` rewritten:**
- Cream base for any flag transparency
- Country flag image, full-cover, drawn at `globalAlpha: 0.22` via a new `drawCover(ctx, img, x, y, W, H)` helper that mirrors CSS `object-fit: cover` (centered crop). Falls back to solid accent color at 0.16 if the image fails to load.
- Player cutout, full-canvas height, top-aligned (mirrors `objectPosition: top center`)
- **Removed:** `drawFlagBg` (diagonal parallelogram stripes), the cream info-panel gradient, the accent line + glow, the country-name overlay, the player-name overlay, the handicap/course/wins-losses stats row, and the `THE MATCH` watermark.
- Card output is now: faded country flag + player cutout. Nothing else. Same compositional DNA as the Tour-page `PlayerPhoto`, just bigger.

**Mini flag preview in `CustomizeScreen`:** swapped from canvas-drawn diagonal stripes to a real `<img>` from `flagcdn.com/w80/<iso>.png` so the picker tile matches what gets composited onto the actual card.

**Backwards compat:** `buildCard(cutoutBlob, flag, profile)` keeps the old 3-arg signature (profile is ignored). Saved data URL still flows through `POST /api/profile/avatar` unchanged. Existing saved cards continue to work; users hit "Retake Photo" to regenerate in the new style.

**Commit:** `2796766`. Touched: `client/src/components/PlayerCard.jsx` (91 insertions / 152 deletions — net smaller).

## [2026-04-30] refactor | Scorecard avatar in its own filled box

User feedback: "i want the users pictures to have their own box to the left of the box their name is in so they arent scrunched together... make the picture fill out the box so adjust the size of the box the pictures go in accordingly".

Previously each player row in `ScorecardTable` and `TotalsRow` had a single combined cell of width `PLAYER_COL = 116` containing a 30-36px circular `<PlayerAvatar />` next to the surname (gap: 8). The avatar was small and the name was crammed.

**Split into two real cells:**
- `AVATAR_COL = 60` — square box; `<img>` fills edge-to-edge with `objectFit: cover` + `objectPosition: top center` (preserves the head on portrait PGA-style avatars). Initials fallback also fills the box edge-to-edge with a deterministic palette color.
- `NAME_COL = 88` — surname only, comfortably wide
- `PLAYER_COL = AVATAR_COL + NAME_COL = 148` — kept around so headers (FRONT 9 / PAR / TOTALS / BACK 9) span both cells visually with one combined cell.
- A vertical `1px solid AUGUSTA_GREEN_DEEP` divider separates the avatar cell from the name cell so the column structure reads clearly.

**Affected rendering paths:**
- ScorecardTable body player rows
- ScorecardTable filler placeholder rows (keep the same column geometry so things align)
- TotalsRow player rows (avatar fills the dark green strip; ring is gone since the cell border replaces it)

**Header rows (HOLE / PAR / TOTALS) untouched** — they still use one combined cell at `PLAYER_COL` width, which still equals the sum of the body's two cells. The columns line up.

**Current-user gold accent preserved** — the 4px gold left-border now lives on the avatar cell (the leftmost thing in the row); the cell width shrinks 4px when `isMe` so total row geometry still matches the header.

**Verified live** — the LAVIN row now shows the user's actual PGA-style portrait card filling its avatar box, with "LAVIN" surname and score cells flowing cleanly to the right. Filler rows render empty avatar + empty name cells preserving the layout.

**Commit:** `59fd7ed`. Touched: `client/src/pages/Outing.jsx`.

## [2026-04-30] refactor | Scoreboard premium tournament-board redesign

User feedback: "im not crazy about the teal color, there is no teal color on the actual augusta scoreboard.... page looks a little cheap, i want it to really impress visually". The earlier teal palette had been a misread of an off-tournament reference photo — the iconic in-tournament Augusta board is forest green with white block letters and gold PAR numerals.

**Palette overhaul:**
- `AUGUSTA_PANEL = #1A5230` (forest green) replaces `AUGUSTA_TEAL #A8C9C2`. Old `AUGUSTA_TEAL`/`AUGUSTA_TEAL_HOVER` constants kept as aliases so any stragglers still work.
- `AUGUSTA_PANEL_HI = #235C36` for the panel-gradient top stop.
- `AUGUSTA_GOLD = #E8C05A` (PAR numerals + accent) and `AUGUSTA_GOLD_DIM = #A8862E` (pinstripe / dimmed gold).

**Header rows (HOLE / PAR):**
- Switched from `flat teal + black text` to `panel gradient + white block-letter HOLE numerals with text-shadow` (chiseled feel) and `gold PAR numerals` — the iconic Masters detail.
- Header height bumped 32 → 34 px to give the bigger letterforms breathing room.

**Player rows:**
- White surname caps on the same panel gradient, with `0 1px 1px rgba(0,0,0,0.45)` text-shadow for embossed feel.
- Current-user accent: 4px solid `AUGUSTA_GOLD` left-border (was solid forest green) — actually pops as "this is you".
- Avatar cell sits on `AUGUSTA_GREEN_DEEP` with a subtle inner highlight so the player photo really stands out against the dark slot.

**Score tiles:**
- Cream tiles get a `inset 0 1px 2px rgba(0,0,0,0.18), inset 0 -1px 0 rgba(255,255,255,0.40)` box-shadow — mimics the slotted-into-the-wood feel of real Masters score cards.
- Subtotal cells (OUT / IN / TOT) get a deeper `inset 0 1px 2px rgba(0,0,0,0.50)` since they sit on the dark green strip.

**LEADERS plaque:**
- Cream → darker-cream gradient with `inset 0 -1px 2px rgba(0,0,0,0.18)` for embossed feel.
- Thin gold rules above and below the type (`top: 0` and `bottom: 4` absolute-positioned 1px strips) in `AUGUSTA_GOLD_DIM` at 0.55-0.7 opacity.
- Type switched from Impact to Georgia serif, letter-spacing widened from 0.16em → 0.20em for a refined look. Text-shadow adds depth.

**Wood frame:**
- Outer drop-shadow `0 16px 50px rgba(0,0,0,0.55)` for floating-on-the-page weight.
- Inner gold pinstripe ring (`inset 0 0 0 1px AUGUSTA_GOLD_DIM`) inside the wood, then a deeper inset dark ring for hand-painted-wood grain.

**Filler placeholder rows** match the new panel gradient + deep-green avatar slots so the empty-state board still reads as a tournament board.

**Verified live** — opened Pebble Creek match at Black tees:
- LEADERS plaque reads as an embossed cream sign with gold rules
- HOLE 1-9 in white, PAR 4-4-4-4-4-3-4-3-5 in gold
- LAVIN row with gold left-border, white surname, photo in deep-green slot
- Score 3 on hole 3 (birdie on par 4) shows red numeral + red circle on cream tile
- Footer plaque with M-flag bookends reads correctly

**Commit:** `0a3997f`. Touched: `client/src/pages/Outing.jsx` (palette constants + ScorecardTable headers + body + filler rows + ScorecardCell box-shadow + LiveOuting board frame + LEADERS plaque). 91 insertions / 49 deletions.

## [2026-05-01] refactor | Audit fixes proposal closed out — bookkeeping pass

Started the session intending to work the audit fix queue from `wiki/synthesis/audit-fixes-proposal-2026-04-29.md`. Discovered the entire "Recommended for immediate execution" list (12 items) plus the "Discuss before executing" item (F-R6) had already shipped on 2026-04-29 PM, but the wiki page still read as a proposal awaiting approval. Bookkeeping was stale — exactly the kind of state-mismatch anti-pattern that misleads future Claude sessions.

**Updated `wiki/synthesis/audit-fixes-proposal-2026-04-29.md`:**
- Changed status to `closed` in frontmatter
- Added a "CLOSED — all queued items shipped" header at the top with the three shipping commit refs (`1fa6ee4`, `8d74a76`, `93053ba`)
- Rewrote the TL;DR table: replaced the "approve" column with a "Status / Commit" column showing each item shipped
- Added F-R6A (legacy-row "#N of M" fallback) as its own row since it shipped autonomously
- Added a "Bonus shipped in autonomous batch" subsection (F-U3, F-B9, F-T7, F-T5, plus F-U5 + F-U10 discovered already done)
- Re-listed deferred items, with U1 explicitly flagged as **getting worse**: Outing.jsx grew 2,020 → 3,324 lines after the scoreboard / Augusta-board / Match-page rebuilds all landed inside the monolith
- Restated still-open items from the full audit that were NOT in the original proposal (B2/B10/B12, U2/U4/U6/U7/U8/U9/U11, T2/T3/T4/T6/T8/T9/T10, all F1-F14)
- Body of the original proposal preserved as historical record

**Updated `wiki/synthesis/audit-2026-04-29.md`:**
- Added a status header at the top noting most of the priority list shipped, with a forward-pointer to the proposal page for commit refs
- Re-marked the "Updated priority list (after runtime findings)" section: R1-R8 + B1/B7/B5 struck through with shipped commits; U1 / B8 / F2 / F8 still bolded as open
- Re-marked the "Recommended priority" section: items 1-3 struck through, items 4-5 (U1, B8) bolded as open
- Body of the audit unchanged (it's a historical snapshot)

**Important correction discovered:** an earlier read of the audit-fixes-proposal page implied U1 (split Outing.jsx + Home.jsx) might have shipped given all the recent scoreboard work in `Outing.jsx`. Verified by `wc -l client/src/pages/*.jsx`: no `Outing/` or `Home/` subdirectories exist, all the scoreboard / Augusta-board / Match-page rebuilds went *into* the existing monoliths. Outing.jsx grew from 2,020 → 3,324 lines (+1,304); Home.jsx 1,872 → 1,932; EagleEye.jsx 1,457 → 1,508. U1 is more urgent now than at audit time.

**Files touched:** `wiki/synthesis/audit-fixes-proposal-2026-04-29.md`, `wiki/synthesis/audit-2026-04-29.md`, `wiki/log.md`, `wiki/index.md`. No code changes. Next step: scope U1 properly as its own focused session.







## [2026-05-01] schema | end-of-session: onboarding triad shipped, tile-grid open

- Onboarding wizard (mandatory 5 steps) gates app access until step 4 (driver added). Lives at `client/src/components/OnboardingWizard.jsx`.
- Home checklist (`OnboardingChecklist.jsx`) and per-tab CoachMark primitive both shipped. Coach marks active on Home, Match, Eagle Eye, My Bag, Profile, PlayerCard.
- Admin gear icon on Home (gated on `tm_users.role = 'admin'`) opens `AdminUsersModal.jsx` showing all signups newest-first.
- Migration 012 added `onboarding_completed_at`, `onboarding_steps`, `coach_marks_seen`, and promoted Matt's account to admin. Migrations 009-011 also applied earlier in the session for bag inventory + per-club distance + outings.expected_players.
- Bag picker on Eagle Eye fully working: AI club recommend + ▲/▼ toggle + projected pulsing yellow landing target along aim line.
- Tour page fixed for new ESPN scoreboard payload shape.
- Match page swipe-left-to-delete on host's own active matches.
- Wizard now asks for # of golfers (`expected_players`).

**Open issue**: satellite tiles in Eagle Eye show visible grid lines after 5 CSS attempts (container bg, transparent outline, scale 1.01, GPU compositing, will-change). Likely root cause = leaflet-rotate plugin sub-pixel transforms. Full triage + ranked next steps in `wiki/synthesis/eagle-eye-tile-grid-handoff-2026-05-01.md`. Don't re-attempt the fixes already in `EagleEye.jsx`.




## [2026-05-04] refactor | Live-fire bug-bash session (friends on the course)

Matt's friends were testing the app on the course. Eight fixes shipped end-to-end + two new features. Every fix verified against prod logs / DB before declaring done.

**Fixes:**

1. **POST /api/outings TDZ crash** (`d046753`) — `state` literal referenced `leagueSeason` before its `let` declaration, ReferenceError on every match-create attempt regardless of league attachment. 100% of POST /api/outings was 504-ing for ~2 days. Hoisted the league-validation block above the state literal.

2. **/api/friends/search returning duplicate users** (`9e22ce0`) — LEFT JOIN against `tm_friends` with OR-on-both-directions multiplied result rows. With Matt's asymmetric friend model (A→B and B→A as separate accepted rows), every mutual friend appeared 2-3x in the add-guest search. Wrapped in `DISTINCT ON (u.id)` with status priority (accepted > pending > declined). Verified against prod DB: Daniel went from 2 result rows to 1.

3. **/api/friends list + /:friendId/profile same-shape bugs** (`03d4e2b`) — same multi-row pattern as /search. Friends list duplicated mutual friends; profile lookup picked an arbitrary row when multiple existed (could surface 'declined' over 'accepted'). Both fixed with `DISTINCT ON` + status priority.

4. **"Follow back?" prompt shown when already following** (`9631616`) — `handleFriendRespond` in Home.jsx unconditionally flipped into the prompt on every accept. When the user accepted a request from someone they already followed (mutual handshake completing), the prompt was wrong. Now checks `friends.friends` for the requester before adding to `followBackPrompts`.

5. **Latent string/number coercion bugs** (`b5997bf`) — three places where strict equality was comparing values that could be string vs number under different code paths:
   - `outings.js` POST `/:code/join` participant existence check
   - `outings.js` PUT `/:code/scores` state-sync findIndex
   - `follows.js` POST `/:userId` self-follow check (which never fired — users could self-follow). Verified 0 self-follows in prod, so latent only.

6. **Match tab safe-area inset** (`fb9a641`) — the "Matches" header had plain 20px top padding, sitting behind the iPhone notch / Dynamic Island. Changed to `calc(var(--safe-top) + 20px)` matching the convention already used in Leagues.jsx, EagleEye.jsx, and LiveOuting.

**Features:**

7. **Friends-playing-now feed** (`bcebb45`) — new section on the Match tab between Live Now and the Create CTAs. Shows any active outing where one of my accepted friends is a participant (and I'm not). Light-payload card per match (host, course, current hole, leader's score-to-par). Tap → in-app spectator view (`PublicLeaderboard` wrapped with a back chevron). 30s visibility-aware polling. Backend: `GET /api/outings/friends-live` declared before the `/:code` wildcard. Solo rounds (`tm_rounds`) deferred to v1.1 per Matt.

8. **Pull-to-refresh on every tab** (`d65ddd5`) — `overscroll-behavior: none` in tokens.css killed native iOS pull-to-refresh; re-added manually at the TabPanel level. Touch at scrollTop=0, drag down past 70px (damped 2x), release → `window.location.reload()`. Augusta-themed indicator chip slides in from top, chevron rotates 0→180° as the pull progresses, flips to gold "release-to-refresh" state at threshold, spins while reloading. `tm-spin` keyframe added to tokens.css. Available on every tab.

**Cosmetic:**

9. **Bottom nav: Match → Scorecard** (`70b5e6e`) — renamed the Match tab to "Scorecard" with a new clipboard-grid icon (`IconScorecard`). Trophy icon previously used by Match moved to the Leagues slot (better semantic match for leagues). `IconLeague` retained as an export but no longer used by BottomNav. Page header inside the tab still reads "Matches" per Matt — only the nav label changed.

**Audit pass — checked clean (no fix needed):**
- auth.js (signup/login/me — rate-limited, JWT round-trip clean)
- onboarding.js (atomic JSONB merge, whitelisted steps)
- rounds.js (solo round flow)
- profile.js (uses String()===String() correctly)
- notifications.js (push subscribe upsert)
- stats.js (minor edge case on empty club data, low priority)
- outings.js end/withdraw/cancel
- availability.js / games.js (multi-row pattern but neutralized by IN-clause set semantics or ON CONFLICT DO NOTHING)

**Data integrity probe (prod DB):**
- 0 duplicate emails
- 0 mismatched bidirectional friend statuses
- 0 stale active outings (>7d)
- 0 orphan participants
- 0 active outings missing host participant
- All participant user_ids in JSONB are strings (consistent)
- 1 orphan tm_follows row (Demo Player Three → Matt) — leftover demo data, cosmetic only, not deleted

**Verdict:** asymmetric friend model is intentional; the "duplicate Daniel" UI bugs were all in JOIN queries multiplying rows, not in the underlying data. No DELETE FROM statements run.




## [2026-05-06] refactor | Outing.jsx 7600 → split across 11 files (App-Store prep)

Multi-stage mechanical refactor ahead of App Store submission. The 7600-line `client/src/pages/Outing.jsx` megafile got split into a top-level entry-point router (192 lines) plus 10 focused sub-views under `client/src/pages/Outing/`. Pure mechanical move — zero behavior change. Six staged commits, each with a vite build verification:

| File | Lines | Purpose |
|---|---|---|
| Outing.jsx | 192 | Thin entry-point router (was 7600) |
| Outing/OutingHub.jsx | 815 | Landing page + match cards + RivalryDetail |
| Outing/LiveOuting.jsx | 3603 | Active scorecard + score modals + scoring math |
| Outing/Commissioner.jsx | 1572 | Host-only Manage panel + tabs |
| Outing/CreateWizard.jsx | 838 | 3-step match creation + course picker |
| Outing/CodeShare.jsx | 193 | Post-create share + QR modal |
| Outing/EndMatchScreen.jsx | 164 | Winner ceremony + podium + share |
| Outing/shared.jsx | 148 | Theme tokens + helpers + PlayerAvatar |
| Outing/GuestModal.jsx | 135 | Search-as-you-type add player |
| Outing/JoinSheet.jsx | 50 | Code-entry bottom sheet |
| Outing/SpectateView.jsx | 33 | In-app PublicLeaderboard wrapper |

**Stage commits (in order on main):**
- `a360118` Stage 1/6 — shared.jsx (theme + helpers + PlayerAvatar)
- `16c29b7` Stage 2/6 — leaf components (CodeShare, JoinSheet, GuestModal, EndMatchScreen, SpectateView)
- `fe4975e` Stage 3/6 — CreateWizard + CoursePicker
- `9629aea` Stage 4/6 — LiveOuting + scorecard infra (3500-line extraction)
- `2c81e93` Stage 5/6 — Commissioner panel
- `bf8c950` Stage 6/6 — OutingHub + cards (final, ships as one push)

**Caught during the work:** Stage 4 left LiveOuting.jsx referencing `<TeamSetup>` / `<GroupSetup>` / `<CommissionerPanel>` while those still lived in Outing.jsx. Vite's build "passed" because both files were in the bundle, but at runtime LiveOuting would have crashed when rendering those overlays. Stage 5 fixed it by exporting them from Commissioner.jsx and importing into LiveOuting. Lesson: a "passing" vite build is necessary but not sufficient — JSX-references-an-undefined-binding is only caught at module link time, which Vite's dev server resolves leniently. Real verification needs the actual render path.

**Future sessions:** the file you want to edit lives at the obvious path. `Outing.jsx` is now a 192-line router — you almost never edit it. The big interactive components (LiveOuting, Commissioner, CreateWizard) each live in their own file, sized for a human (and an LLM context window) to navigate without grep-by-line-number hunts.



## [2026-05-05 → 2026-05-06] refactor | Continuation of the live-fire bug-bash

After the 2026-05-04 entry above, a follow-on session shipped additional bug fixes through 2026-05-05 (the Sean solo-round incident) and into 2026-05-06 (refactor). Highlights:

**Critical data-loss fix:**
- Solo Round now persists to localStorage on every state change (`ActiveRound.jsx`). A user (Sean) lost an entire in-progress round to a page reload caused by my pull-to-refresh fix earlier the same day. Pull-to-refresh now also opts out of `data-no-pull-refresh="true"` regions (Solo Round, LiveOuting, EndMatchScreen, CodeShare). Score writes already used `runWithQueue` — multi-player rounds were durable across reloads via the offline queue. Solo Round was the gap.

**FriendProfile click-bubble bug (the kick-to-home):** When FriendProfile was opened from inside FollowList (Home → my Followers → tap a row), React's synthetic events bubbled UP the component tree (not the DOM tree, since both render to document.body via portals). Any click inside FriendProfile bubbled to FollowList's outer-backdrop `onClick={onClose}` and unmounted the whole stack. Fix: `onClick={e => e.stopPropagation()}` on FriendProfile's outermost wrapper (commit `e787822`). This was the actual cause of every "tap kicks me to Home" symptom — pull-to-refresh portal isolation was a red herring. The fix is one line at the right layer.

**Comprehensive backend audit (commit `ddc7f29`):**
- `tm_score_audit` was empty for every user lifetime — `writeScoreAudit` was fire-and-forget; Vercel kills the lambda after `res.json`, killing the in-flight INSERT. Now awaited at all 3 sites in outings.js.
- `maybeUpdateUserHandicap` was fire-and-forget in rounds.js POST and outings.js /:code/end loop. Same fix: now awaited.
- Push notifications silently dropped for league announcements, tee-time requests, game invites, outing announcements/cancellations. All 5 sites converted to `await Promise.all(...)` for fan-outs.
- Pattern Matt's friends.js fix from 2026-05-02 already corrected for friend-request push — same fix applied across the codebase here.

**Followers/Following on FriendProfile:**
- Server: `GET /api/follows/list` now accepts `?userId` to view another user's list. `is_self` flag added so the viewer's own row in someone else's list renders a "You" badge instead of an action button.
- Client: FollowList simplified per Matt — no more "Mutual ✓" badge or "Follow back" wording. New rule everywhere: `You` (self) > `Unfollow` (only on own Following) > `Following` (already follows) > `Pending` (request in flight) > `Follow`.

**QR-code share + auto-join:**
- "Show QR Code" button on CodeShare opens a modal with a scannable QR encoding `?join=ABCD`.
- App.jsx parses `?join=CODE` on mount, scrubs from URL, stashes in localStorage so it survives login/onboarding for new users, then forwards as `pendingJoinCode` prop to the Outing tab.
- Outing's useEffect calls `POST /:code/join`, switches to `view='live'`, surfaces failures via a transient red toast.
- iOS PWA caveat: scanned URLs open in Safari, not the installed PWA. Universal Links would solve this; out of scope until App Store submission.

**Cosmetic:**
- CodeShare text + layout fixes (was unreadable on cream page tint, content overflowed viewport).
- "Share Code with Group" button: solid gold gradient instead of translucent tint.
- Course name + instructional copy: bolder, full-opacity dark green for legibility.

**Eagle Eye 5xx (still pending Matt):**
- `ANTHROPIC_API_KEY` is set in `.env` but missing from Vercel env vars. Matt to run `vercel env add ANTHROPIC_API_KEY production` and redeploy to fix. Cost is per-call (Anthropic vision API, ~$0.005-0.02 per Eagle Eye request) — caller's account pays for all users.

**Open data-hygiene item (not blocking):**
- 1 orphan `tm_follows` row: `(Demo Player Three → Matt)` from 2026-05-02 with no accepted friendship. Cosmetic — renders as a phantom follower for Matt. Safe single-row delete: `DELETE FROM tm_follows WHERE id = 60`.



## [2026-05-07] schema | semantic preflight checks + trust-anchor refresh discipline

Session goal was to start work on the-match. Roll Call returned 3 yellow drifts (uncommitted state file, `notebooklm-wiki-refresh.py` byte-drift from canonical, no pinecone-sync state). Resolved all three:

- State file (anti-pattern #12 fix from prior session) committed (commit `79cee03`).
- Pinecone preflight bug fixed in canonical + the-match + Hub vault: `[4/7]` now gates on `check_enabled "pinecone"`, and `check_enabled` now distinguishes "no manifest" from "manifest with empty CHECKS." Empty CHECKS now correctly means "opt out of all optional checks." (commit `370ae4e` here, paired `f14c239` canonical, `996b5e1` Hub vault).
- the-match's `notebooklm-wiki-refresh.py` back-port comment removed — 3 lines added in commit `8d38292` violated the canonical sync contract by editorializing in the deployed copy. (commit `2dd86c8`.)

Then a deeper finding: CLAUDE.md and the wiki had drifted from reality without any mechanical check noticing.

- CLAUDE.md "Feature status" table was 1 week stale — push notifications shipped 2026-05-05 but listed as "🔲 Next." Friends/Followers, Solo Round persistence, click-bubble fix, QR-code share — all shipped, none reflected.
- DB setup section mentioned only `001_tm_initial.sql` despite 23 migrations existing.
- `wiki/index.md` was missing 7 pages (POST-LAUNCH-TODO, HIGH-PRIORITY-TODO, 2 synthesis pages, 2 concepts, 1 source).
- `wiki/overview.md` was still a `YYYY-MM-DD` template placeholder 10 days post-scaffold.
- `wiki/log.md` had `created: YYYY-MM-DD` frontmatter despite being actively appended.
- `wiki/HIGH-PRIORITY-TODO.md` (JWT_SECRET rotation) had sat 3 days past its 2026-05-04 deadline. JWT_SECRET in local `.env` is still the literal placeholder `change-me-to-a-long-random-string`; Vercel prod almost certainly the same. **ROTATE NEXT.**

Diagnosis: every preflight check in the Limitless Stack was *mechanical* — file hashes, timestamps, sync state. None checked content semantics. So the trust anchor drifted invisibly while every layer below it (sync, refresh, dedupe) stayed perfectly consistent.

**Three new semantic checks added to `tools/limitless-preflight.sh`** (back-ported to all 3 deployed copies + canonical's `vault-template/`):

1. **Index completeness** — walks `wiki/*.md`, warns on any page not referenced (literal substring match) in `wiki/index.md`.
2. **Template-placeholder detection** — flags any `wiki/*.md` with `created: YYYY-MM-DD` or `updated: YYYY-MM-DD` literal frontmatter.
3. **Overdue TODO detection** — `wiki/*TODO*.md` with `priority: critical` frontmatter > 3d old, OR explicit `DO AFTER YYYY-MM-DD` / `by YYYY-MM-DD` / `before YYYY-MM-DD` past today.

**Procedural fix**: new step 1 added to both the-match's and Hub vault's end-of-session checklists — *Refresh the trust anchors* (re-read CLAUDE.md + index.md, update if drifted). Inserted before the commit step so the refresh is included in the same commit.

**Anti-pattern #13** added to `claude-anti-patterns.md` (in all 3 copies — the-match, Hub vault, LimitlessStack vault-template): "Mechanical checks without semantic checks." Captures the lesson: mechanical safeguards alone don't make a trust anchor trustworthy; for any system where a document is ground truth, the preflight must include semantic checks.

**Content fixes applied this session**:

- `CLAUDE.md`: replaced stale Feature status table with a "Where to find current state" pointer section (log.md / TODOs / synthesis). Updated DB setup to handle 23 migrations.
- `wiki/index.md`: added the 7 missing pages, refreshed `updated:` date, added a "Top-level" section.
- `wiki/overview.md`: filled in with a real synthesis — what the-match is, where to look for what, how the wiki is maintained.
- `wiki/log.md`: fixed `YYYY-MM-DD` frontmatter to real created (2026-04-29) / updated (2026-05-07) dates, changed `type: overview` → `type: log`.

**Verification**: preflight now reports `green: 11, yellow: 4` — all 4 yellows are expected (uncommitted work, JWT rotation pending, 2 NotebookLM refresh prompts that the end-of-session steps will resolve).

**Next**: rotate JWT_SECRET. Runbook in `wiki/HIGH-PRIORITY-TODO.md` (5-minute job, Matt drives the Vercel env-var change since Claude is not allowed to modify security credentials).



## [2026-05-07] audit | E2E auth walk + visual sweep + improvement backlog

Drove the live prod app via Claude-in-Chrome MCP, simulating a brand-new mobile user. Walked the full flow: signup → onboarding wizard (4 steps) → home → Scorecard → Eagle Eye → Leagues → Tour → wrong-PIN login → correct-PIN login. Captured screenshots + network logs throughout. Server-side auth re-verified via `scripts/smoke-test-auth.js` (passing post-JWT-rotation). Test user `e2e-test-2026-05-07-1234@example.com` (user_id=43) deleted post-test.

**Bugs found (11):**

HIGH:
1. **No logout / sign-out anywhere in the app.** DOM scan confirms zero matches for "logout|log out|sign out|signout" anywhere. Only path to clear auth is `localStorage.removeItem('tm_token')`. Shared device → previous user stays logged in for 90 days.
2. **No `/settings` route.** SPA silently routes any unknown path back to home.

MEDIUM:
3. **Course name truncation: "Pebble Beach Gl"** — full name "Pebble Beach Golf Links" cut mid-word in autocomplete + profile card. Likely a VARCHAR(N) somewhere in the import path.
4. **Onboarding wizard renders full-width** instead of mobile-constrained — inconsistent with rest of app on tablet/desktop viewports.
5. **No "Forgot PIN" reset flow** — 4-digit PIN forgotten = locked out forever.
6. **Login error low contrast** — "Invalid email or PIN" pinkish-red on light bg, fails WCAG AA.

LOW:
7. **Onboarding progress bar shows 5 segments, text says "STEP X OF 4"** (welcome counted in segments but not numbered).
8. **"AWAITING-tee-time"** weird capitalization in coach-mark copy.
9. **Handle generation produces awkward results** for non-traditional names ("E2E Test User" → "@euse").
10. **Email persists when toggling Sign In ↔ Create Account** — could surface "email exists" errors more often than necessary.
11. **No loading state on auth submit** — button doesn't change during the 2-4s API call.

Plus one investigative item: GET /api/auth/me returned 200 on initial fresh-load AFTER localStorage was cleared. Either cookie auth or stale-token caching — worth a 5-min probe.

**Working well:** Signup flow (9 API calls all 200/201), wrong-PIN security (no email-exists leak), full onboarding wizard, polished empty states (Scorecard golf-ball hero, Leagues upgrade-gate copy), Tour leaderboard (real PGA data with player photos), Eagle Eye hero, coach-mark tooltip pattern. The visual design is impressively polished where it's polished — issues are mostly in the cracks between flows (auth, onboarding, edge cases) not in the main app surfaces.

**Improvements (13)** + **New ideas (25)** filed in [[synthesis/audit-2026-05-07]]. Indexed.

**Recommended next 3 sessions:**
1. Privacy + logout + delete-account (paired Settings page) — closes audit bug #1 + POST-LAUNCH-TODO #11. App-Store-submission blockers.
2. Forgot-PIN + Settings page polish.
3. Course-name truncation root-cause.



## [2026-05-07 PM] feat | Phase A+B+C — settings + logout + privacy + delete-account + forgot-pin + course expansion

Executed all three recommended next-sessions from the morning's audit-2026-05-07 in a single push, then verified end-to-end against live prod.

**Phase A — Course name expansion (audit bug #3):**
- Server `expandCourseName()` helper in `server/src/routes/courses.js` post-processes vendor abbreviations (`Gl` → `Golf Links`, `Gc` → `Golf Club`, `Cc` → `Country Club`, `G&Cc` → `Golf & Country Club`, `Cl` → `Club`, `Rc` → `Resort Club`). Applied to both `/search` and `/:id` responses.
- DB backfill script ran across 6 tables (`tm_users.home_course`, `tm_games.course_name`, `tm_match_history.course_name`, `tm_outings.course_name`, `tm_rounds.course_name`, `tm_tee_time_requests.course_name`). 1 row updated (the rest of the existing data was already clean).
- **Verified live:** searched "Pebble Beach" in onboarding → autocomplete shows "Pebble Beach Golf Links" (was "Pebble Beach Gl"). Confirmed in profile-card display too.

**Phase B — Settings + Sign Out + Privacy Policy + Delete Account (audit HIGH bugs #1 + #2):**
- Migration `024_tm_user_deletion_fk_relax.sql` — relaxed two FK constraints that previously refused user deletion: `tm_outings.host_id` (NOT NULL+NO ACTION → NULLABLE+SET NULL), `tm_score_audit.edited_by_id` (NO ACTION → SET NULL). Outings + audit log preserved when user deletes; host links become NULL.
- `DELETE /api/auth/me` — server endpoint with typed-confirm guard (`req.body.confirm === 'DELETE'`). Cascade + set-null FKs handle every child row.
- `client/src/components/SettingsModal.jsx` — fullscreen overlay with: signed-in-as summary, Privacy Policy link, Sign Out (clears `tm_token` + reload), Danger Zone with typed-DELETE confirmation modal for delete-account.
- `client/public/privacy.html` — App-Store-required hosted privacy policy. Dark Augusta-night palette, Georgia serif headings, comprehensive coverage (data collected, third-party sharing, retention, your rights, security).
- `vercel.json` — added rewrite `/privacy` → `/privacy.html` for clean App Store URL.
- Gear icon added to Home top bar next to "My Profile". Opens SettingsModal.
- `client/src/lib/api.js` `del()` now accepts an optional body (DELETE /api/auth/me requires `{confirm: 'DELETE'}`).
- **Verified live:** Settings opens cleanly, Privacy Policy link opens `/privacy` (HTTP 200, 6838 bytes), Sign Out clears `tm_token` and redirects to login.

**Phase C — Forgot PIN flow (audit bug #5):**
- Migration `025_tm_pin_reset_tokens.sql` — one-time tokens, 30-min expiry, single-shot consumption, cascade delete on user delete. Includes a partial index on `(user_id, expires_at) WHERE consumed_at IS NULL` for the lookup hot path.
- `POST /api/auth/forgot-pin` — generates a 32-byte base64url token, stores it, builds reset URL `${APP_BASE_URL}/?reset=${token}`. ALWAYS returns 200 to avoid email enumeration. Rate-limited 3/min/IP.
- `POST /api/auth/reset-pin` — validates token (unconsumed + unexpired), bcrypt-hashes new PIN, marks token consumed, returns fresh JWT.
- Login.jsx three new modes (`forgot`, `forgotSent`, `reset`) plus the existing `login`/`signup`. "Forgot your PIN?" link below Sign In button. `?reset=TOKEN` URL parsed on mount + scrubbed from history.
- **EMAIL DELIVERY IS STUBBED**: `sendResetEmail()` console.logs the link instead of sending. Activation requires (1) signing up for Resend or similar, (2) adding `RESEND_API_KEY` to Vercel env, (3) uncommenting the marked block in `auth.js`. Until then, the front-door link works end-to-end in dev (admin reads token from server logs to test).
- **Verified live:** clicked "Forgot your PIN?" → email-only form rendered → submitted with non-existent email → got the security-correct "If that email is registered, a reset link is on its way" success message.

**Bug spotted + fixed during verification:** `forgotSent` state was rendering the Submit button with default "Sign In" label. Fixed: button hidden in `forgotSent` mode, only the Back-to-sign-in link remains. Commit `b16b18b`.

**Regression check:** `node scripts/smoke-test-auth.js` against the current deploy returned ALL CHECKS PASSED. DELETE /api/auth/me with garbage token returns 401 (auth check works). /privacy returns 200 publicly.

**Test users created + cleaned:** `e2e-test-2026-05-07-1234@example.com` (audit walk earlier today), `verify-2026-05-07@example.com` (Phase D verification this session). Both deleted.

**Audit-2026-05-07 status update:** HIGH bugs #1 + #2 → CLOSED. MEDIUM bugs #3 + #5 → CLOSED. Remaining open: MEDIUM #4 (onboarding wizard not mobile-constrained), MEDIUM #6 (login error contrast), all 5 LOW polish items + handle generation. None are App-Store-submission blockers.

**Next sessions worth considering:**
1. Wire up Resend (or any email provider) to activate the Forgot PIN flow's actual email send. ~30min including signing up for the provider.
2. Closeout audit MEDIUM #4 + #6 + the 5 LOW items in one polish-pass session.
3. Then back to feature work — engagement loops (group chat per match, friends activity feed) or Eagle Eye depth (caddie history, voice commands) per audit-2026-05-07's new-ideas list.

Commits this session: `b96fa13` (audit synthesis), `e201f98` (notebooklm state), `b50f4a2` (JWT rotation cleanup + label fix), `21eea87` (notebooklm state), `56f9d15` (Phase A+B+C feat), `b16b18b` (forgotSent button fix). Pushed to `origin/main`.



## [2026-05-07 PM2] feat | first_birdie achievement + retro-award + friend-profile achievement row

James Ashe scored a birdie mid-round and asked why he didn't get a badge — the home empty-state copy promises "Drop a birdie..." but only `first_eagle` was implemented. Triggered three small features:

**first_birdie achievement** — added META entry + detection (`score === par - 1 && par >= 3`) in `lib/achievements.js`. Distinct from `first_eagle`: an eagle does NOT trigger first_birdie (different score), and both can fire in the same round. New SVG icon (rounder body + tail flick) in `AchievementToast.jsx` to distinguish from eagle silhouette.

**Retroactive award** — `scripts/backfill-first-birdie.js` scans every `(outing × participant)` row, finds each user's earliest historical birdie, inserts the achievement with `earned_at = outing.created_at`. Skips push notifications by inserting raw (vs the runtime helper) — a notif 3 weeks after the round would be confusing. Backfill ran prod 2026-05-07: awarded 3 users (Matt id 1 / Daniel id 12 / James id 36) their first_birdie based on existing score data.

**Friend-profile achievement row** — separate finding during verification. Matt asked why James's badge wasn't visible from Matt's view of James's profile. Two reasons:
1. The `/api/profile/achievements` endpoint returned the VIEWER's own achievements only.
2. `FriendProfile.jsx` didn't render an `AchievementsRow`.

Fixed both:
- New `GET /api/profile/achievements/:userId` — public per-user lookup. Achievements are public-by-design (bragging rights), so no friend-only gate.
- `AchievementsRow` now accepts an optional `userId` prop. When present, fetches `/achievements/:userId`; otherwise falls back to viewer's own.
- `FriendProfile` imports + renders `<AchievementsRow userId={friend.id} />` between the Avg/Best stat tiles and the Rivalries section.

**Top-bar duplicate-icon fix** — admin users (Matt) saw two near-identical gear icons after the morning's Settings work landed (the existing admin gear + the new Settings entry). Swapped the Settings icon to a horizontal-dots kebab (⋯) so they read as distinct: gear = admin, kebab = "more options / account menu". Non-admins are unaffected.

**Verified live:**
- API call `GET /api/profile/achievements/36` (James) with Matt's JWT → 200, returns the Birdie! achievement.
- Driving Chrome MCP through user-search → tap James → scroll to ACHIEVEMENTS card → see the gold "Birdie!" badge with caption.
- Top bar after fix: `[admin gear] [search] [My Profile] [⋯ kebab]` — distinct shapes.

**Commits this round:**
- `ef156a1` — `feat(achievements): add first_birdie + retroactively award for historical birdies` (3 files, 194 insertions)
- `6c1fd6e` — `feat(achievements): show badges on friend profiles` (3 files, 51 insertions)
- `1551bcb` — `fix: swap Settings gear icon → kebab (⋯) to disambiguate from admin gear` (1 file, 11 insertions)

All deployed to prod. Force-redeploys aliased to `the-match-roan.vercel.app` each time.

**Wiki housekeeping** done in this session: audit-2026-05-07.md updated with closure markers (HIGH #1 + #2, MEDIUM #3 + #5 — code-closed; #5 email still stubbed). POST-LAUNCH-TODO.md gained 4 new items: #14 (Resend activation for Forgot PIN), #15 (re-add 3 NotebookLM main-bucket entries lacking verified_at), #16 (achievement expansion ideas — first_par, breaking_90, course_collector, etc.), #17 (extend preflight to audit main-bucket verified_at). #11 marked closed.

**Today's overall scope (across morning + PM + PM2):** JWT_SECRET rotation · semantic preflight checks (3 new) + trust-anchor refresh discipline · audit-2026-05-07 written and acted on · Phase A course-name expansion · Phase B Settings + Sign Out + Privacy + Delete Account · Phase C Forgot PIN flow (email stubbed) · `first_birdie` achievement + retro-award + friend-profile rendering · top-bar icon disambiguation · anti-pattern #13 added to all 3 anti-patterns files. Roughly a week of feature work.



## [2026-05-07 PM3] feat | Referral program v1 — invite-link + milestone Elite credits

Built the full referral pipeline in one session per Matt's spec. Reward model: referrer earns +7 days Elite at 5 qualifying signups, +23 more days at 10 (total 30 = 1 month), +335 more at 50 (total 365 = 1 year). Referee gets +7 days at signup. "Qualifying" = signed up via a ref link AND played at least one round (solo or matched). Activity gate prevents alt-account gaming. Lifetime counts.

**Schema (migration 026):** `tm_referral_codes` (1:1 with users, lazily created), `tm_referrals` (referrer→referee with `qualifying_round_at`; `UNIQUE(referee_id)` so a user can only be referred once; `CHECK (referrer_id <> referee_id)` blocks self-referral at the DB layer), `tm_referral_rewards` (audit log, `UNIQUE(user_id, milestone)` prevents double-credit). Plus `tm_users.elite_until TIMESTAMPTZ` for time-limited Elite. Effective Elite = `tier === 'elite' OR elite_until > NOW()`.

**Server lib (`referrals.js`):** `getOrCreateCode(userId)` — race-safe lazy create with collision retry, 6-char base32 (no ambiguous I/L/O/0/1). `getReferralStats(userId)` — totals + next milestone + awarded list for the GET endpoint. `recordSignupReferral(refereeId, code)` — INSERT row + extend referee `elite_until` +7 days, idempotent via UNIQUE(referee_id). `markReferralQualified(refereeId)` — sets `qualifying_round_at` if not already, triggers `checkAndAwardMilestones` for the referrer. `extendEliteUntil()` rule: `GREATEST(COALESCE(elite_until, NOW()), NOW()) + N days` so credits stack on top of existing entitlements without overwriting longer trials.

**Server routes:** `GET /api/referrals/me` returns code, full URL, stats. `POST /api/auth/signup` accepts `{ ref }` in body (non-blocking — bad code shouldn't fail signup). `POST /api/rounds` and `outings.js /:code/end` call `markReferralQualified` for each completing user (awaited per the lambda-freeze contract).

**Client:** Login.jsx parses `?ref=CODE` on mount, persists in `localStorage.tm-pending-ref` so it survives Sign In ↔ Create Account toggling, sends in signup body. Gold "Invited by a friend… 7 days of Elite, free" hint visible in signup mode. SettingsModal: new ReferralCard slotted between Tier and Location with select-on-focus link input, Copy button (✓ confirmation), Share button (`navigator.share` with copy fallback), progress bar to next milestone, three reward-tier chips with ★ on earned ones. `USER_PUBLIC_COLUMNS` extended with `elite_until`.

**Bugs caught + fixed mid-build:**
1. Forgot `requireAuth` middleware on the new route — endpoint returned 401 unconditionally. Added `router.use(requireAuth)`.
2. `APP_BASE_URL` had a trailing newline (same paste-quirk that bit VAPID_PRIVATE_KEY in 2026-05-02). Trimmed before URL concat.

**Verified live:** `GET /api/referrals/me` as Matt returns `code: AV4Z2Y, url: https://the-match-roan.vercel.app/?ref=AV4Z2Y, totalSignups: 0, qualifyingCount: 0, nextMilestone: {target:5, days:7, remaining:5}, milestones:[5→7, 10→23, 50→335]`. Schema applied. Build clean. Force-redeployed.

**Out of scope for v1, filed in POST-LAUNCH-TODO:**
- #19 Branded short URL (`thematch.app/r/CODE` — DNS work)
- #20 Email-verification gate on qualifying (depends on Resend / #14)
- #21 Anti-fraud hardening (IP fingerprint, device fingerprint, time-window heuristics, manual-review queue)
- #22 Annual reset model (only if someone maxes out and complains)

**Commits this round:** `2aa5d7f` (feat), `1e2821b` (requireAuth fix), `c96be59` (URL trim).

**Open chrome E2E** — full signup-with-ref → log-round → milestone-credit verification was deferred to next session for time. API contracts all manually verified; the round-save trigger and milestone math are tested via the structure of the code (UNIQUE constraints, idempotency) rather than end-to-end.


## [2026-05-07] feature | solo-round overhaul + achievements v2 + SW auto-reload

Major rewrite of the solo-round live scoring experience to mirror the multi-player match feel, plus achievements v2 expansion with rarity tiers, plus a service-worker auto-reload fix.

**Active round (live solo scoring) — full UI parity with multi-player matches:**
- Replaced HoleScorer (single-hole stepper view) with SoloScoreboard: Augusta-style front-9 + back-9 stacked tables, cream score tiles, gold PAR row, AUGUSTA_GREEN_DEEP OUT/IN strip, active-hole gold flag pin. Tap a cell to enter score.
- New SoloScoreModal: stepper + Eagle/Birdie/Par/Bogey/Double quick-picks + suspicious-score guard. Shot log nested inside.
- SCORECARD / BOARD toggle (matches multi-player). BOARD = Tour-leaderboard single-row view (you in 1st position, avatar, name, TOT, THRU). Tap row to flip back.
- SetupSheet now uses the real CoursePicker (GolfCourseAPI search with tee selection) — same component CreateWizard uses. Dropped the manual par grid; pars come from picked tee or DEFAULT_PARS fallback.
- "Tee It Up" now sits naturally below content (was pushed below the fold by .page-scroll height).
- Auto-resume after reload: localStorage check hoisted from ActiveRound to Outing.jsx so a pull-to-refresh during a round lands the user back in scoring instead of OutingHub.
- "Resume Solo Round" card in OutingHub Live Now strip. Shows course name, thru N of M, running total/diff. Tap to resume; small Discard link with confirm.
- SavedChip flash after every score commit (same gold check pop multi-player has).
- HighlightShareModal celebration card fires on birdie/eagle/HIO during solo play.
- Floating GET DISTANCES pill in the footer (alongside Finish) jumps to Eagle Eye on the active hole.
- iOS notch fixes via calc(var(--safe-top) + Npx) on all three solo screens (SetupSheet, SoloScoreboard header, ScorecardSummary).

**Achievements v2:**
- Expanded from 4 to 8 types: hole_in_one, first_par, breaking_100, breaking_90 added (existing first_birdie, first_eagle, sub_80, streak_week kept).
- Per-hole detection in BOTH checkAfterHoleScore (multi) and checkAfterSoloRound (solo). Solo POSTs config.pars now; server validates + persists in new tm_rounds.hole_pars column (migration 027).
- Rarity tiers (common / rare / legendary) with three-tier visual treatment in AchievementToast: legendary = full-screen takeover with orbiting dashed sparkle ring + LEGENDARY tag (hole_in_one only), rare = bigger pill with iridescent gold/silver border + RARE tag (first_eagle, sub_80), common = standard pill (everything else).
- New SVG icons for hole_in_one (cup with flag + "1") and first_par (flag on green).
- AchievementBadge in profile row is also tier-aware.

**Service worker auto-reload (sw.js + App.jsx + vercel.json):**
- Closed the bug where Matt's iPhone PWA was running a 7-commits-stale bundle while production had moved on. SW activate handler now broadcasts {kind:'sw-activated'} after claim(); App.jsx listens and calls window.location.reload() with a 500ms delay. vercel.json adds Cache-Control: no-cache, no-store, must-revalidate on /sw.js. Net effect: deploys propagate within seconds of next page request.

**Migrations:** 026 (referrals + elite_until), 027 (tm_rounds.hole_pars). Both applied to prod.

**Files touched:** client/src/pages/ActiveRound.jsx (heavy), client/src/pages/Outing.jsx, client/src/pages/Outing/OutingHub.jsx, client/src/pages/Outing/CreateWizard.jsx (CoursePicker exported), client/src/pages/Outing/HighlightShare.jsx (imported), client/src/pages/Outing/LiveOuting.jsx (SavedChip exported), client/src/lib/solo-round.js (new), client/src/components/AchievementToast.jsx (rewrite for rarity tiers), client/src/design/tokens.css (legendary keyframes), client/public/sw.js, client/src/App.jsx, vercel.json, server/src/lib/achievements.js, server/src/routes/rounds.js, migrations/026_tm_referrals.sql, migrations/027_tm_rounds_hole_pars.sql, plus PIN reset (025) + user deletion FK relax (024).

**Commits:** c02143f, 04f7883, 13b2d59, da4b4ed, c31a6e8, f5c2ece, 1e4e57b, 365fb02, e3fccfd, 06517b1, 975023b.

## [2026-06-06] query+fix | Eagle Eye distance regression diagnosed (dead Overpass mirror) + GolfNow affiliate + course-data provider research

**Eagle Eye glitchy/inaccurate distances — root cause (verified, external).** `/api/eagle-eye/osm` tried Overpass mirrors with `overpass.kumi.systems` FIRST and NO per-mirror timeout. kumi degraded externally (late May, no deploy on our side) — confirmed still dead 2026-06-06 (live test: kumi HTTP 000/timeout; lz4 + main both 200 in ~0.6s). A hung first mirror stalls every hole-geometry fetch → app drops into degraded path (wrong/missing pins, distances off, lag). This matches the 2026-06-01 diagnosis exactly. The 2026-06-01 fix (timeout + reorder) was correct but got reverted on 06-02 along with the bad client-side pin/tee guessing rewrite Matt rightly rejected — so the reliability fix was lost with the bathwater and the regression is live again.

**Fix staged (NOT deployed).** Branch `fix/osm-mirror-only` (commit f26768f): server-only — reorder mirrors to [lz4, main, kumi] + per-mirror 10s AbortController timeout. Zero changes to client pin/tee geometry. Restores accurate pins by ensuring real `golf=hole` data loads instead of timing out into the guess path. Matt ships when ready (push branch / merge → Vercel auto-deploy).

**Strategic: course-data sourcing.** OSM/Overpass is crowd-sourced + no SLA — fine as MVP/fallback, not launch-grade vs 18Birdies/TheGrint (who run verified DBs; 18Birdies = Google Maps base + in-house verification). Researched licensed providers: Golf Intelligence (only one with public pricing: free 200-credit test → $399–$5,999/mo, ~$0.18–0.35/golfer/yr, 99.9% SLA, + 3D green slope/elevation), iGolf Solutions + GolfLogix (device-grade verified, quote-only), golfapi.io (budget, DB export), Golfbert. Recommendation: trial Golf Intelligence now (evaluable + slope data feeds plays-like), quote iGolf/GolfLogix as accuracy benchmark, keep OSM as fallback. Deliverables saved to repo root: `Course-Data-Provider-Comparison.docx`.

**GolfNow affiliate.** Confirmed the home `Book a Tee Time` card links to a bare (untracked) golfnow.com URL — $0, no attribution. Prepared partnership application packet under Open Scaffold Labs, LLC (Dale = Account Holder/submitter). Deliverables: `golfnow-affiliate-application.md`, `GolfNow-Partnership-for-Dale.docx`.

## [2026-06-06] schema | GolfNow social-media docs + brand kit + marketing URL

Non-code session producing GolfNow-affiliate marketing collateral, a reusable document style system, and the marketing-site URL decision.

- Built two social-media marketing deliverables as native `.pages`, styled to match `the-match-brief.pages` (gold-gradient cover + "Match" wordmark, cream interior, Didot green headings, gold eyebrows/rules, two-column feature grid, pull quotes, refined gold-accented tables): `The-Match-Social-Media-Marketing-Strategy.pages` (full deck) and `The-Match-Social-Media-One-Pager.pages` (1-page, strictly social media). Pipeline: docx via docx-js → gold cover/banner rendered with Chrome headless using the Mac's Didot font → Pages saves as native `.pages`. Removed the earlier flat `.docx` versions of both.
- Added reusable `brand-kit/` (`STYLE-GUIDE.md`, `brandkit.js`, `build-pages-docs.js`, `cover.html`, `banner.html`) — the standard appearance for all future Match docs.
- Recorded the marketing-site URL from Dale: **the-match.openscaffoldlabs.com** (POST-LAUNCH-TODO #23). Distinct from the app origin `the-match-roan.vercel.app` and the still-TBD referral short URL (#19).
