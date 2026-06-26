---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, handicap, course-handicap, match-scoring, build-spec]
---

# The Match — Course Handicap for match strokes

*Build-ready spec. 2026-06-25. The final rating-correctness piece: net strokes off a slope-based Course Handicap, not the raw index — so gender + slope flow into match results.*

## 1. The gap (verified)

Match net strokes are allocated from the **raw handicap index**: `netStrokes(p) = floor(|index| × allowance/100)`, distributed by hole stroke index (`LiveOuting.jsx`). WHS-correct net play uses each player's **Course Handicap** = `Index × Slope/113 + (Course Rating − Par)` — which is where slope and (via the gender-correct ratings we just shipped) gender actually change the strokes a player gets.

**Recon facts:** there are **two** client net-stroke implementations — `netStrokes` (~L2141) and an inline scoreboard mirror (~L1324) — both using `parseFloat(p.handicap)`. The live-outing GET (`outings.js` L30) does **not** return `course_rating`/`slope_rating` (they're stored on `tm_outings` but not selected), so the client can't see them yet. Net math is client-side; the server returns the raw index.

## 2. Safety properties (why this is bounded)

- **NET-mode only.** Strokes apply only when the user flips the leaderboard to NET (opt-in); GROSS play is untouched.
- **Graceful fallback.** No valid slope/rating/par on the outing → fall back to the raw index (today's behaviour). Unrated/free outings are unchanged.
- **Single shared helper.** One pure `courseHandicap()` used by BOTH net-stroke spots, so they can't diverge.

## 3. The math (verify-don't-claim)

WHS Course Handicap = `Index × (Slope / 113) + (Course Rating − Par)`. We return it as a float and let the existing allowance×floor pipeline finish (keeps current rounding behaviour; substitutes CH for the raw index). Pure-WHS rounds CH to an integer before allowance — a minor nuance we intentionally don't change to avoid disturbing the existing pipeline.

## 4. Slices

### Slice 1 — `courseHandicap` helper (new pure lib + tests)
`courseHandicap(index, { slope, rating, par })` → `index × slope/113 + (rating − par)` when slope>0 + rating + par are finite; else `index` (fallback). Node assertions: slope 113 + CR=Par → ≈ index; high slope → more strokes; unrated → raw index; gender ratings (men's vs women's CR) → different CH.

### Slice 2 — expose ratings + wire both spots
- Server: add `course_rating, slope_rating` to the live-outing GET SELECT + response map.
- Client: convert `effectiveHandicap`'s index via `courseHandicap(index, outingRatings)` in `netStrokes`, and apply the same in the inline scoreboard mirror. Read `outing.course_rating/slope_rating/course_par`.
→ verify: build+lint; the two spots produce identical strokes for the same player; unrated outing falls back to today's numbers.

### Slice 3 — verify, audit, ship; flag caveats.

## 5. Risk register

| # | Risk | Sev | Mitigation |
|---|---|:--:|---|
| M1 | **Changes who wins NET matches** | 🔴 | NET-mode opt-in only; graceful fallback for unrated; tested math; **flagged — Matt verifies on a real net match** |
| M2 | **Two implementations diverge** | 🔴 | Single shared `courseHandicap()` helper used by both |
| M3 | **Mixed-gender match uses one rating** — the outing stores one tee rating (the picker's gender), so the other-gender player's CH uses the wrong gender's rating | 🟡 | Strict improvement over raw-index for everyone (slope-adjusted); full per-player gender ratings need storing/fetching both — **flagged follow-up** |
| M4 | **Rounding nuance** (WHS rounds CH before allowance) | 🟢 | Keep existing allowance×floor pipeline; documented; sub-1-stroke effect |
| M5 | **Outing lacks ratings client-side** | 🟡 | Slice 2 exposes them; fallback if still absent |

## 6. Deferred (flagged)
- **Per-player gender ratings for mixed matches** — store/fetch each player's gender CR/SR for the tee (the full-correctness version).
- **WHS CH integer-rounding before allowance** — if we want strict WHS rounding.

*Sources: `LiveOuting.jsx` (netStrokes L2141, inline mirror L1324, strokeHolesForPlayer L971), `outings.js` (GET L30, captured ratings L395), WHS Course Handicap formula.*
