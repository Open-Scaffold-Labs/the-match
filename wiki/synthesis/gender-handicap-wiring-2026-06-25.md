---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, handicap, gender, ratings, build-spec]
---

# The Match — Wiring gender into handicapping correctly

*Build-ready spec. 2026-06-25. Follows the gender-field foundation. Matt: "no point having genders if they aren't correctly wired."*

## 1. The two real gaps (verified this session)

1. **Tee rating selection is gender-blind.** The course API already returns gender-split tees — `tees: { male:[…], female:[…] }`, each with its OWN `course_rating`/`slope_rating` (verified `routes/courses.js`). But `dedupeTees` (`lib/tees.js`) iterates **male first** and drops the female duplicate of any shared physical tee → a woman picking that tee captures the **men's** rating/slope. Wrong, and it's the rating that flows onto her rounds.
2. **Ratings don't affect the index at all yet.** `handicap.js` has `USE_USGA_DIFFERENTIAL = false`, forcing the **par-based** differential (`score − par`) for every round — so `course_rating`/`slope_rating` (hence gender) never touch the index. The USGA path exists but is gated off ("flip once paid-tier is wired").

**Net:** gender currently cannot change any handicap number. To wire it correctly we must (a) capture the gender-correct rating, and (b) actually use ratings.

*(Out of scope, flagged: match strokes use the raw index + per-hole stroke index + allowance — not a slope-based Course Handicap. Implementing Course Handicap = Index × Slope/113 + (CR − Par) for match strokes is a separate, bigger change.)*

## 2. The math (verify-don't-claim)

- WHS/USGA score differential = `(113 / Slope) × (AGS − Course Rating)` — the code's `(total − rating) × 113 / slope` matches (PCC ignored, acceptable for v1).
- Course/Slope Rating are **published per gender per tee** — using the player's-gender rating is the correct, required behavior.
- Index = best 8 of last 20 differentials × 0.96 — unchanged.

## 3. Slices

### Slice 1 — gender-aware `dedupeTees` + callers
`dedupeTees(teesObj, gender='male')`: take the player's-gender list as primary (keep its ratings, no suffix), append the other gender's tees that have no same physical match (suffixed). Default `'male'` = today's behavior, so null-gender users are unchanged. Pass `user.gender` at all 3 call sites — **CreateWizard** (capture-critical: its tee feeds the match → rounds), EagleEye course picker, NewTeeTimeSheet.
→ **verify:** node assertions — female gender yields female ratings for a shared tee; male/null unchanged; gender-only forward tees still surface.

### Slice 2 — use ratings in the index (`handicap.js`)
`differentialFor`: use the USGA differential whenever the round has a valid `course_rating` + `slope_rating`; else par-based fallback (unrated/free rounds). Retire the global `USE_USGA_DIFFERENTIAL` kill-switch gate (it forced par-based even for rated rounds). **Behavior change — flagged:** users with rated rounds switch from par-based to USGA-method differentials; their index recalculates to the correct method. Unrated rounds unaffected.
→ **verify:** node assertions — rated round → USGA differential; unrated → par fallback; gender-correct rating produces the gender-correct differential.

### Slice 3 — verify, audit, ship
build+lint+`node --check`+tests → deploy → spot-verify → audit-before-claim → commit per slice → push → wrap.

## 4. Risk register

| # | Risk | Sev | Mitigation |
|---|---|:--:|---|
| H1 | **Index shifts for existing users** when USGA turns on | 🟡 | Only rated rounds change; par fallback intact; reversible (small diff); flagged prominently to Matt |
| H2 | **Existing rounds captured men's rating for a woman** → her old rated differentials use men's CR | 🟡 | Going forward (Slice 1) is correct; can't retro-fix old captures without re-deriving; documented |
| H3 | **Gender unset (null)** | 🟢 | dedupeTees defaults to 'male' = today's behavior; nothing breaks until a player sets gender |
| H4 | **Mixed differential types in best-8** (some USGA, some par) | 🟢 | This is the existing graceful-degradation design intent (rated→USGA, unrated→par) |
| H5 | **Caller lacks `user.gender` in scope** | 🟡 | Verify each of the 3 call sites has the user; fall back to 'male' default if not |
| C1 | server-only-in-client / lint | 🟡 | `node --check` server + client lint/build gates |

## 5. Checklist
- ☑ Recon (handicap.js, dedupeTees, courses tee data, outings strokes)
- ◐ Spec + risk (this doc) · ☐ audit
- ☐ Slice 1 — gender-aware dedupeTees + 3 callers + tests
- ☐ Slice 2 — USGA differential for rated rounds + tests
- ☐ Verify, audit, ship, wrap

## 6. Deferred (flagged)
- **Course Handicap (slope-based) for match strokes** — proper Index×Slope/113+(CR−Par) stroke allocation; bigger change to match scoring.
- **Retro-fix old rounds' captured ratings** — only matters once USGA is on for historical rated rounds.

*Sources: `server/src/lib/handicap.js`, `server/src/routes/courses.js` (gender-split tees), `client/src/lib/tees.js`, `server/src/routes/outings.js` (strokes use raw index), USGA/WHS differential formula.*
