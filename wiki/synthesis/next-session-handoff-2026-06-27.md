---
type: synthesis
created: 2026-06-27
updated: 2026-06-27
tags: [the-match, handoff, roadmap, eagle-eye]
---

# The Match — Next-Session Handoff (2026-06-27)

*Supersedes `next-session-handoff-2026-06-26.md`. Read this first, then the two living plans: `build-plan-bulletproof-2026-06-23.md` (the checklist) and `eagle-eye-premium-plan-2026-06-23.md` (the design thesis). Both still current through 2026-06-26.*

## Where things stand (one paragraph)

The leapfrog + handicap tracks are in great shape: **3.1 plays-like**, **3.3 own-club arcs**, **3.5 data→practice loop**, and the whole **WHS handicap engine (through H.6)** are shipped and device-verified. This session did three things on top of that: (1) **finished the practice loop to full quality** — it's now genuinely interactive (drill detail sheets, a guided Start-Session runner, a closed-loop re-measure display), not the read-only v1; (2) **rebuilt Eagle Eye's distance arcs as real whole-bag arcs** with collision-aware labels; and (3) took a long run at **Eagle Eye full-bleed / true edge-to-edge** in the home-screen PWA — which we **deliberately deferred to the native build** after pinning the root cause. The beta (`main` → Vercel) is **green and stable**; the bottom nav, viewport meta, and Eagle Eye are back to known-good, with the temporary on-screen diagnostic removed.

## What shipped this session (2026-06-26 PM → 2026-06-27)

**Practice loop — finished to full quality (Phase 3.5 polish).** The v1 was a read-only panel; Matt's bar is "#1 app, nothing half-done." Now:
- Portal the overlay to `document.body` so it actually opens above the transformed tab shell (`5755ee4`).
- Fully interactive: tappable drill detail sheets with how-to, a guided **Start-Session runner**, and a **closed-loop** "re-measure next round" display (`49e0290`, `9eeaa3f`).
- Distinct drills per focus area — killed a bug where two areas showed identical drill sets (`264943f`); single close button on runner step 1 (`27e178c`); neutral labels for low-severity tracked areas (`75dc64b`); premium + design-audit visual pass (`bb355a5`, `25af026`).
- Verified accurate by independent recompute (blow-up %, par-type splits, hard-hole splits all matched the engine).

**Eagle Eye own-club arcs — rebuilt (`20da4f3` + label passes `86165fa`/`7264a75`/`3c9f3e1`).** Real whole-bag distance arcs on the GL hole map (not own-club-only), with collision-aware labels that flip out of the distance-card zone and spread to the arc end so they don't overlap. `client/src/lib/clubModel.js` (+ `__tests__/clubModel.test.mjs`).

**Eagle Eye full-bleed — attempted, DEFERRED to native (see POST-LAUNCH-TODO #24).** A long sequence (fullscreen restructure, tab-bar removal on Eagle Eye, `position:fixed` shell, a `ResizeObserver` on the GL canvas, safe-area inset expansion, viewport-meta experiments) trying to kill the bottom home-indicator strip. **Root cause pinned:** the iOS **standalone PWA shrink-fits the `100dvh` layout** (measured `innerWidth=459` vs Safari's correct `390` on the same device), which produces the bottom strip, a Safari-vs-app zoom mismatch, AND the sign-in keyboard not popping on first tap — all one root cause. No web-side lever fixes it without breaking the nav. **It does not exist in the native WKWebView shell** (the App Store target), so it's parked there. Beta reverted to known-good (`aa02212`); diagnostic removed.

**Kept (benign/correct, survived the revert):** `HoleMapGL` `ResizeObserver` (`f3cb393` — canvas now tracks its container), bottom-nav safe-area padding + `--nav-height` including the inset, and the Login fairway photo moved to its own fixed layer (cleaner; the original `background-attachment:fixed` is a known iOS touch-bug source).

**Reverted (experiments that destabilized):** viewport-meta changes (`minimum-scale`, dropping `user-scalable`/`maximum-scale`) → restored original; Eagle Eye 4-edge/bottom inset expansion → back to `inset:0`; on-screen `SafeAreaProbe` → removed.

Commits: `bb355a5`→`4b15d9f`. build + lint + `node --check` clean throughout. Beta `main` green.

## Pick up next — ranked

1. **Eagle Eye premium-plan, remaining Phase-0 / Phase-3 items** (design thesis in `eagle-eye-premium-plan-2026-06-23.md`):
   - **Phase 0 foundation** (still ☐ in the build plan): dark-elevation + layered-shadow tokens (0.1), type system + the mono "instrument" numerals (0.2), motion-discipline pass (0.3). Highest perceived-quality-per-hour, low risk, whole-app lift.
   - **Eagle Eye control system:** the audit flagged four competing floating islands (ANALYZE / BAG / hole pill / distance card). Unify into one coherent spatial system + matching premium icon buttons for ARCS/BAG. (Lower priority than Phase 0; pure polish.)

2. **Next Phase-3 leapfrog — Matt's pick.** Shipped: 3.1, 3.3, 3.5. Remaining: **3.2** ad-free generous free tier · **3.4** green slope + putt-line (needs a credible contour data source) · **3.6** clean AR distance overlay.

3. **App-Store packaging pass (when ready) — this is where the safe-area work lives now.** POST-LAUNCH-TODO **#24**: in the WKWebView shell set `contentInsetAdjustmentBehavior = .never` + drive insets natively → the bottom strip, the zoom mismatch, and the first-tap keyboard all resolve together. Verify on a real device in TestFlight.

4. **Operational / pre-launch (not code):** migrate the-match onto the org's existing Vercel Pro + Supabase Pro (off free tiers); confirm the attribution surface (OSM + vector tiles + fonts + NAIP); hold the marketing accuracy stance (never claim "laser"/precision margins).

5. **(Greenlit earlier, still open) Security hardening:** write up the JWT/PIN review as a wiki doc + implement PIN brute-force hardening (shared-store rate limit + account lockout; current limiter is in-memory and unreliable on serverless). 90-day JWT has no revocation.

## Hard-won lesson from this session (don't repeat)

**Do not pixel-chase iOS-standalone-PWA safe-area/viewport quirks by blind-deploying to the device.** The home-screen PWA renders differently from Safari and from the native shell; web-side viewport levers (`minimum-scale`, inset expansion, cover toggling) either don't move it or break the nav. When something looks like an OS-rendering quirk: **measure on-device first** (an on-screen `innerWidth`/`innerHeight`/`safe-area` readout settled this in one screenshot), and if it's standalone-only, **defer to the native shell** rather than thrashing the beta. This cost most of a session; the deferral was the right call once the root cause was measured.

## Standing rules for next session (don't relearn the hard way)

- **Roll Call first** (`roll-call` skill / `tools/limitless-preflight.sh`), then read `wiki/index.md` + the most recent `wiki/log.md` entry.
- **Beta discipline:** `main` IS the test surface — build-verified feature code goes to `main`. The gate is **build AND lint** (`npm --prefix client run build` + `run lint` + `node --check` on changed server files). Lint (`no-undef`) catches ReferenceError-class scope bugs a clean `vite build` will happily ship.
- **No PWA viewport-meta changes** — they destabilize the beta nav for zero product benefit. Safe-area is a native-shell concern (#24).
- **Migrations** are append-only, applied by hand via `psql "$DATABASE_URL" -f migrations/0NN_*.sql` (now through 034 — practice logs).
- **Mobile-first** everywhere EXCEPT leagues/commissioner surfaces (desktop too).
- **Handicap engine is the single source of truth:** `maybeUpdateUserHandicap` writes the persisted index; `stats.js` reads it (never recompute divergently).

## Key files (this session's surfaces)
- `client/src/pages/Practice.jsx` — interactive practice surface (drill sheets, session runner, closed loop).
- `server/src/lib/practice.js`, `server/src/routes/practice.js`, migration **034** (`tm_practice_logs`).
- `client/src/lib/clubModel.js` (+ `__tests__/clubModel.test.mjs`) — whole-bag distance arcs.
- `client/src/pages/EagleEye.jsx` — hero rangefinder (back to known-good `inset:0` root).
- `client/src/pages/HoleMapGL.jsx` — GL hole renderer (now with `ResizeObserver`).
- `wiki/POST-LAUNCH-TODO.md` **#24** — the native safe-area fix.
