---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, handicap, gender, mixed-match, build-spec]
---

# The Match — Per-player gender ratings for mixed matches

*Build-ready spec. 2026-06-25. Completes gender-correct handicapping: in a mixed-gender match, each player's Course Handicap uses THEIR gender's tee rating, not one rating for everyone.*

## 1. Gap (verified)

Course Handicap net strokes (shipped earlier today) use the outing's **single** captured rating (the picker's gender). A mixed group (couple, mixed foursome — common in friend golf) applies that one rating to everyone → other-gender players get slightly wrong strokes, changing who wins. Verified: participant SELECTs (`outings.js` L52, L699) carry `handicap`/`avatar` but **no gender**; the outing stores one `course_rating`/`slope_rating`.

## 2. Design

- **Store both genders' ratings** for the picked physical tee on the outing: `tee_ratings JSONB = { male:{cr,sr}, female:{cr,sr} }` (migration 031). Keep the existing single `course_rating`/`slope_rating` (picker's gender) for backward-compat + the round differential.
- **Capture both at match-create**: in `CoursePicker.selectTee`, look up the male + female versions of the selected tee (match by `total_yards`) from `openCourse.tees`, build `tee_ratings`, pass through.
- **Each player carries gender**: add `u.gender` to the participant SELECTs.
- **Per-player rating, centralized**: a shared `playerTeeRatings(gender, meta)` in `handicapClient.js` → the player's-gender `{slope, rating, par}`, falling back to the single rating then nothing. Net math (both `netStrokes` + the `MatchScoreboard` mirror) uses it, so they stay in lockstep.

## 3. Slices

### Slice 1 — store + capture
Migration 031 (`tee_ratings JSONB`, applied by hand). CoursePicker builds `tee_ratings` from both genders of the selected tee → onPick → create payload → outing-create INSERT stores it.
→ verify: migration applied; a created match row has tee_ratings; node --check.

### Slice 2 — expose + per-player net math
Live-outing GET returns `tee_ratings` + `u.gender` on participants. `playerTeeRatings()` helper (tested). `netStrokes` + the scoreboard mirror compute Course Handicap from each player's gender rating.
→ verify: node assertions (male→men's, female→women's, missing gender→fallback); build+lint; both spots identical.

### Slice 3 — verify, audit, ship. Flag: verify on a real MIXED net match.

## 4. Risk register

| # | Risk | Sev | Mitigation |
|---|---|:--:|---|
| P1 | **Changes mixed-match results** | 🟡 | This is the correctness FIX (was wrong before); NET-mode only; same-gender matches unchanged; flagged for real-match verify |
| P2 | **Old matches lack tee_ratings** | 🟢 | Fallback to the single course_rating/slope_rating = today's behaviour |
| P3 | **Tee match by total_yards wrong** (two tees same yards) | 🟢 | Rare; falls back to single rating; physical tees rarely share exact yards across genders incorrectly |
| P4 | **Two net-stroke spots diverge** | 🔴 | Single shared `playerTeeRatings()` helper used by both |
| P5 | **Participant gender missing** (unset) | 🟢 | playerTeeRatings falls back to the single rating; no crash |
| P6 | **Migration** | 🟢 | `ADD COLUMN IF NOT EXISTS tee_ratings JSONB`, nullable, append-only, applied by hand + verified |

## 5. Checklist
- ☑ Recon (participant SELECTs, capture/INSERT, schema)
- ◐ Spec · ☐ audit · ☐ Slice 1 store+capture · ☐ Slice 2 expose+net math · ☐ verify+ship

## 6. Deferred
- Per-player Course Handicap **transparency UI** (show each player their CH) — valuable, lighter follow-up.
- Per-gender round differential capture (the INDEX, not match strokes) — each player's round should capture their gender rating; separate.

*Sources: `outings.js` (participant SELECTs L52/L699, create INSERT L392), `CreateWizard.jsx` CoursePicker, `LiveOuting.jsx` netStrokes + MatchScoreboard, `handicapClient.js`.*
