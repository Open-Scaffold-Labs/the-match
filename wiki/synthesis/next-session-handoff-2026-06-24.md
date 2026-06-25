---
type: synthesis
created: 2026-06-24
updated: 2026-06-24
tags: [the-match, eagle-eye, roadmap, build-plan]
---

# The Match — Next-Session Handoff
*Written 2026-06-24 (end of a long Cowork session). Read this, then the two plan docs alongside it in `wiki/synthesis/`.*

---

## 0. Start here (before any work)
1. **Run Roll Call** (`roll-call` skill → `tools/limitless-preflight.sh`). Don't start substantive work until READY.
2. **Read the plan docs (same `wiki/synthesis/` folder):**
   - [[synthesis/build-plan-bulletproof-2026-06-23]] — phased build + zero-cost stack + progress checklist (Phase 1 + 2 ☑).
   - [[synthesis/eagle-eye-premium-plan-2026-06-23]] — design/Eagle-Eye vision.
3. **Read `the-match/wiki/log.md`** top entry (2026-06-24, "Phase 2.1/2.2 SHIPPED — MapLibre sole renderer") for the full detail of what shipped.
4. Beta discipline unchanged: `main` auto-deploys and **is** the test env. Every change → `npm --prefix client run build` + `lint` + `node --check` (server) → push to `main` → Matt verifies on his iPhone.

> **🎯 This is a NATIVE iOS App-Store app** (WKWebView shell). iOS 15+ → WebGL2 guaranteed. NEVER write browser-framed fallbacks. Every decision = App-Store-readiness. (See the callout at the top of `the-match/CLAUDE.md`.)

---

## 1. Where things stand (what shipped this session)
- **Phase 1 (correctness/cost-safety): ✅ all shipped + verified.** GPS accuracy gate (1.1), durable Supabase OSM cache (1.2, migration 028), ESRI→**USDA NAIP** imagery (1.3).
- **Phase 2 (hero instrument): ✅ shipped + device-verified.** Distance instrument (arc gauge + number roll), glass HUD, smooth puck + accuracy halo.
- **MapLibre GL is the SOLE hole-map renderer — Leaflet fully removed (~800 lines).** NAIP base + branded vector overlays, course-up, cinematic flyTo (pitch ~62°), draggable aim point + split yardage pills, per-club landing-zone ring, tap-to-measure, real OSM green polygons, adaptive zoom.
- **Offline tile caching is live** — MapLibre `addProtocol('naipc://')` → Cache API (`naip-tiles-v1`, FIFO 2000). A loaded hole keeps imagery with zero signal. + chunk-load auto-retry + graceful retry card on genuine failure.
- **Lifecycle fixes:** markers no longer vanish on course switch (null marker refs on teardown); pull-to-refresh disabled on the map; F/C/B only from a trusted GPS fix.

The tee/green/course-layout intelligence (OSM fetch + matching + default aim) lives in `EagleEye.jsx` + `lib/geo.js` + the server — **renderer-agnostic**; the Leaflet removal didn't touch it.

---

## 2. Recommended pick-up order (Phase 3 — leapfrog features)
These are the strategic moat. Sequence by Matt's appetite (confirm at session start):
1. **3.1 Transparent, adjustable plays-like (free)** — hero plays-like number you tap to break into wind / elevation / temp, each overridable. The single biggest category gap. (`computePlaysLike` in `lib/geo.js` already does the base math.)
2. **3.3 Own-club distance arcs** — draw the player's club averages as arcs on the map (ties into the bag model + the landing-zone ring already built).
3. **3.2 Ad-free generous free tier** — strategic positioning decision as much as code.
4. **3.4 Green slope + putt-line** · **3.5 data→practice loop** · **3.6 clean AR** — bigger lifts.

Then **Phase 4 polish** (skeletons, perf budgets, Eagle Eye inline-style→token refactor) and the **operational/cost decisions** (migrate the-match onto the org's Vercel Pro + Supabase Pro; confirm attribution surface; set the "~3–5 yd, never laser" marketing promise).

One small held item: **concentric yardage range-rings** on the map (held pending a live-map clutter judgment).

---

## 3. Known gotchas / lessons (save yourself the pain)
- **DOM checks are ground truth; screenshots are NOT.** In the Chrome-MCP test tab, screenshots lag/cache (showed stale frames repeatedly) and the console replays errors from old bundles. To verify the map: query `document.querySelectorAll('.maplibregl-canvas').length`, `.leaflet-container`, `caches.open('naip-tiles-v1')`, etc.
- **NAIP throttles a hammering IP.** After ~40 test reloads the USDA NAIP server (`gis.apfo.usda.gov`) started timing out *my* burst tile requests (a single fetch still worked). It self-recovers. Don't conclude "the map is broken" from repeated reload failures — verify on Matt's device. Real-user safety net: offline cache + 20s load-timeout + retry card.
- **MapLibre raster `addProtocol`:** return `{ data: ArrayBuffer }` of the encoded JPEG **file bytes** (not pixels) — per maplibre-gl discussion #4480. A service worker does NOT work for tile caching (MapLibre fetches tiles from its worker thread, which the SW can't intercept).
- **MapLibre lifecycle:** `map.remove()` destroys all DOM markers — null EVERY marker ref on teardown or they won't re-create on the next map (the course-switch bug).
- **`api.x` vs `api.x.y()` shadowing**, **String-coerce both sides of id compares**, **don't drive-by refactor** — standing repo conventions.

---

## 4. Key files
- `the-match/client/src/pages/EagleEye.jsx` — Eagle Eye shell, HUD, distance instrument, OSM fetch/matching, course picker. Renders `<HoleMapGL>` directly now.
- `the-match/client/src/pages/HoleMapGL.jsx` — the MapLibre renderer (all map overlays, flyTo, puck, aim, landing, offline tile `addProtocol`).
- `the-match/client/src/lib/geo.js` — haversine, bearing, plays-like, green F/C/B, polygon matching (renderer-agnostic geometry).
- `the-match/server/src/routes/eagle-eye.js` — OSM/Overpass proxy + Supabase cache (migration 028 `tm_osm_cache`).
- `the-match/client/public/sw.js` — PWA service worker (push + cache-sweep + per-deploy stamp). **Do NOT add tile caching here** (worker-thread bypass; use `addProtocol`).

---

## 5. End-of-session checklist (for when YOU wrap)
`wiki/log.md` entry → refresh trust anchors (CLAUDE.md / index.md) → commit+push `the-match` → `python3.11 tools/notebooklm-wiki-refresh.py` → verify `verify_failed: 0` → preflight green.
