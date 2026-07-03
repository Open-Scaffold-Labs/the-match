---
type: build-spec
created: 2026-07-02
status: proposed
branch: feat/sg-v2 (follow-up slice — do NOT start before PR #1 lands)
---

# SG map-tap shot capture — build spec (proposed)

## Why

Full 4-bucket Strokes Gained (OTT/APP/ARG/P) needs per-shot `lie` + `toPin`.
The ShotSheet (shipped on `feat/sg-v2`) captures both, but toPin is typed by
hand. The GL hole map already knows the player's position (GPS puck) and the
green centroid/polygon — distance-to-pin is one haversine away. Map-tap
capture makes the highest-friction SG fact nearly free, which is what moves
`roundsWithShots` past the 8-round gate for real users.

## The one-sentence design

While a solo round is active, Eagle Eye's hole view grows a **LOG SHOT**
pill that opens the existing ShotSheet with `toPin` **prefilled from
puck→green distance** (player editable, never silently trusted), and the
saved shot flows into the SAME ActiveRound state/localStorage the score
modal writes.

## Constraints learned from the codebase (do not violate)

1. **HoleMapGL colors go to MapLibre paint props where `var()` does NOT
   resolve** — any new overlay must use the `eeColor` getComputedStyle
   bridge (see range-rings slice, log 2026-07-02 PM2).
2. **Marketing-accuracy stance (Matt, 2026-06-24/30):** never show a ±error
   figure. The prefill is presented as a plain number the player can adjust,
   no confidence chip.
3. **ActiveRound owns solo-round state** (component state + localStorage
   `SOLO_ROUND_STORAGE_KEY(user.id)`). Eagle Eye must not grow a second
   source of truth.
4. **GPS accuracy gate** already exists (suppress >~10 m); reuse it — a
   prefill from a bad fix is worse than no prefill.

## Mechanics

- **Bridge:** ActiveRound already navigates out via `onGoToEagleEye(hole+1)`.
  Add a reciprocal `pendingShot` handoff: Eagle Eye writes
  `tm_pending_shot_v1` = `{ holeIdx, club, lie, toPin, ts }` to localStorage
  and navigates back; ActiveRound (already restoring from localStorage)
  consumes + clears it on focus, appending via the existing `addShot(idx, …)`
  path. No new server surface. TTL ~10 min; ignore if no active round or
  hole mismatch → drop silently (never corrupt a round).
- **toPin source:** great-circle distance from GPS puck to (a) the dragged
  pin position when the user has set one, else (b) green centroid. Yards,
  rounded. Reuse the corrected haversine path from HoleMapGL (2026-07-02
  fix — NOT the old scorecard-proportional scaling).
- **Lie prefill:** shot 1 of the hole → `tee`. Otherwise leave unselected
  (never guess rough vs fairway from geometry we don't trust).
- **UI:** gold pill next to the existing DISTANCES affordance, only when
  `activeRound` context was passed in; opens ShotSheet (reuse, don't fork).

## Out of scope (explicitly)

- Auto-detecting shots from GPS movement (Arccos territory; battery + false
  positives; revisit post-App-Store).
- Outing/multi-player shot capture (solo first; outing rounds get putts via
  the post-hoc PuttEntrySheet already shipped).
- Any change to the F.5 scoring write path.

## Verification gates

1. Unit: haversine prefill matches HoleMapGL's segment math on 3 fixtures.
2. Round-trip: log shot in Eagle Eye → back to ActiveRound → shot appears in
   modal log with lie+toPin → finish round → chain validates in /stats/sg
   (walkChain returns categories on that hole).
3. Stale-handoff: pending shot with old ts / wrong hole / no active round is
   dropped, round state untouched.
4. Device pass: pill reachability one-handed; prefill sanity on a real hole.

## Estimate

One focused session. Touches: `EagleEye.jsx` (pill + handoff write),
`ActiveRound.jsx` (handoff consume), `lib/geo.js` (shared distance helper if
not already exported), tests for the handoff parser.
