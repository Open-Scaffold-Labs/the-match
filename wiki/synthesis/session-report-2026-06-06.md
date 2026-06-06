---
type: synthesis
created: 2026-06-06
updated: 2026-06-06
tags: [the-match, session-report, eagle-eye, golfnow, course-data, process]
---

# The Match — Session Report, 2026-06-06

Full record of the day's work. Eagle Eye feature work is on branch `feat/eagle-eye-upgrades`
(build-verified, **not device-tested, not deployed**); docs/process changes are on `main`.

## 1. GolfNow affiliate

- Researched the GolfNow Affiliate & Partner API: REST/JSON + OAuth 2.0, ~$3.00/round, an
  **application-gated** partnership (not instant self-serve) via `golfnow.com/business-partnership/form`.
- Found the home-screen "Book a Tee Time" card links to a **bare** `golfnow.com/tee-times` URL — no
  affiliate tag, so it currently earns **$0** on every booking it sends.
- Entity = **Open Scaffold Labs, LLC**; submitter = **Dale (Account Holder)**.
- **STATUS: Dale submitted the GolfNow partnership application (2026-06-06).** Awaiting GolfNow
  review/approval.
- **Next on approval:** swap the bare home-screen link for the affiliate-tagged link so bookings
  are attributed and earn commission.
- Deliverables: `golfnow-affiliate-application.md`, `GolfNow-Partnership-for-Dale.docx`.

## 2. Eagle Eye regression — diagnosed & fixed

- Eagle Eye = the **whole GPS/course-distance experience** (satellite map + live yardages), not just
  the photo rangefinder.
- **Root cause (verified 3 ways):** `/api/eagle-eye/osm` tried the dead `overpass.kumi.systems`
  mirror **first with no per-mirror timeout** → fetches hung → app dropped into the degraded
  "wrong pins / off distances / lag" mode. External mirror rot (~late May), **no code change on our
  side**. Live-tested 2026-06-06: kumi dead, lz4/main healthy (~0.6s).
- The 2026-06-01 session had correctly fixed this, but the **whole session was reverted 2026-06-02**
  (it also broke the pin/tee design) — throwing out the good fix with the bad.
- **Fix:** server-only change on branch `fix/osm-mirror-only` (`f26768f`) — reorder mirrors to
  `[lz4, main, kumi]` + 10s per-mirror AbortController timeout. Pushed (not yet merged to main).

## 3. Course-data strategy

- The competitive gap vs 18Birdies/TheGrint: they run **verified** course DBs; we're on
  crowd-sourced OSM.
- Researched providers: Golf Intelligence (only public pricing — $399–$5,999/mo, ~$0.18–0.35/golfer/yr,
  99.9% SLA + green-slope data), iGolf & GolfLogix (device-grade, quote-only), golfapi.io, Golfbert.
- Recommendation: trial Golf Intelligence free tier; keep OSM as fallback.
- Deliverable: `Course-Data-Provider-Comparison.docx`.

## 4. Eagle Eye improvements built (branch `feat/eagle-eye-upgrades`)

All build-verified, geo tests 21/21, **NOT device-tested, NOT deployed:**

- **Pull-to-refresh data-loss fix** — course (`tm-shared-course`) + hole (`tm-eye-hole`) persist and
  resume on any reload (`438bdb5`).
- **Wake Lock** — screen stays awake on a course (`438bdb5`).
- **Plays-like on the live GPS number** — wind/temp/altitude (`438bdb5`).
- **`client/src/lib/geo.js` + `geo.test.mjs`** — proven math core, 21/21 Node tests (`86a4c02`).
- **Feature A: tap-to-measure** — tap the satellite for carry + to-green (`35182ec`).
- **Feature B: Front/Center/Back green** from OSM green polygons (server `greengeom` query +
  `matchPolygonsToHoles` + `greenFCB`); falls back to single number when no polygon (`f365ecf`).
- **Feature flags** `ENABLE_TAP_MEASURE` / `ENABLE_FCB` — one-line kill switches (`03b12c2`).
- **GPS pill is tappable** — turn GPS on / refresh exact location (`2d34ec0`).
- Build log entry (`dcebede`).

## 5. Empirical verifications

- **OSM green-polygon coverage: 11/11 courses** sampled (US munis, UK links, Australia, small-town
  muni) have green polygons, 0 node-only → F/C/B viable on free OSM.
- **leaflet-rotate click→latlng:** could not resolve from the sandbox (source fetch timed out) →
  device-test item; one-line `mouseEventToLatLng` fallback identified.

## 6. Planning & process

- **Audited next-level build plan:** `wiki/synthesis/eagle-eye-next-level-plan-2026-06-06.md`
  (`c6899ec`) — gates, risk register, test strategy.
- **Fixed stale `main`:** pushed the marketing commit + diagnosis log to `main` (`72bcf46`).
- **Codified "Push & branch discipline"** in the-match `CLAUDE.md` (`18bff4e`): docs→main,
  untested code→branch.
- **Anti-patterns added** to the OpenScaffold wiki: **#21** (don't ask Matt for facts already in the
  stack) and **#22** (don't let main go stale) — pushed (`16e2a5e`), Pinecone-synced, #22 verified
  retrievable in reminder bucket `ab4b7ccb`; the-match CLAUDE.md re-added to reminder bucket
  `43a69b99` (status ready).
- Roll Call passed at session start (24/24 green).

**Commit map** — `main`: `c560a41`, `72bcf46`, `18bff4e` · `feat/eagle-eye-upgrades`: `438bdb5`,
`86a4c02`, `c6899ec`, `35182ec`, `f365ecf`, `03b12c2`, `2d34ec0`, `dcebede` ·
`fix/osm-mirror-only`: `f26768f` · openscaffold-wiki: `817eaa5`, `16e2a5e`.

---

## What still needs to be done

**The gate (Matt, on a course):**
1. **On-course device test** — tap-to-measure accuracy (and under map rotation), F/C/B vs a yardage
   book, pull-to-refresh resume, wake lock, GPS-pill refresh. Everything else waits on this.

**Ship steps (Matt triggers — they deploy):**
2. **Merge `fix/osm-mirror-only` → main** (G1) — reliability fix; safe to ship now, independent of
   the features.
3. **Merge `feat/eagle-eye-upgrades` → main** once device-tested — flags allow shipping dark.
4. **Preview smoke-test → deploy.**

**Smaller / optional:**
5. **G3** — confirm rotation→tap on device (fallback known).
6. **OSM parser fixture test** — conscious skip; the risky math is already unit-tested.
7. the-match reminder bucket `43a69b99` — updated CLAUDE.md is ready/indexed but content-recall via
   chat was fuzzy; a future session can re-confirm.

**Bigger picture (when ready):**
8. **GolfNow:** Dale's application submitted → await approval → wire the affiliate-tagged link into
   the home-screen card.
9. **Trial Golf Intelligence** (free tier) for true F/C/B everywhere + green-slope data to feed the
   AI caddie.
