---
type: synthesis
created: 2026-06-23
updated: 2026-07-02
tags: [the-match, eagle-eye, roadmap, build-plan]
---

# The Match — Bulletproof Build Plan: Zero-Cost Audit, Risk Register & Progress Checklist

*Companion to the design plan (`the-match-eagle-eye-premium-plan.md`). Prepared 2026-06-23.*
*Goal: the world's best golf app — perfected on usability, accuracy, and visual flow — built without paying for the build itself. Every cost claim below is verified against primary sources (cited) or explicitly flagged as unverified.*

---

## 0. The honest headline (read this first)

**Building the product is genuinely $0.** Every library, font, and tool in the plan is permissive open-source (MIT/BSD/OFL) — free for commercial use, no runtime fees, no paid tier you can trip into. The renderer (MapLibre), motion, charts, geometry math, and brand fonts cost nothing.

**The only genuine remaining cost is worldwide satellite imagery.** Two other items are licensing/engineering fixes (no recurring fee), and hosting is already paid for:

1. **Hosting — already covered, $0 new spend.** The Open-Scaffold-Labs org **already pays for Vercel Pro + Supabase Pro** (confirmed by Matt, 2026-06-23). The action is simply to **migrate the-match off the free tiers onto the org's existing paid plans** — not to start paying. This neutralizes the two real hosting traps at zero incremental cost: Vercel Hobby's commercial-use ban (Pro permits commercial) and Supabase's 5 GB egress wall + 7-day idle pause (Pro removes both). *(Verify-then-act: confirm the-match's project is on the org's Pro Vercel team and a Pro Supabase project before launch.)*
2. **Satellite imagery — resolved: US-only at launch, free.** Decision (Matt, 2026-06-23): launch on **free NAIP imagery (US, public-domain, ~0.6 m)**; worldwide photographic coverage is a **future roadmap upgrade** (paid imagery / premium tier, region by region). Non-US courses still get the free vector hole view at launch. *Engineering note:* NAIP is free but we must wire a NAIP tile source (public USGS/USDA service or the AWS Open Data copy) — a task, not a fee.
3. **Our current map already carries a licensing risk** (no fee, but a must-fix). Eagle Eye serves ESRI "World Imagery" via the keyless endpoint (verified in `EagleEye.jsx:362`) — a **Terms-of-Use violation for a commercial app**. Fix independent of the redesign.
4. **OpenStreetMap's public Overpass API is prohibited as a production backend** (we currently call Overpass mirrors live). Engineering fix: cache course geometry into our own DB. No fee.

**Net: with hosting on the org's existing plans and US launch imagery on free NAIP, the entire build *and* launch is genuinely zero new spend.** The only deferred money question is worldwide photographic imagery — a roadmap item, not a launch blocker. The plan below is now a pure build sequence.

---

## 1. Verified zero-cost stack

| Layer | Choice | License / cost | Verified | Catch |
|---|---|---|---|---|
| Map renderer | **MapLibre GL JS** | BSD-3-Clause, free commercial | ✅ primary source | Renderer only — needs a tile source |
| Vector base tiles | **OpenFreeMap** (or self-host **Protomaps PMTiles**) | Free, commercial-OK, no key | ✅ | OpenFreeMap = solo-run, **no SLA** → self-host PMTiles for resilience (~$ low single digits/mo on Cloudflare R2, **not literally $0**) |
| Course geometry | **OpenStreetMap (ODbL)**, cached to our DB | Free commercial | ✅ | Must **not** use public Overpass as a live backend; attribution required |
| Geometry math | **Turf.js** | MIT | ✅ | none |
| Hero number anim | **NumberFlow** | MIT | ✅ | none |
| Charts/dials | **visx** (or hand-rolled SVG) | MIT | ✅ | none |
| Motion | **Motion** (public pkg) + **react-spring** | MIT | ✅ | "Motion+" is a separate paid pkg behind a private registry — can't install by accident |
| Fonts | **Inter + a mono** (Geist/IBM Plex/Space Grotesk) | OFL 1.1, free embed | ✅ | keep the license file alongside the fonts; self-host via Fontsource |
| **Satellite imagery** | **US launch: NAIP (free, public domain, ~0.6 m).** Worldwide = future roadmap | free at launch | ✅ | Must wire a NAIP tile source; non-US gets the free vector hole view |
| Hosting | Vercel Pro + Supabase Pro (**org already pays**) | $0 new — migrate off free tiers | ✅ | Pro permits commercial use + removes egress/idle-pause limits |

**Attribution obligations (free but required):** "© OpenStreetMap contributors" (base map + geometry), the vector-tile project credit, NAIP/national credits where used, and shipping the OFL/MIT/BSD license texts in the app. These are easy and non-negotiable.

---

## 2. Risk register — what could go wrong (and the mitigation)

Sorted by how badly it threatens **accuracy / usability / trust** — the three things that decide whether we become the biggest name or a forgettable one.

| # | Risk | L | I | Mitigation (build it in from day one) |
|---|---|:--:|:--:|---|
| 1 | **GPS shows a confidently-wrong yardage** (cold start, tree canopy, water, clubhouse) — destroys trust on hole 1 | H | H | **Hard accuracy gate:** read `coords.accuracy` on every fix; **refuse to show a yardage when accuracy > ~10 m**; show "Acquiring GPS…" until it tightens; never render the first raw fix |
| 2 | **Over-promising laser accuracy** — GPS is inherently less precise than a laser rangefinder | M | H | **Never claim "laser" / "laser-grade," and never advertise a precision margin** (don't publish "~X yd" — it spotlights the gap vs a laser). Lead with strengths: instant GPS distances to F/C/B, the whole-hole view, no rangefinder needed. **UPDATE 2026-06-30 (Matt): the on-screen "±X m" margin was REMOVED entirely** (it narrated the flaw on every shot). Eagle Eye now shows only a calm "GPS" lock / "ACQUIRING" state — no number. The accuracy gate still uses `coords.accuracy` internally to suppress a bad fix; we just never quantify the uncertainty to the user. Do NOT re-add an on-screen margin. |
| 3 | **Satellite imagery not free worldwide** | H | L | **Scoped out of launch:** US = free NAIP; non-US = free vector hole view; worldwide photographic imagery deferred to a paid premium/roadmap tier |
| 4 | **Current ESRI imagery = commercial ToU violation** | H | H | Replace before any monetization: vector hybrid (free) + NAIP (US) + paid imagery only where licensed |
| 5 | **Public Overpass used as production backend** (current) — policy-prohibited, rate-limited | H | M | Fetch each course once, **cache geometry into Supabase**; never hammer the public endpoint live |
| 6 | **iOS memory crash over a 4-hr round** (no catchable OOM; tab just reloads) | M | H | Minimal JS, release off-screen canvases, cap in-memory round history, keep one map instance, no needless GL canvas resizes |
| 7 | **MapLibre <60fps if the camera animates continuously** | M | M | Static camera; repaint only on GPS move; overlays as GeoJSON layers; animate UI off-canvas (transform/opacity only) |
| 8 | **No background location on iOS** (tracking dies on screen lock) | H | M | Screen Wake Lock during an active round; design "tap to refresh distance," don't assume continuous tracking |
| 9 | **Compass interference/calibration** near clubs/cart → wrong bearing line | M | M | Gate on `webkitCompassAccuracy`, prompt figure-8 calibration, smooth across samples |
| 10 | **iOS standalone geolocation prompt silently fails** (documented bug) | L–M | M | Trigger geolocation from an explicit tap; detect no-response and guide the user; test installed |
| 11 | **Hosting ToS/scale** (Vercel commercial ban, Supabase pause/egress) | L | L | **Resolved** — migrate the-match onto the org's existing Vercel Pro + Supabase Pro (already paid, $0 new). Still serve tiles/imagery from a CDN, not Supabase egress |
| 12 | **No haptics on iOS web** | H (certain) | L | Visual + audio feedback; never make haptics the only channel |
| 13 | **OSM per-hole geometry patchy outside W.Europe/N.America/Australia** | M | M | OSM as base; fallback to manual digitization / user contributions where greens/tees missing; validate before trusting |
| 14 | **"Add to Home Screen" friction on iOS** (no auto-prompt) lowers installs | M | M | Custom Safari coach mark with Share-sheet instructions |

**The two that most decide our fate:** #1/#2 (accuracy honesty — win on a strict accuracy gate, lose by showing raw fixes) and #4/#5 (fix the imagery + Overpass licensing before we scale or monetize).

---

## 3. Methodical build sequence — each step has a verification gate

Principle: **every step ships independently, builds + lints clean, and is device-verified before the next.** Nothing merges that we haven't proven. This is how we keep it bulletproof.

**Phase 0 — Foundation (low risk, whole-app lift)**
- 0.1 Design tokens: dark elevation surfaces, layered shadows, palette fixes, grain. → *verify: visual diff across tabs, contrast checks pass.*
- 0.2 Type system + tabular numerals on every live number. → *verify: numbers don't reflow as they change; screenshots.*
- 0.3 Motion discipline (transform/opacity, 200ms ease-out default). → *verify: no layout-animating properties; 60fps check.*

**Phase 1 — Eagle Eye correctness & cost-safety FIRST (before the pretty)**
- 1.1 **Accuracy gate** — `coords.accuracy` read + suppress yardage > ~10 m + "acquiring" state. → *verify on a phone outdoors: cold-start garbage never shows.*
- 1.2 **Cache course geometry into Supabase**, stop live Overpass hammering. → *verify: course loads from our DB; Overpass hit at most once per course.*
- 1.3 **Replace ESRI imagery** with the free vector hybrid (+ NAIP for US). → *verify: no keyless-ESRI calls remain; map still reads premium.*

**Phase 2 — Eagle Eye as the hero instrument (the showcase)**
- 2.1 MapLibre vector + branded style, behind a flag, current path as fallback. → *verify: device-tested, memory stable over a simulated round.*
- 2.2 Cinematic `flyTo` hole intro (reduced-motion aware). → *verify: smooth on a mid-tier Android.*
- 2.3 Hero distance instrument (NumberFlow + 270° arc gauge, one spring). → *verify: number + arc move in lockstep.*
- 2.4 Premium glass HUD + unified control layout. → *verify: design critique pass.*
- 2.5 Turf yardage arcs + smoothly-lerped player puck. → *verify: arcs are true ground distance; puck doesn't teleport.*

**Phase 3 — Leapfrog features (sequence by your appetite)** — transparent adjustable plays-like (free), ad-free generous free tier, own-club distance arcs, green slope + putt-line, data→practice loop, clean AR. → *each: spec → build → device test → audit.*

**Phase 4 — App-wide polish** — skeletons, view transitions, RAIL perf budgets, `content-visibility`, inline-style refactor. → *verify: Lighthouse/INP field numbers.*

**Cross-cutting gates on every change:** `npm build` + ESLint `no-undef` + `node --check` on server files → push to beta `main` → device test on a real iPhone → audit-before-claim before declaring done.

---

## 4. Progress checklist

> Status legend: ☐ not started · ◐ in progress · ☑ done

**Phase 0 — Foundation — PARTIAL** (code-verified 2026-07-02; spec: `phase0-foundation-build-spec-2026-06-30.md`). The design *primitives* are in the codebase, but the full app-wide application + the inline-style → token refactor are NOT complete (that refactor is Phase 4.3).
- ☑ 0.2 Tabular numerals — VERIFIED app-wide in code: `tokens.css:145-146` (`body` `tabular-nums`/`tnum`) + `.tm-nums` utility (`:323`). **Custom "type identity" font dropped by decision (Matt, 2026-06-30 §6): keep the system SF Pro stack** — instrument feel from size/weight/tabular + depth/motion/grain, not a bundled face (removes the WKWebView font-loading risk).
- ◐ 0.1 Dark elevation + layered shadows + grain — primitives present: `--tm-shadow-layered` token + `.tm-shadow-layered` utility (`tokens.css:92,331`), grain overlay on the Eagle Eye hero (`EagleEye.jsx:2014`), existing green-tinted `--tm-dark-*` ramp kept (WP-0.C decision). **NOT verified:** layered shadows applied to every light card/modal, the pure-`#fff`/`#000` palette sweep, and grain across *all* dark surfaces app-wide. Full inline-style → token refactor = Phase 4.3.
- ◐ 0.3 Motion discipline — reduced-motion handling present (`tokens.css:360` global block + hero handling in `EagleEye.jsx`/`HoleMapGL.jsx`). **NOT verified:** the full easing/duration-vocabulary conversion of all animations to transform/opacity.

> **⚠ Source discrepancy (flagged 2026-07-02):** the Phase 0 spec §7 checklist still shows these WPs `☐`, and the 2026-06-30 `log.md` entry says "WP-0.C/D/F deferred" — but the code shows the primitives (grain, layered-shadow token, reduced-motion) DID land. Treat the code citations above as ground truth (the spec checklist was never updated; the log understated). Reconcile the log on the next pass, and finish the app-wide application under Phase 4.3.

**Phase 1 — Correctness & cost-safety (do before the pretty)**
- ☑ 1.1 GPS accuracy gate (suppress > ~10 m, "acquiring" state) — shipped 2026-06-24 (c819c69)
- ☑ 1.2 Cache course geometry to Supabase; stop live Overpass — shipped (migration 028 + L1/L2 cache, 45538b2); verified cold→DB→warm-hit locally
- ☑ 1.3 Replace keyless ESRI imagery — shipped as **USDA NAIP** (CONUS, ~0.6m/px to z18, free/keyless), not the generic vector hybrid (57e1ba1); non-CONUS falls back to branded canvas + OSM overlays

**Phase 2 — Hero instrument** — SHIPPED. **MapLibre GL is now the SOLE hole-map renderer; Leaflet fully removed.** Device-verified by Matt.
> **Full-bleed / true edge-to-edge (2026-06-27): DEFERRED to the native shell.** The bottom home-indicator strip, the Safari-vs-installed-app zoom mismatch, and the first-tap keyboard miss are all one root cause — the iOS standalone PWA shrink-fits the `100dvh` layout (`innerWidth=459` vs Safari `390` on-device). No web-side lever fixes it without knocking the bottom nav off-screen. It does not exist in the native WKWebView build (the App Store target). Tracked as **POST-LAUNCH-TODO #24**; **no further PWA viewport changes.**
- ☑ 2.1 MapLibre vector + branded style — shipped; Leaflet removed entirely (`f524a1a`). NAIP raster base + branded green/gold vector overlays (tee, green polygon, dashed tee→aim→green line), course-up bearing, draggable aim point + split yardage pills, per-club landing-zone ring, tap-to-measure. (The earlier "blocked" note was a headless-test-env artifact — MapLibre renders fine on a real device.) **+ Offline tile caching** via `addProtocol` (`naipc://`) → Cache API, FIFO-capped 2000 (`479dd40`); a loaded hole keeps imagery with zero signal. Chunk-load auto-retry too.
- ☑ 2.2 Cinematic flyTo intro — shipped (pitch ~62°, bearing tee→green, reduced-motion aware).
- ☑ 2.3 Distance instrument — shipped: 270° SVG arc gauge + odometer number-roll, lockstep rAF tween (hand-rolled, no NumberFlow dep) (95717ee).
- ☑ 2.4 Glass HUD + unified controls — shipped (1ee636a + GL zoom/attribution restyle).
- ◐ 2.5 Smooth player puck + accuracy halo — shipped (rAF-glide puck + true-ground metres halo). Concentric yardage range-rings still held pending a live-map clutter check.
- ☑ **On-map distance labels + segment-distance correctness (2026-07-02).** On-map yardage labels redesigned to bare outlined tabular numerals (no "y"/"to grn" suffix), gold-flag glyph on the to-green number, single flagged number on par-3/aim-on-green. **Corrected the aim segment math:** replaced the old scorecard-proportional scaling (which broke badly past the green — e.g. showed 219 for a ~435 shot) with pure great-circle (haversine) distance for tee→aim and aim→green. Removed the redundant tap-to-measure readout. Matt verified distances accurate on the beta (Pebble Creek Colts Neck, White tees). *Detail + the "speak only from verified facts" process lesson: `next-session-handoff-2026-07-02.md`.*

**Phase 3 — Leapfrog (pick order)**
- ☑ 3.1 Transparent adjustable plays-like (free) — **SHIPPED 2026-06-25.** Hero plays-like number expands into wind/elevation/temp rows, each overridable; real USGS 3DEP DEM elevation term (migration 029 cache); tappable bottom sheet (mobile-native, no dead tooltip). Spec: `playslike-3.1-build-spec-2026-06-25.md`. **Accuracy rebuild 2026-06-30:** replaced the in-house heuristic (which produced an absurd −36 on hole 6) with sourced, physically-defensible coefficients (asymmetric wind, 0.8%/10°F temp, 1.16%/1000ft altitude, asymmetric elevation) + a 250y single-carry cap so long holes stop ballooning; `geo.test.mjs` 31/31. **Option B (aim-retarget) added 2026-06-30:** dragging the aim short of the pin retargets the whole readout to that aim. Spec: `playslike-accuracy-rebuild-2026-06-30.md`.
- ☐ 3.2 Ad-free generous free tier
- ☑ 3.3 Own-club distance arcs — **SHIPPED 2026-06-25.** Distance arcs from the player's *own* bag averages on the GL hole map; no handicap-based distance guessing (Matt's correction — real bag data only). Spec: `own-club-arcs-3.3-build-spec-2026-06-25.md`.
- ☐ 3.4 Green slope + putt-line
- ☑ 3.5 Data → practice loop — **SHIPPED 2026-06-26, finished to full interactivity 2026-06-27.** `lib/practice.js` analyzes recent rounds + handicap → weaknesses (each with evidence + directional disclaimer) + a practice session (closed-loop re-measure note); `GET /api/practice`; `Practice.jsx` overlay opened from a profile "Practice Plan" card. **2026-06-27:** rebuilt from read-only v1 to fully interactive — tappable drill detail sheets with how-to, a guided Start-Session runner, a closed-loop re-measure display; distinct drills per focus area; migration **034** `tm_practice_logs`. Accuracy reverified by independent recompute. The biggest category-wide unmet need.
- ☐ 3.6 Clean AR distance overlay

**Track H — Handicap & scoring accuracy (ran alongside Phase 3; not in the original plan but foundational to "best-in-class")**
- ☑ H.1 Gender field foundation (migration 030) + effortless bag-distance entry
- ☑ H.2 Gender-correct tee ratings (gender-aware `dedupeTees`) + USGA differential enabled
- ☑ H.3 Course Handicap for match strokes (2024 CR−Par form) + per-player gender ratings (migrations 031) + tappable CH chip on the scoreboard
- ☑ H.4 WHS audit + rewrite: removed obsolete ×0.96, sliding table, 0.1 rounding, 54.0 max, 3-round min, net-double-bogey AGS, soft/hard caps + 365-day Low-HI history (migration 032), per-format allowances (Appendix C), single-source persisted index
- ☑ H.5 9-hole corruption guard + solo rounds handicap identically to outing rounds (migration 033) — 2026-06-26
- ☑ H.6 **Proper WHS 9-hole counting** (expected-score method, Rule 5.1b) — 9-hole rounds now COUNT, converted to one 18-hole differential via expected-9. 9-hole CR estimated as ½·18-hole CR (no new data dependency). 11 assertions. `6e85608` — 2026-06-26. **Handicap engine is now WHS-complete.**
- Audit + status: `handicap-accuracy-audit-2026-06-25.md`

**Phase 4 — Polish**
- ☐ 4.1 Skeletons + view transitions
- ☐ 4.2 Perf budgets + `content-visibility`
- ☐ 4.3 Eagle Eye inline-style → token component refactor

**Track F — Scale & Foundations Hardening** (added 2026-06-27 from `synthesis/audit-2026-06-27.md` — the "expensive to change after the App Store freezes clients" class. Sequence: cheap foundationals → data model → security → native shell.)

*F-cheap — do first (small, independent, expensive-later):* — **SHIPPED 2026-06-27 (`d282074`)**
- ☑ F.1 `/api/v1` route prefix — one router dual-mounted at `/api/v1` + `/api` (legacy alias); client rewrites `/api/*`→`/api/v1/*` centrally. Server-smoke verified both mounts. — audit N5
- ☑ F.2 Serverless DB pool `max 5→2` in prod + `allowExitOnIdle` — audit N6. ☑ *Confirmed 2026-06-29:* `db.tx` (single-client BEGIN/COMMIT) + `SELECT FOR UPDATE` work correctly against the real Supabase pooler (proven during F.5 S2, zero-data-impact check).
- ☑ F.3 Migration `035_tm_outings_indexes.sql` (status partial+full, host_id; `CONCURRENTLY`) — **applied to prod 2026-06-29** — audit N9
- ☑ F.4 CI enforcement: lint hard gate (removed `continue-on-error`); new `test` job (vitest suites + `node --test` math + client units) — audit N8

*F-data-model — must precede App Store client-freeze:*
- ☑ **F.6 SHIPPED 2026-06-27 (`816d3d0`)** — `/end` pair inserts + result update batched into 2 `unnest` queries (was O(N²) sequential); logic extracted to pure, unit-tested `lib/match-close.js` (7 parity tests guarding the 2026-05-07 all-pairs + 2026-06-23 tie fixes); 20/20 server tests, boot-smoke verified. **Verify on beta: close a 3+ player individual match → rivalries populate.** tm_rounds/handicap fan-out (O(N), not the timeout driver) left as a follow-up. — audit N4
- ☑ F.5 **COMPLETE — all 7 stages LIVE on beta 2026-06-29.** The "never lose your round" data-model rework. Stages + sub-specs: S1 read-from-rows (`SCORING_READ_FROM_ROWS`); S2 OCC on the on-behalf path (`db.tx` + `SELECT FOR UPDATE` + enriched 409 + inline conflict chip, `SCORING_OCC_ONBEHALF`); S3 offline idempotency (migration 037 `tm_idempotency_keys`, tap-time keys, claim+write+response in one txn, `SCORING_IDEMPOTENCY`); S4 guests→real rows (migration 038, `user_id NULL`, `SCORING_GUEST_ROWS`); S5 flip friends-live/season/leagues/CSV to row-derived (`SCORING_AGG_READ_FROM_ROWS`); S6 designated-scorer mode + scorer-visibility UX (`SCORING_DESIGNATED`); S7 cutover — rows are the SOLE score store, dead `/scores/marker` retired (`SCORING_STATE_WRITES_OFF`). All flag-gated + reversible; verified vs real Postgres + live prod + a real-browser UI pass. Specs: `f5-s2-s3-build-spec-2026-06-28.md`, `f5-s4-guest-rows-build-spec-2026-06-29.md`, `f5-s5-reader-flip-build-spec-2026-06-29.md`, `f5-s6-designated-scorer-build-spec-2026-06-29.md`. Only residual: a real on-course round on the native iOS shell (confidence check, not a gate). — audit N3

*F-security — greenlit in the handoff; spec it:* — ◐ specced in foundation-lock build spec
- ☐ F.7 JWT revocation: add `tm_users.token_version`, embed + check it, bump on `reset-pin`/logout; consider shorter TTL + refresh — audit N7
- ☐ F.8 PIN brute-force: account-keyed rate limit + exponential lockout in a shared store (`tm_login_attempts` or Upstash); consider 6-digit PINs — audit N7

*F-native-shell — verify together in TestFlight (alongside #24):*
- ☐ F.9 iOS Info.plist `NSLocationWhenInUseUsageDescription` + `NSCameraUsageDescription` (crash + hard rejection without them) — audit N1 / POST-LAUNCH #25
- ◐ F.10 Native-shell sentinel — **web side SHIPPED** (`isNativeShell()` + gated PWA prompts off); ☐ native side: inject `window.__TM_NATIVE__` + `WKUIDelegate` link handling — audit N2 / POST-LAUNCH #26

*F-opportunistic — fold in between features:*
- ☐ F.11 Decide + enforce scorecard privacy on `GET /rounds/:id` (currently enumerable by sequential ID) — audit N10
- ◐ F.12 Server vitest scoped to real suites + client `test` script added; bare-assert files run via `node --test` in CI. ☐ remaining: convert them to real suites over time — audit N11
- ◐ F.13 ☑ dead GPS `denied` branch fixed (→`denied-hard`); ☑ friendly camera-denied error; ☐ privacy-link `target="_blank"` (native-shell `WKUIDelegate`) — audit N12
- ☐ F.14 Maintainability slices: split `Home.jsx`/`LiveOuting.jsx` god-files; light client state pattern (`UserContext`); add engineer-facing `README.md` — audit N13–N15

**Operational / cost decisions (not code)**
- ☐ Migrate the-match off free tiers onto the org's existing Vercel Pro + Supabase Pro
- ☐ Decide satellite strategy: free vector worldwide + NAIP US, vs paid imagery where/when
- ☐ Confirm attribution surface (OSM + vector tiles + fonts + NAIP)
- ☐ Marketing accuracy stance (Matt, 2026-06-24): **never claim "laser" / "laser-grade,"** and **do NOT advertise a precision margin** (don't say "~3–5 yd" — publicly stating an error figure spotlights the gap vs a laser). Lead with strengths instead: instant GPS distances to front/center/back, the whole-hole view, no rangefinder needed. Sell what we're great at; never narrate the limitation. **UPDATE 2026-06-30 (Matt): this extends INTO the app — the on-screen "±X m" chip was removed. Showing an error figure anywhere (even in-app) narrates the flaw. Eagle Eye now shows only a calm "GPS"/"ACQUIRING" state; the gate still uses `coords.accuracy` internally. Do NOT re-add an on-screen margin, and do NOT build a "graded confidence chip."**

---

## 5. Decisions I need from you

1. **First build slice:** Phase 0 only, or Phase 0 **+ Phase 1 (correctness/cost-safety)**? I'd strongly recommend Phase 1 early — it fixes the ESRI licensing risk and the GPS-trust issue, which matter more than looks for a worldwide product.
2. ~~**Satellite strategy**~~ — **DECIDED (Matt, 2026-06-23):** US launch on free NAIP imagery; non-US gets the free vector hole view; worldwide photographic coverage is a future roadmap upgrade. Zero cost at launch.
3. **Map migration appetite:** green-light MapLibre (flagged, with the current path as fallback)?
4. **Hosting migration:** confirm we migrate the-match onto the org's existing Vercel Pro + Supabase Pro (already paid — $0 new). With that, the **only open cost decision is satellite imagery** (#2 above).
5. **Which Phase 3 leapfrog** to sequence first.

Give me these and I'll convert the chosen slice into a build-ready spec and ship it through the beta with full test-and-audit rigor.

---

*Sources for all cost/license/accuracy claims: MapLibre/Leaflet/Turf/visx/Motion/react-spring/Recharts LICENSE files; OFL font licenses; Vercel Fair-Use + Terms; Supabase pricing/limits; ESRI/Google/Bing imagery terms; Copernicus/USGS/NAIP licenses; OSM ODbL + Overpass usage policy; GPS.gov + MDN geolocation; WebKit/Apple PWA docs; MapLibre performance issues. (Compiled by verification agents this session; primary-source URLs available on request.)*
