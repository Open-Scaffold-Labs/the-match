# Handoff — Eagle Eye satellite tile grid lines (open issue)

**Created:** 2026-05-01 — end of session
**Status:** unresolved after multiple CSS attempts

## TL;DR

The satellite map in The Match's Eagle Eye tab shows visible grid lines between tiles. Multiple fixes attempted, none have closed the gap. Root cause is most likely the **leaflet-rotate plugin** introducing fractional-pixel positioning when the map rotates course-up — adjacent satellite tiles end up with sub-pixel seams that paint as visible lines.

## What's been tried (in order)

All changes scoped to `client/src/pages/EagleEye.jsx` inside the inline `<style>` block near line 1650.

1. **`background: #070C09 !important` on `.leaflet-container`** — Changed gap color from white (Leaflet default `#ddd`) to dark green to match the page. **Result:** gaps still visible, just dark instead of light.
2. **`outline: 1px solid transparent` on `.leaflet-tile`** — Hoped this would force the browser to rasterize tile boundaries cleanly. **Result:** no visible effect.
3. **`transform: scale(1.01)` on `.leaflet-tile` + `transform-origin: 0 0`** — Slight oversample so adjacent tiles physically overlap by ~1 pixel. **Result:** Matt reports lines still showing.
4. **`backface-visibility: hidden` + `transform: translateZ(0)` on `.leaflet-tile-pane` and `.leaflet-tile`** — Force GPU compositing to kill sub-pixel CPU rasterization seams. **Result:** combined with #3 above, still visible.
5. **`will-change: transform` on `.leaflet-tile`** — Compositing layer hint. **Result:** no improvement.

Current CSS in the file (lines ~1665-1690):

```css
.leaflet-container { background: #070C09 !important; }
.leaflet-tile-pane {
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  transform: translateZ(0);
}
.leaflet-tile {
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  will-change: transform;
  transform: scale(1.01);
  transform-origin: 0 0;
}
```

## Likely root cause

The leaflet-rotate plugin (loaded from CDN at runtime, version 0.2.8) applies `transform: rotate(<bearing>)` to the entire map pane. When rotation is non-axis-aligned (anything other than 0°/90°/180°/270°), each tile's position is computed in fractional pixel coordinates. The browser anti-aliases the tile edges against whatever's beneath. Even with the container background matching the page, the anti-aliasing creates a visible darker line at the rasterization boundary.

The `scale(1.01)` trick *should* have worked because it makes tiles physically overlap. The fact that it didn't suggests one of:
- The rotate plugin's per-tile transform is overriding or composing with my scale in a way that cancels the overlap
- iOS Safari is anti-aliasing each tile independently before compositing, so the seam line remains visible across tiles regardless of overlap
- The grid lines aren't actually inter-tile seams but something else (e.g., a leaflet debug overlay, a CSS rule from a library, etc.)

## What to try next (ranked)

1. **Inspect computed CSS in iOS Safari dev tools.** Connect Matt's iPhone to a Mac running Safari, open Develop → his iPhone → the-match tab, inspect a `.leaflet-tile` element. Check what transforms are *actually* applied. The `scale(1.01)` may be getting clobbered by the rotate plugin's per-tile transform.

2. **Try `tileSize: 257` in the `L.tileLayer` config.** Forces tiles to render slightly oversized at fetch time, which is conceptually similar to `scale(1.01)` but applied at the source. Less likely to be clobbered:
   ```js
   // EagleEye.jsx line ~323:
   L.tileLayer(url, { tileSize: 257, zoomOffset: 0, ... })
   ```
   Image gets stretched 0.4% — invisible at any zoom. Will close ~1px seams.

3. **Pin a newer leaflet-rotate version.** Currently `leaflet-rotate@0.2.8`. Check `https://github.com/Raruto/leaflet-rotate` for newer releases that may have fixed the tile-seam issue. Note the inverted-bearing bug we worked around in `wiki/synthesis/...` — if you bump the version, re-test orientation.

4. **Disable rotation as a test.** Toggle off the rotate plugin's `bearing` and verify the grid lines disappear entirely. That confirms rotate is the cause. If they persist with no rotation, it's an unrelated rendering bug.

5. **Switch to Mapbox satellite tiles.** ESRI World Imagery is current. Mapbox handles fractional-pixel positioning more robustly per leaflet GH issues. Would need a `MAPBOX_TOKEN` in env.

6. **Add 1px box-shadow inset matching page bg.** Wraps each tile in a subtle border that matches the gap color, so the seam visually merges with tile content edges.

## What's working (don't break these)

- Onboarding wizard runs on signup; mandatory through step 4 (driver). Profile + bag + course + handicap save correctly via `POST /api/profile/update` and `PUT /api/clubs/bag/driver`.
- Home checklist renders + auto-finalizes onboarding when all five items complete.
- Coach marks fire once per user per id on Home, Match, Eagle Eye, My Bag, Profile, PlayerCard. Tour mark intentionally removed.
- Admin gear icon shows for `mlav1114@aol.com` only; opens user roster newest-first.
- Bag toggle on Eagle Eye picks closest club to GPS distance, ▲/▼ cycles, pulsing yellow target on map at projected landing point.
- Match page swipe-left-to-delete works on host's own active matches.
- Tour page renders position, TOT, THRU correctly from new ESPN scoreboard shape.

## File inventory (everything touched this session, all pushed)

- `client/src/pages/EagleEye.jsx` — bag toggle, landing zone marker, yardage card resize, conditions pill cleanup, **tile CSS attempts (this issue)**
- `client/src/pages/Outing.jsx` — swipe-to-delete, expected_players, coach mark
- `client/src/pages/MyBag.jsx` — bag inventory + distance, "+ Other" custom entry, bag complete overlay
- `client/src/pages/Home.jsx` — admin gear, onboarding checklist, profile coach mark, dark calendar
- `client/src/pages/PGAScores.jsx` — ESPN scoreboard shape fix
- `client/src/components/OnboardingWizard.jsx` — new
- `client/src/components/OnboardingChecklist.jsx` — new
- `client/src/components/CoachMark.jsx` — new
- `client/src/components/AdminUsersModal.jsx` — new
- `client/src/components/RivalryDetail.jsx`, `RivalryHistory.jsx`, `FriendProfile.jsx`, `PlayerCard.jsx` — various tweaks
- `client/src/components/BagPhoto.jsx` — created + reverted (file still in tree, unused)
- `client/src/lib/clubCatalog.js` — new
- `migrations/009_tm_user_clubs.sql`, `010_tm_user_clubs_avg_yards.sql`, `011_tm_outings_expected_players.sql`, `012_tm_users_onboarding.sql` — all applied to prod
- `server/src/routes/clubs.js`, `onboarding.js`, `admin.js` — new
- `server/src/routes/outings.js`, `availability.js`, `games.js`, `auth.js`, `profile.js` — additions

## Tell next-Claude

> Eagle Eye's satellite tiles show visible grid lines between adjacent tiles. The leaflet-rotate plugin is the proximate cause. Five CSS attempts have failed: container bg match, transparent outline, `scale(1.01)`, GPU compositing, will-change. Read `HANDOFF-2026-05-01.md` for full list. Start with **iOS Safari dev tools inspection** of the actual computed transforms on `.leaflet-tile`, then try **`tileSize: 257`** in the tileLayer config (high success rate, low risk), then try a **leaflet-rotate version bump**. Don't re-attempt the fixes already in `EagleEye.jsx` — they're documented as unsuccessful.
