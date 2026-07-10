---
type: synthesis
created: 2026-07-10
updated: 2026-07-10
tags: [eagle-eye, course-editor, tm-course-holes, osm, geometry, map-this-course]
---

# "Map this course" editor — build spec + LIVE checklist (2026-07-10)

The permanent fix for systematically-wrong OSM tee/green matching (Bayonne: hero
FROM TEE 365 = scorecard truth vs drawn line 229 = wrong OSM point). Manual
per-hole editor → `tm_course_holes` overrides (authoritative; migration 043 +
GET/PUT `/api/courses/:id/holes` already live — **no server changes**). Replaces
the reverted data-side trust gate (`ad6eb83` → `4831b2b`; lesson in log
[2026-07-10 PM9]: the gate filtered the shared holePositions/greenPositions maps,
the OSM gap-fill read gated holes as forever-missing, refetch-looped).

Grounded in a Plan-agent seam map verified at `c2cfe29` (working tree incl. the
41-line uncommitted HoleMapGL draft). Builds ON the draft, never replaces it.

## 1. Matt's decisions (2026-07-10)

1. **Per-hole PUT** — each hole durable the moment its green is placed; per-hole
   retry; quitting mid-course keeps everything mapped so far.
2. **Reachable anytime the map view is open — but SUBTLE.** The auto-surfacing
   chip appears ONLY when geometry is missing or provably wrong (card-vs-drawn
   mismatch); on accurate courses there is NO chip — just a discreet pencil
   glyph beside the course name. Copy must never read as an error state (the
   app must not look broken — App-Store framing).
3. **No aim point in v1** — tee + green, straight line. Schema/route/geom shape
   already support aim (`[tee, aim, green]`); v1 PUTs `aim: null`. Caveat
   (flag in PR): re-saving a hole clears a stored aim — none exist today.
4. **Snap radius 15 yds** (tighter; favors the exact tap when tees sit near
   greens). Tune on device at Bayonne.

## 2. Seam map (file:line at `c2cfe29` + draft)

EagleEye.jsx (3008 lines): `holePositions`/`greenPositions` 996–997;
`holeGeometries` 1006; `holeOverrides` 1015 + ref 1016; overrides GET effect
1410–1433 (additive merge 1427–1429 — **the proven merge the editor reuses**);
override-over-OSM merge sites 1161–1165 / 1176–1183 / 1359–1362 (cache stays
pure OSM, 1356–1358); `teegreen` candidates fetched 1248 but consumed only as
locals 1288–1303 and NOT cached → editor needs its own lazy fetch; bbox math
1233–1235 (`courseGeocoded` 995); course-name header button 1949–1958; header
chip patterns 2079–2173; `currentHole` 848, `changeHole` 1584–1588, hole pill
2035–2073, `totalHoles` 1548, `teeHoles` 1876; nudge effect 1638–1665; HoleMapGL
render site 2253–2267; `put` helper `lib/api.js:62`.

HoleMapGL.jsx (894 lines, incl. draft): new props 220–223; ref snapshots 259–267
(**`redrawEditRef` = no-op at 263 — body is Slice 1**); edit sources/layers
425–438; guarded click handler 441–444; assign-after-declaration pattern to
mirror: `redrawRef.current = redrawAim` at 682; aim marker (drag risk) 540–554;
`drawHole` camera 560–578; helpers `fc` 91, `eeColor` 159, `haversineYards` 17.

Server (reference only): `routes/courses.js` GET `/:id/holes` 147–170, PUT
174–207 (requireAuth; per-hole upsert `ON CONFLICT (course_id, hole)`; clamps
hole 1–18; non-finite→null; partial arrays first-class). `tm_course_holes`:
`course_id, hole, tee_lat/lon, green_lat/lon, aim_lat/lon (nullable),
updated_by, updated_at`.

## 3. Data flow

State owner = EagleEye. New state (declared in the geometry-state block ~1015,
ABOVE every effect that reads it — TDZ rule):

```
editSession: null | { hole, step:'tee'|'green', drafts:{[hole]:{tee,green}}, savedHoles:{} }
editCandidates: null | { tees:[{lat,lon}], greens:[{lat,lon}] }
```

- Enter: seed drafts from `holeOverrides` first, else `holePositions`/
  `greenPositions` (read-only). Lazy-fetch candidates once
  (`/api/eagle-eye/osm?bbox=…&type=teegreen`, bbox per 1233–1235); fetch fail →
  empty lists, free placement still works (no dead end).
- Tap: `onMapTap` raw coord → `snap(coord, editCandidates[step], 15yds)` via
  `haversineYards`; no candidate in range → raw coord. Write draft, advance step.
- Save (green placed): `put('/api/courses/:id/holes', {holes:[{hole,tee,green,aim:null}]})`
  → on success mark saved + LOCAL additive merge (mirror 1425–1429: overrides
  ref/state + holePositions/greenPositions/holeGeometries `[tee,green]`) →
  advance hole, step='tee'. On failure: hole stays open, inline error + retry —
  draft never lost. No GET refetch (merge = same shape GET produces).
- Exit/finish: `setEditSession(null)`; un-saved half-placed hole → "Discard this
  hole's pins?" prompt. Saved holes already durable.

## 4. Slices + progress checklist (gate per slice: `npm --prefix client run build` + `npm --prefix client run lint`)

- [x] **S0** Commit the existing 41-line HoleMapGL draft as-is — BUILT 2026-07-10
      (`ad429fe`). Verified: build + lint; layers empty / handler inert by
      construction (editMode never passed yet).
- [x] **S1** `redrawEdit()` body in HoleMapGL — function declaration after
      `redrawAim`, `redrawEditRef.current = redrawEdit` on the next line (mirror
      682). Bail unless map+ready; `!editModeRef` → `fc([])` all three sources;
      else editCand points (kind-tagged), editPts from draft (tee gold, green
      green via `eeColor` + literal fallbacks), editLine when ≥2 points —
      BUILT 2026-07-10 (`0e22c6a`). Verified: build + lint; normal mode
      pixel-identical by construction (sources empty when !editMode).
      NOT verified: visual render of dots/line (device).
- [x] **S2** EagleEye edit state + SUBTLE entry + tap/snap loop (no save).
      State in geometry block ~1015. Entry: (a) auto-chip in the header stack
      (pattern 2107–2141) ONLY when `courseCtx && !showStart` AND ≥1 hole in
      `teeHoles` lacks confident geometry OR current hole card-vs-drawn
      mismatch (>max(25yds, 12%)) — computed at render, NEVER written back;
      copy: "MAP THIS COURSE" (invitation, not error); (b) discreet pencil
      glyph beside the course-name button (1954) always available. Editor HUD
      replaces the hole pill: "HOLE N — TAP THE TEE / TAP THE GREEN", n/total,
      Keep & next / Back / Exit. Candidates lazy-fetch; snapping 15 yds; next
      advances `currentHole` in lockstep; four props passed at 2253 —
      BUILT 2026-07-10 (`cac3cf2`). Verified: build + lint. NOT verified
      (device): chip on Bayonne / absent on accurate course; taps; snap; Exit
      residue.
- [x] **S3** Save path — per-hole PUT on GREEN TAP (save & advance: tap tee →
      tap green → next hole), local additive merge (mirror 1425–1429), failure
      keeps hole open + retry chip, "Save & next/done" labels when dirty,
      exit-with-unsaved discard prompt — BUILT 2026-07-10 (`33287cd`).
      Verified: build + lint; PUT contract verified by code read (partial
      arrays first-class, `saved:1`). NOT verified (device): live save
      round-trip, layoutConfident flip, kill+reload persistence, failed-PUT
      retry.
- [x] **S4** Edit-mode guards + polish — (a) nudge effect bails on editSession;
      (b) SCORE/nudge/invite chips hidden while editing (+ entering edit
      closes an open QuickScoreSheet, `41333fa`); (c) aim marker inert in edit
      incl. mid-edit recreation; (d) `drawHole` edit-camera branch top-down
      north-up, re-framed on the editMode flip itself (drawHole's effect
      doesn't run on a flip) — BUILT 2026-07-10 (`3d90537`). Verified: build +
      lint. NOT verified (device): all runtime behavior.
- [x] **Audit** (audit-before-claim) — run 2026-07-10. Honest split: every
      slice is build+lint green and committed to `main` (`ad429fe` → `41333fa`);
      ZERO runtime verification has happened — no browser or device run. The
      candidate-fetch parsing mirrors the OSM effect's field handling but is
      unverified against a live Overpass response. §6 device checklist is
      entirely open and is the gate on calling this feature done.

## 5. Risk register

- **(a) Refetch-loop (the reverted-gate class).** Editor only ever ADDS keys to
  the shared maps via the shipped merge (1425–1429); drafts/candidates are new
  state; OSM effect untouched; cache stays pure. Review rule: no slice may
  contain a `setHolePositions`/`setGreenPositions`/`setHoleGeometries` call
  that can DROP a key. Wrongness detection is render-time only.
- **(b) TDZ / no-use-before-define** (2 shipped crashes; lint rule live).
  `editSession`/`editCandidates` declared above every reader; `redrawEdit` =
  hoisted function declaration + immediate ref assignment (682 contract).
- **(c) Handler interplay.** Aim drag disabled in edit (S4c); click handler
  already editModeRef-guarded (441); nudge gated (S4a); hole pill replaced by
  the editor HUD so no competing navigation.
- **(d) Partial saves.** Per-hole upsert = durable per hole; chip keeps
  surfacing for still-unmapped holes; re-enter starts at first unmapped hole.
- **(e) 9 vs 18 + re-edit.** Iterate `teeHoles` (never hardcode 18); drafts
  seed from existing overrides → "Keep & next" skips correct holes; upsert
  overwrites cleanly; v1 `aim:null` clears stored aim (none exist — PR note).

## 6. Device checklist for Matt (post-build)

- [ ] Bayonne: chip visible; map all 18 (or a few + quit); hero FROM TEE
      matches the drawn line afterward.
- [ ] Accurate course: NO chip; pencil glyph only, unobtrusive.
- [ ] Mid-course quit + reload: mapped holes stay exact, unmapped unchanged.
- [ ] Offline/failed PUT: hole stays open, retry works, no lost pins.
- [ ] Re-edit a mapped course: existing pins shown; Keep & next skips.
- [ ] Normal (non-edit) EE: pixel-identical to pre-editor behavior.
