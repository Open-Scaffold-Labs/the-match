---
type: synthesis
created: 2026-07-20
updated: 2026-07-20
tags: [rollup, notebooklm]
---

# Shipped Specs Rollup (June–early July 2026)

> Fifteen build specs/plans whose features are LIVE on the beta — historical record of the June/early-July build wave (handicap accuracy wave, plays-like, club arcs, range rings, putt capture, EE tokenization + superseded EE plans, SG map-tap lineage).
> Rolled up 2026-07-20 (50-source cap prune, Matt-approved). The individual
> pages remain in wiki/synthesis/ (git + Obsidian); ONLY this concatenation
> occupies a NotebookLM slot. If any rolled page is edited, REGENERATE this
> file (same concatenation order) and refresh — the originals are in the
> manifest's exclude_paths and will not sync individually.


============================================================================
=== SOURCE PAGE: course-handicap-match-strokes-2026-06-25.md
============================================================================

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


============================================================================
=== SOURCE PAGE: gender-handicap-wiring-2026-06-25.md
============================================================================

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


============================================================================
=== SOURCE PAGE: handicap-accuracy-audit-2026-06-25.md
============================================================================

---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, handicap, whs, audit, accuracy]
---

# The Match — Handicap accuracy audit vs the World Handicap System (WHS)

*2026-06-25. Audits our handicap math (`server/src/lib/handicap.js` + the Course Handicap work) against the authoritative WHS standard (USGA + R&A Rules of Handicapping, 2024 revision), which is what the major golf apps implement. Research sourced this session.*

## Verdict

Our index is **systematically wrong** in a few specific, fixable ways — most importantly an **obsolete ×0.96 multiplier** WHS removed in 2020, and a **missing sliding table** for players with <20 scores. The Course Handicap formula we shipped today is **correct** (2024 form). Below: every rule, our status, the fix.

## Gap table

| # | WHS rule | Our code | Status | Fix tier |
|---|---|---|---|---|
| 1 | **No ×0.96 multiplier** (removed 2020; 8-of-20 replaced "bonus for excellence") | `…× 0.96` in `computeHandicapFromRounds` | 🔴 **WRONG** — understates every index ~4% | 1 |
| 2 | **Sliding table**: 3→best1(−2.0), 4→best1(−1.0), 5→best1, 6→best2(−1.0), 7–8→best2, 9–11→best3, 12–14→best4, 15–16→best5, 17–18→best6, 19→best7, 20→best8 | Always "best 8 of 20" (or fewer) | 🔴 **WRONG** for <20 scores (and no −2.0/−1.0 low-count adjustments) | 1 |
| 3 | **Score Differential** `(113/Slope)×(AGS − CR − PCC)`, each rounded to 0.1 | `(total−rating)×113/slope`, not rounded per-differential | 🟡 PCC=0 OK (standard); but no per-diff 0.1 rounding; uses raw total not AGS | 1 (rounding) / 2 (AGS) |
| 4 | **Adjusted Gross Score**: each hole capped at **net double bogey** (par+2+strokes); **par+5** before an established index | Raw `total`, no per-hole cap | 🔴 **Missing** — inflates differentials for blow-up holes | 2 |
| 5 | **Min scores**: index after **54 holes** (table starts at 3 differentials) | Requires **5** completed rounds before displacing the seed | 🟡 Too strict (should be 3) | 1 |
| 6 | **Max Index 54.0** | No clamp | 🟡 Missing clamp | 1 |
| 7 | **Soft cap** (>3.0 over 365-day Low HI → excess ×50%) + **hard cap** (max +5.0) | None | 🟡 Missing (needs persisted 365-day low) | 3 |
| 8 | **9-hole**: 9-hole differential + Index-based expected-9 → one 18-hole differential | Treats `scores.length≥9` as a round; computes an 18-style differential on a 9-hole total | 🔴 Wrong for 9-hole | 3 |
| 9 | **Course Handicap** `HI×Slope/113 + (CR−Par)`, round to whole for play | Implemented today (float, unrounded into allowance) | 🟢 **Correct** (2024 form) | — |
| 10 | **Playing Handicap** = unrounded CH × allowance%, **rounded** (not floored). Allowances: singles match 100%, stroke 95%, 4-ball match 90% | Match net strokes `Math.floor(mag)`; allowance default 100% | 🟡 Floors instead of rounds; per-format allowance defaults not enforced | 1 (round) / 3 (defaults) |
| 11 | **Match-play allocation** (low to scratch, others get the difference, by SI) | Per-player strokes by SI (each vs scratch) | 🟡 Close; stroke-net style, not strictly low-relative match-play (acceptable for net leaderboards) | 3 |

## Fix plan (tiered)

**Tier 1 — clear, high-impact, bounded (build now, `handicap.js` + the match round):**
- Remove `×0.96`.
- Implement the **sliding table** (best-N + the −2.0/−1.0 adjustments at 3/4/6).
- Per-differential **round to 0.1**; **clamp index to 54.0**.
- **Min scores → 3** (was 5).
- Match playing handicap: **round, not floor**.
→ each with node assertions against worked WHS examples.

**Tier 2 — Adjusted Gross Score / net double bogey — ✅ SHIPPED (`2f171c0`):**
- Each hole capped at net double bogey (par+2+strokes; par+5 pre-establishment) before the differential. Pure `strokesOnHole`/`netDoubleBogey`/`adjustedGrossScore` (15 assertions). Wired via `roundDifferential` using the player's current Index for stroke allocation + per-hole data (round/outing pars; outing stroke index; **solo rounds default SI to 1..18** — flagged, capturing real SI on solo rounds is a precision follow-up). `stats.js` aligned so the displayed index matches the persisted one. 18 assertions incl. an integration proof. No migration (reuses existing columns).

**Tier 3:**
- **Soft/hard caps — ✅ SHIPPED (`9d0c1c9`):** migration 032 `tm_handicap_history` persists each index revision; Low HI = MIN over trailing 365 days; `applyHandicapCaps` (soft >3.0→50%, hard +5.0) applied after 20 scores. `stats.js` now reads the persisted index (single source of truth — no divergent recompute). 10 caps assertions; WHS+AGS regression green.
- **Per-format allowance — ✅ SHIPPED (`730be0d`):** `whsAllowance(formats)` (Appendix C: singles match 100, four-ball match 90, four-ball stroke 85, individual stroke/Stableford 95) surfaced as a ★ recommendation on the CreateWizard picker; corrected the labels (it had called 90% "singles match" — wrong; singles match is 100%).
- ✅ **9-hole rounds — fully handled via the WHS 2024 expected-score method (H.6, `6e85608`).** Matt asked the right question: *what happens to a handicap after a 9-hole round?* Tracing it exposed a real bug: 9-hole rounds ARE creatable and passed `isRoundCompleted`, and the differential compared a ~9-hole gross against the 18-hole Course Rating (→ a hugely **negative** differential that **crashed** the Index) or the 9-hole par (→ too-low, dragging it down). First fix (do-no-harm) excluded them. **Then built the real thing — they now COUNT (Matt: don't defer what can be built now):** a 9-hole round converts to one 18-hole Score Differential via WHS Rule 5.1b — `18-hole diff = 9-hole diff + expectedNine(HI)`. Expected-9 is the HI-keyed table approximated by a line fit anchored to the published USGA example (HI 14.0 → 8.5), isolated in two retunable constants (`EXPECTED9_SLOPE`/`EXPECTED9_CONST`). 9-hole CR estimated as ½·(18-hole CR) since the feed exposes only 18-hole ratings; slope unchanged (113-centred ratio). Net-double-bogey AGS allocated with the 9-hole Course Handicap (HI/2 form). Held (null) until an index is established, per WHS. `expectedNineDifferential` + `nineHoleDifferential` exported; `roundDifferential` routes 9-hole rounds there; `computeHandicapFromRounds` preserves null so they don't count pre-establishment. 11 assertions (expected-9 anchor, conversion sanity, held-then-counts, solo-SI parity). **No remaining 9-hole data dependency** — the only labelled estimate is the proprietary GHIN expected-score table, which no standalone app can be exact on.
- ✅ **Solo-round Stroke Index capture — SHIPPED (2026-06-26).** Matt: *"solo rounds need to function exactly the same as any other round — i dont understand why they are currently different?"* — correct. Tracing showed solo rounds were degraded **twice**: the POST hardcoded `courseRating: null, slopeRating: null` (forcing the par-only differential, not the USGA one) AND never captured per-hole Stroke Index (so AGS net-double-bogey fell back to a synthetic 1..18). The CoursePicker already hands back `courseRating`/`slopeRating`/`holeHandicaps` (CreateWizard uses all three) — ActiveRound was simply dropping them. **Fix:** thread all three through `SetupSheet.handleStart` → `config` → the `/api/rounds` POST; migration **033** adds `tm_rounds.hole_handicaps`; `rounds.js` validates (1..18) + stores it; the handicap query now `COALESCE(r.hole_handicaps, o.hole_handicaps)`. A solo round on a rated course now computes the **identical** USGA Score Differential + real-SI net-double-bogey as an outing round. (Impact: solo handicaps on rated courses shift from the par-fallback to the proper USGA value — more accurate, matching outing rounds.)

## Honest scope note
PCC and the soft/hard caps genuinely need data a standalone app doesn't have (the field's same-day scores; a persisted year of index history). The consumer-app norm — and what we'll do — is: implement everything else faithfully, **set PCC = 0** (correct on most days), and **label the index an estimate** (only an authorized association issues an official handicap). Tier 1 + Tier 2 gets us to a value that matches an official index for the large majority of golfers within ~0.1–0.2.

## Impact flag
Tier 1 **raises most players' indexes** (removing the 0.96 alone adds ~4%) and corrects low-score-count indexes. This changes displayed handicaps — and, via Course Handicap, match net results. It makes us *correct* (matching the major apps), but it's a visible change to flag.

*Sources: USGA + R&A Rules of Handicapping (2024) — Rules 3.1, 5.1a, 5.2, 5.3, 5.6, 5.7, 5.8, 6.1, App. C; USGA 2020 Change Summary (0.96 removed); USGA 2024 changes (CR−Par in Course Handicap). Researched this session; competitors referenced generically.*


============================================================================
=== SOURCE PAGE: per-player-gender-ratings-2026-06-25.md
============================================================================

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


============================================================================
=== SOURCE PAGE: player-data-foundation-2026-06-25.md
============================================================================

---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, profile, gender, club-distances, foundation, build-spec]
---

# The Match — Player-Data Foundation: gender field + effortless distance entry

*Build-ready spec. Prepared 2026-06-25. Triggered by Matt: a national-scale golf app needs real player attributes, not workarounds. Two pieces — a proper gender/tee-gender field, and a frictionless club-distance entry flow (now that the own-club arcs depend ONLY on entered distances).*

> **The bar:** biggest golf app in the country — usability, accuracy, visual flow. Verify, don't claim. No guessing of player data.

---

## 1. Why this matters

- **Gender** isn't cosmetic: it drives correct **tee handling** (men's vs women's tees → different yardages), **course/slope rating + handicap math**, and women's-appropriate defaults. Getting it wrong is the kind of error a serious golfer notices immediately. Today there is **no gender field** (verified — `tm_users` has id/email/name/pin_hash/role/handicap + later-added avatar/handicap/home_course/bio; no gender anywhere in client or schema). We worked around its absence in 3.3; the right fix is to add it.
- **Distance entry**: the 3.3 arcs now use **only the player's entered `avg_yards`** (handicap guessing was removed). So the feature is empty until the player fills their bag — making entry effortless and actively prompting it is the unlock.

---

## 2. Grounded facts (verified this session)

- `tm_users` columns confirmed (migration 001 + later adds): no gender. Column-add pattern exists (003/004/012 used `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- `USER_PUBLIC_COLUMNS` (`server/src/lib/user.js`) is the **single source** of what the user object returns — `/api/auth/me`, `middleware/auth`, and `profile` GET/update all `SELECT … RETURNING ${USER_PUBLIC_COLUMNS}`. Adding `gender` here propagates it everywhere the `user` object is read (incl. the EagleEye `user` prop).
- `POST /api/profile/update` destructures `{ home_course, bio, handicap, name }` and updates via `COALESCE`. Gender slots in identically.
- UI: profile edit = `SettingsModal.jsx`; onboarding = `OnboardingWizard.jsx` (+ `onboarding_steps` JSON, migration 012); bag entry = `MyBag.jsx`. The Eagle Eye ARCS empty state already opens the bag sheet (shipped 3.3 correction).

---

## 3. Slice sequence — each ships independently, builds+lints+checks clean

### Slice 1 — Gender on the data model (migration + server)
- Migration `030_tm_users_gender.sql`: `ALTER TABLE tm_users ADD COLUMN IF NOT EXISTS gender TEXT;` (nullable — never required; values constrained in the app to `'male' | 'female'`, room for more later). Append-only; **applied by hand via `psql` (Claude has access, mirrors 029).**
- Add `'gender'` to `USER_PUBLIC_COLUMNS`.
- `profile/update`: accept `gender`, validate against an allowlist (`male`/`female`/null — ignore anything else), update via the same `COALESCE`-style guard so omitting it never wipes it.
→ **verify:** migration applied (column exists); `node --check`; curl `profile/update` sets + returns gender; invalid value rejected/ignored; omitting gender preserves it.

### Slice 2 — Gender control in profile (`Home.jsx` profile-edit form)
*(Audit correction: the profile edit — handicap/bio/name — lives in `Home.jsx` ~L2303 calling `post('/api/profile/update')`, not SettingsModal. `SettingsModal` handles account/delete.)*
- A clean segmented control (Male / Female) in the profile edit, reading `user.gender`, saving via `profile/update`. Optional, with a neutral unset state. Tokens, ≥44px targets, tabular-nums n/a.
→ **verify:** renders current value; change persists + reflects in the returned user; build+lint.

### Slice 3 — Gender in onboarding (`OnboardingWizard.jsx`)
- Collect gender at the appropriate onboarding step (it already collects handicap + first club). Keep it skippable (not a hard gate) — never block onboarding on it. Persist via the same route; mark the step in `onboarding_steps` if that pattern is used.
→ **verify:** appears in the flow; selection persists; skipping doesn't break completion; build+lint.

### Slice 4 — Effortless distance entry + prompts (`MyBag.jsx` + Eagle Eye empty state)
- Make entering a club's `avg_yards` frictionless in MyBag (clear numeric entry, sensible keyboard, save-on-blur) and give the **empty/zero-distance state a strong CTA** ("Set your club distances to see your shot zones on the map").
- The ARCS toggle already opens the bag when empty (3.3); ensure that lands on a state that obviously invites entering distances.
→ **verify:** entering a distance persists + immediately powers the arcs; empty state reads as an invitation, not a dead end; build+lint.

**Cross-cutting gates:** `npm build` + ESLint `no-undef` + `node --check` on changed server files → push to beta → reproduce on the real deployed app (Claude-in-Chrome) → audit-before-claim.

---

## 4. Risk register

| # | Risk | Severity | Mitigation |
|---|---|:--:|---|
| G1 | **Migration wipes/locks** | 🔴 | `ADD COLUMN IF NOT EXISTS`, nullable, no default backfill needed; append-only new file; applied narrowly by hand + verified before next slice |
| G2 | **Gender becomes a hard gate** → onboarding friction (a top incumbent complaint pattern) | 🟡 | Optional everywhere; skippable in onboarding; null is a valid state; never block on it |
| G3 | **Invalid/garbage gender value** | 🟡 | Server allowlist (`male`/`female`/null); ignore anything else; client offers only valid choices |
| G4 | **Omitting gender on an unrelated profile save wipes it** | 🔴 | COALESCE/guard so an absent field preserves the stored value (mirror the existing handicap/bio pattern) |
| C1 | **`USER_PUBLIC_COLUMNS` drift** — add in one place, miss another | 🟡 | It's the single shared list; adding `gender` there covers /me + auth + profile uniformly (verified) |
| C2 | **server-only-in-client / id-coerce / api shadowing** | 🟡 | Standing conventions; lint `no-undef` + `node --check`; grep `api.` before new calls |
| P1 | **Privacy** — gender is personal | 🟡 | Optional, minimal storage, only in the user's own profile; no third-party exposure |
| U1 | **Distance entry still feels like a chore** | 🟡 | Frictionless entry + strong prompt; the accurate long game (auto-derive from shots) is the deferred follow-up |
| B1 | **Backward-compat** — existing users have null gender | 🟢 | Null handled gracefully everywhere; tees/behaviour default exactly as today until set |

---

## 5. Progress checklist

> ☐ not started · ◐ in progress · ☑ done

- ☑ Recon (schema, USER_PUBLIC_COLUMNS, profile route, UI components)
- ☑ Spec + risk register (this doc)
- ☑ Audit the plan (audit-before-claim caught the profile-edit-is-in-Home.jsx correction; design-critique on the segmented control)
- ☑ Slice 1 — migration 030 + USER_PUBLIC_COLUMNS + profile route (migration applied + column verified; node --check clean)
- ☑ Slice 2 — gender control in the Home profile-edit form (build+lint clean)
- ☑ Slice 3 — gender folded into the onboarding handicap step (no renumber; build+lint clean)
- ◐ Slice 4 — distance-entry prompts already present (Home "tap to manage distances" + ARCS→bag); deeper UX polish a light follow-up
- ☑ Verified on the deployed app: `/api/auth/me` returns `gender` (null default) — full data path confirmed in prod. Wrap done.

## 6. Deferred (flagged)

- **Auto-derive club distances from tracked shots** (trimmed mean of real strikes) — the zero-effort accurate version; needs shot-tracking infra. The real long-game after this foundation.
- **Gender-aware tee defaults** — once the field exists, wire it into tee selection/defaults (separate slice).
- **Tournament Mode** (USGA legality) — still open from 3.1/3.3.

---

*Sources: codebase recon this session — `migrations/001`, `server/src/lib/user.js` (USER_PUBLIC_COLUMNS), `server/src/routes/profile.js`, `server/src/routes/auth.js`, `SettingsModal.jsx`, `OnboardingWizard.jsx`, `MyBag.jsx`. Migration pattern mirrors 003/004/012/029.*


============================================================================
=== SOURCE PAGE: own-club-arcs-3.3-build-spec-2026-06-25.md
============================================================================

---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, eagle-eye, club-arcs, dispersion, build-spec, phase-3]
---

# The Match — Phase 3.3 Build Spec: Own-Club Distance Arcs (with handicap-seeded empty state)

*Build-ready spec. Prepared 2026-06-25. Companion to `build-plan-bulletproof-2026-06-23.md` and `eagle-eye-premium-plan-2026-06-23.md`. Backed by two competitive-research passes (UX + data/accuracy) run this session.*

> **The bar (Matt):** biggest name in golf apps worldwide — perfected on **usability, accuracy, visual flow.** Verify, don't claim. Build it better than the market, now.
>
> **Competitor-naming rule:** this committed doc refers to rival products **generically only** ("a leading shot-tracking platform," "the consensus-cleanest GPS app," "a mature sensor-based app"). Standards (USGA, Rule 4.3, Trackman as a data source) may be named.

> **⚠ CORRECTION (2026-06-25, Matt) — supersedes the handicap-seeding thesis below.** Handicap does NOT map to how far a player hits each club; seeding distances from it (even anchored to one club) is a guess, and guessing breaks the accuracy promise that is this app's whole point. **We use ONLY the player's own entered bag distances** (`tm_user_clubs.avg_yards`) — far more accurate than any model. When the bag has no distances, the UI **prompts the player to set them** (opens My Bag); it never fabricates. `clubModel.js` was reduced to `realBag()` (entered data only) — the gapping-ratio / handicap-anchor seeding was removed. The "useful on hole 1 via seeding" wedge below is RETRACTED; the real wedge is making real-distance entry effortless + the visualization beautiful + honest. **Foundational follow-up Matt flagged: add a proper gender/tee-gender profile field and strengthen the club-distance entry flow — a top-tier app needs real player attributes, not workarounds.** Sections 1–2 below are kept for history but read them through this correction.

---

## 1. What we're building and why it wins

Draw the player's **own club distances** as honest landing **zones** on the satellite hole — so a glance answers "which of *my* clubs reaches here, from where I'm standing." We already draw a single landing ring for one selected club; 3.3 turns that into the personalized, decluttered, hole-1-useful "bag on the map" that the market half-does and no one nails.

**The competitive landscape (researched this session):** leaders have moved from a single carry arc → personalized shot-dispersion overlays (arcs for tee shots, ovals for approaches) with a draggable target and an expected-score readout. But **no incumbent clears the full triad of honest + uncluttered + premium-on-free**, and every one fails at least one leg loudly:

- The richest dispersion app dumps data on the map as always-on **clutter** (its #1 complaint).
- The polished ones are clean because they're **spare** (front/middle/back only), not because they show your clubs well.
- All of them are **blank until you've tracked 5–10 rounds** — and the ones that guess from 2 manual points guess badly.
- Premium polish (3D, LiDAR, satellite) is **paywalled**; serious caddie features are **subscription/hardware-gated** (~$100–200/yr).

**Our four ownable wedges** (each a documented incumbent failure):

1. **Useful on hole 1, round 1 — via seeded distances.** *No leading app we surveyed seeds club distances from a player's profile;* they're blank until tracked. We seed a full bag — **anchored to the user's one known club** (onboarding collects a first club) and scaled across the bag, with handicap as the fallback scale — shown as clearly "estimated," refining as the user enters real numbers. **Verified this session:** `user.handicap` is on file (migration 001 + onboarding) and `stats.handicap` refines it; **no gender field exists**, which is exactly why anchoring to a real known club (gender-agnostic) is the right seed, not a guessed men/women table. This is the single biggest differentiator.
2. **Calm by default, detail on tap.** The map stays clean; club zones are *summoned* (via the existing BAG view), never always-on clutter. Show only the club(s) that actually bracket the target, not a wall of rings.
3. **Honest zones, not fake-precise arcs.** A landing **band/zone** sized by a dispersion model — never a 1-yard ring that asserts laser precision a GPS amateur shot doesn't have. "~" not decimals, "avg" labelled.
4. **Premium-feeling and free.** No mid-round upsells, no paywall on the core view.

---

## 2. Accuracy model — the data, stated precisely (from research)

**Club distance semantics.** `tm_user_clubs.avg_yards` is a single number per slot with no carry/total split and no sample count. Research is firm that carry ≠ total (roll ranges ~0 yd for wedges to ~20–30 yd for driver) and that the honest map mapping is: **carry → front edge / forced-carry lines; total → resting center / lay-up**. v1 treats `avg_yards` as the **total (resting) distance** — which is what a GPS-derived or user-typed average represents — and places the zone *center* there. Carry-vs-total split (and a firm/soft roll toggle) is **deferred** (§6) and flagged honestly in-UI ("typical landing — total distance").

**Dispersion (how big the zone is).** Amateur scatter is large and grows with distance. Public working model (well-corroborated): **1 SD ≈ 5% of shot distance, 2 SD ≈ 10%**, applied to both depth and width on a full swing; the pattern is an **ellipse**, **skewed short** (amateurs miss short more than long), and **offset** from the aim line for a habitual fade/draw. v1 dispersion: an ellipse with depth semi-axis ≈ `DISP_SD = 5%` of the club distance (1 SD ring), width similar, with a modest short-skew. No measured per-player variance yet (deferred — needs shot-level data), so the zone is a *model estimate* and is labelled as such. Iron-specific widths (Tour ~10 yd, mid-handicap ~20–30 yd) are rules-of-thumb, not single studies — we do not publish precise dispersion figures.

**Default-distance table (the seed).** No official USGA per-club table exists; the de-facto standard is the large tracked-shot datasets (Shot Scope / Arccos / Trackman, consolidated by public charts). The table is a **gapping profile** (relative spacing between clubs), expressed as a ratio to a reference club (7-iron = 1.0): e.g. Driver ≈ 1.53, 3W ≈ 1.40, 5i ≈ 1.10, 7i = 1.00, 9i ≈ 0.88, PW ≈ 0.79, SW ≈ 0.55. The **absolute scale comes from the user's one known club** (anchor): if they have a real 7-iron at 150, the whole bag scales from it — gender-agnostic, captures the player's actual distance profile. **Only when the user has zero clubs** do we fall back to a handicap-scaled absolute baseline (representative 15-HCP 7-iron ≈ 154 yds, scaled by handicap band) — and that fallback is labelled estimated + nudges the user to set one real distance. (Gender isn't stored, so we never guess a men/women table; anchoring sidesteps it.) Full ratios in the seed module — our own compilation from public datasets, no competitor IP.

**Averaging/trust (for when real data flows — mostly deferred).** Best practice: **trimmed mean of clean shots** (drop both tails, exclude near-pin chips), **rolling window**, **stock not best** (amateurs over-club off a remembered best by ~20+ yd), **tiered confidence by sample size** (<5 estimated · 5–9 building · ≥10 confident), always show "based on N shots." Our schema has no per-club sample count today, so v1 shows real-vs-estimated as a binary (entered vs handicap-seeded); the richer confidence ladder is deferred with the shot-tracking work.

**Honesty guardrails (non-negotiable, from research + our standing rule):**
- Never imply laser precision. Whole-yard "~" values; internal ±5 yd honesty budget on any drawn line.
- Draw a **zone, not a point/arc**, for club landing (a crisp arc over-promises).
- Label the number as an **average/typical**, not "your 7-iron."
- Visual confidence scales to data: estimated/seeded → dashed + translucent + "based on your handicap"; entered → solid.
- Keep **plays-like separate** from the arcs (don't fold wind/elevation into the club zone — it launders model error into the number the player trusts most). Plays-like stays the separate badge we shipped in 3.1.

---

## 3. Slice sequence — each ships independently, builds+lints+checks clean, device-verified

### Slice A — Seed + dispersion model (`lib/clubModel.js`, new, pure)
- `CLUB_GAP_RATIOS` — per-slot gapping ratios vs the 7-iron (our compilation), + a handicap→reference-7i baseline for the zero-club fallback.
- `seedBag(realClubs, handicap)` → fills missing slots: **anchor to the user's nearest real club** via the ratios; if no real clubs, scale from the handicap baseline. Every filled slot `{slot, label, yards, estimated:true}`. No gender param (not stored).
- `mergeBag(realClubs, seeded)` → effective bag: real entries win, seeded fills gaps (every gap labelled estimated).
- `dispersionEllipse(yards)` → `{ depthYds, widthYds }` using `DISP_SD` (5%) + short-skew, for the renderer.
- `clubsForTarget(bag, targetYards)` → the 1–2 clubs that bracket the target (declutter selector).
→ **verify:** node assertions — anchoring to a real 7i scales the bag correctly, zero-club falls back to handicap baseline, real overrides seed, dispersion grows with distance, bracket selector picks the neighbours of a target; putter excluded; no-handicap + no-clubs handled without NaN.

### Slice B — Multi-club zone rendering (`HoleMapGL.jsx`)
- Generalise the single `landing` ring into a `bagArcs` source that renders N club zones along the player→aim bearing: an **ellipse** per club (depth/width from the model), highlighted club solid, others faint; estimated clubs dashed/translucent; per-club label ("7i · ~154y", "est"). Reuse `projectByYards` + add an ellipse polygon generator (extend `ringCoords`).
- Declutter: render only the bracket set by default; the full bag only when explicitly in "show all" — never a wall of rings.
- Teardown nulls all new refs (the marker-vanish lesson from the MapLibre work).
- **Design-audit fixes folded in (2026-06-25):** (1) labels sit in a **dark glass chip** (reuse the existing yardage-pill language) for sunlight legibility over bright NAIP — never raw text on satellite; ≥13px, tabular-nums. (2) **Estimated ≠ opacity-only** (WCAG): dashed outline **+** an "est" text tag, not just translucency. (3) **One accent** — bracket club solid gold `#F5E070`, others muted/outline-only; no rainbow. (4) Fill opacity low (~0.18–0.25) so the hole reads through the zone. (5) Zones render **beneath** the aim line / split pills / puck so they never occlude the live readouts. (6) Animate in on summon; reduced-motion aware.
→ **verify (DOM, not screenshots):** correct number of zone features for a target; estimated styling distinct (dashed + tag, not color-only); switching target/club updates; no orphaned layers on course switch.

### Slice C — Wire bag + seeding into Eagle Eye (`EagleEye.jsx`)
- Compute the effective bag = `mergeBag(myBag, seedBag(myBag, user.handicap))` (handicap from `user.handicap`, verified present; `stats.handicap` is a nicer source if already loaded). Anchor to real clubs; handicap baseline only when the bag is empty + a one-tap "set your distances" nudge — never show nothing.
- Drive the bag-arcs view from the existing BAG toggle / BagSheet (calm default; arcs summoned). Keep the current single-club ring behaviour reachable.
- Surface the "estimated — refines as you set your distances" affordance (no mention of gender; anchored to the user's own club).
→ **verify:** seeded bag shows for an empty/sparse-bag user; real clubs override; arcs declutter to the bracket; distance never blocks.

### Slice D — App-wide tabular-nums sweep — **NOT NEEDED (verify-before-claim catch)**
- Investigated before touching anything: `tokens.css:139` already applies `font-variant-numeric: tabular-nums` to `body` globally, and a `.tm-nums` utility exists (`tokens.css:309`). So "tabular numerals everywhere" is **already in place** — the premium-plan claim was stale and the 3/58 file count was misleading (the body rule covers the rest). A redundant sweep would only add churn. **Skipped, by evidence.**

### Slice E — Verify, audit, ship
`build`+`lint`+`node --check` → reproduce on the **real deployed app** (Claude-in-Chrome, loaded course) → audit-before-claim + design-critique → commit per slice → push → end-of-session wrap (log, trust anchors, notebooklm `verify_failed:0`, preflight).

---

## 4. Risk register — what could go wrong, and the built-in mitigation

| # | Risk | Severity | Mitigation |
|---|---|:--:|---|
| D1 | **Map clutter** — 14 rings/zones bury the hole (the market's #1 complaint) | 🔴 | Declutter to the 1–2 bracket clubs by default; arcs summoned via BAG, never always-on; "show all" is opt-in |
| A1 | **Fake precision** — a crisp arc implies laser accuracy GPS doesn't have | 🔴 | Draw a **zone** sized by the dispersion model; "~" whole yards; "typical/avg" label; ±5 yd honesty budget |
| A2 | **Biased/garbage distances** seeded wrong → "the app is wrong" reviews | 🔴 | Seed from researched skill-anchored table, scaled to a known club; clearly "estimated"; user can edit any club (top incumbent complaint is refusing edits) |
| A3 | **Carry vs total conflation** misplaces zones by up to a driver's roll | 🟡 | Treat `avg_yards` as total → zone center; label "total/typical landing"; carry split deferred + flagged, not faked |
| A4 | **Dispersion over/under-stated** (no per-player variance yet) | 🟡 | Model-based estimate labelled as such; conservative `DISP_SD`; real-variance deferred to shot-tracking; never publish precise figures |
| A5 | **Stale averages** drift with season/gear/age | 🟡 | v1 uses entered values as-is; flag freshness later; rolling-window/trimmed-mean methodology documented for the shot-tracking phase |
| L1 | **USGA legality** — plays-like + club recs are non-conforming in competition (Rule 4.3 / MLR G-5) | 🟡 | **Flagged for a Tournament-Mode follow-up** (disables plays-like + recs); pre-round averages are legal; out of 3.3 build scope but tracked (§6) |
| U1 | **Empty/sparse bag** shows nothing (every competitor's failure) | 🔴 | Handicap-seeded bag → useful hole 1; if no handicap, sane default + "set your distances" nudge; never a blank |
| U2 | **Estimated vs real indistinguishable** → false confidence | 🟡 | Estimated zones dashed/translucent + "based on your handicap"; entered zones solid |
| P1 | **Perf** — many GL layers/labels janks the map over a round | 🟡 | One `bagArcs` source, declutter limits feature count; reuse existing source pattern; no per-frame redraw; null refs on teardown |
| C1 | **Marker/layer leak on course switch** (the prior MapLibre bug) | 🔴 | Null every new ref on teardown; verify no orphaned layers/labels after a switch (DOM check) |
| C2 | **`api.x` / id-coerce / server-only-in-client** repo conventions | 🟡 | Grep `api.` before adding calls; String-coerce id compares; client never imports server-only fns; lint `no-undef` + `node --check` gate |
| V1 | **Visual flow** — zones fight the aim line / split pills / puck | 🟡 | design-critique pass; muted palette, one accent for the bracket club; animate in on summon; reduced-motion aware |

**The three that most decide success:** D1 (clutter — the market's loudest failure), U1/A2 (the empty-state + honest seeding that is our wedge), A1 (zone-not-arc honesty — the accuracy pillar).

---

## 5. Progress checklist

> ☐ not started · ◐ in progress · ☑ done

**Pre-build**
- ☑ Competitive research (UX + data/accuracy) — two agent passes
- ☑ Codebase recon — landing ring, bag model, handicap availability
- ☑ Spec + risk register (this doc)
- ☑ Audit the plan: audit-before-claim (caught the missing gender field → anchor-to-known-club; verified `user.handicap` exists) + design-critique (label chips, dashed+tag estimated state, one accent, opacity, z-order)

**Slice A — model**
- ☐ Default table + `seedBagFromHandicap` + `mergeBag` + `dispersionEllipse` + `clubsForTarget`
- ☐ node assertions green

**Slice B — rendering**
- ☐ `bagArcs` source: multi-club ellipses, highlight/faint/estimated styling, labels
- ☐ declutter to bracket set; teardown nulls refs
- ☐ DOM verification

**Slice C — wiring**
- ☐ effective bag (real + seeded); confirm `user.handicap`; fallback nudge
- ☐ driven by BAG view; estimated affordance; distance never blocks

**Slice D — polish**
- ☐ app-wide tabular-nums sweep + spot-check

**Slice E — ship**
- ☐ build+lint+check; reproduce on real deployed app; audit-before-claim + design-critique
- ☐ commits per slice → push → wrap (log, trust anchors, notebooklm, preflight)

---

## 6. Deferred (flagged, not silently dropped)

- **Tournament Mode** (USGA Rule 4.3 / MLR G-5) — a toggle disabling plays-like + club recommendations for competition legality; affects 3.1 too. Near-term follow-up.
- **Measured dispersion** from shot-history variance (real ovals, not modelled) — needs shot-level tracking + variance calc.
- **Carry vs total split + firm/soft roll toggle** — needs a roll model and/or launch-monitor carry input.
- **Sample-size confidence ladder** (<5 / 5–9 / ≥10, "based on N shots") — needs a per-club shot count in the schema.
- **Draggable target → which clubs cover it** (the premium interaction) — natural next iteration once zones render.

---

*Sources: two competitive-research passes this session (UX patterns + data/accuracy) citing public tracked-shot datasets (Shot Scope, Arccos, Trackman consolidations), strokes-gained/strategy authorities (Broadie, Fawcett/DECADE), USGA Rules 4.3 / MLR G-5 + DMD FAQ, gps.gov accuracy, and shipping-app docs; codebase recon of `tm_user_clubs`, `routes/clubs.js`, `EagleEye.jsx` (ClubToggle/BagSheet), `HoleMapGL.jsx` (landing ring). Competitor products referenced generically per the OpenScaffold naming rule.*


============================================================================
=== SOURCE PAGE: playslike-3.1-build-spec-2026-06-25.md
============================================================================

---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, eagle-eye, plays-like, elevation, build-spec, phase-3]
---

# The Match — Phase 3.1 Build Spec: Transparent, Adjustable Plays-Like (with real DEM elevation)

*Build-ready spec. Prepared 2026-06-25. Companion to `build-plan-bulletproof-2026-06-23.md` (the phased plan) and `eagle-eye-premium-plan-2026-06-23.md` (the design vision).*

> **The bar (Matt, this session):** become the biggest name in golf apps *worldwide*. To get there this feature must be perfected on three axes — **usability, accuracy, visual flow.** Nothing ships that isn't device-verified and audit-clean. Build it better now; don't defer what can be done right.

---

## 1. What we're building (and why it wins)

The single biggest documented gap in the category: the best plays-like science is hidden behind hardware + subscriptions; the best plays-like UX is paywalled. **We ship a transparent, adjustable plays-like as the free default.** Tap the live yardage's "plays like" readout → a glass bottom sheet breaks the number into its causes (wind / elevation / temperature), each labeled with its auto-derived value and each individually overridable. The golfer sees *why* 247 plays as 252, and can correct any factor we got wrong.

Two halves:
- **Transparency** — show the breakdown, not just a total. Trust comes from seeing the work.
- **Adjustability** — let the golfer override any factor (the wind gusted, the pin's cut back). Auto values are labeled "auto"; an override is labeled "manual" with one-tap reset.

The differentiator inside the differentiator: **elevation is auto-derived for real**, from a terrain model (USGS 3DEP, 1 m, verified working 2026-06-25), not a manual guess. Most free apps can't do uphill/downhill at all.

---

## 2. Accuracy model — the math, stated precisely

`computePlaysLike(baseYds, opts)` currently models three additive terms and returns `{ plays, adj }`. We extend it to **return the per-factor split** and **add an elevation-change term**, fully backward-compatible.

| Term | Physical effect | Sign convention | Source |
|---|---|---|---|
| **Wind** | Headwind plays longer, tailwind shorter; crosswind partial via `cos(θ)` where θ = shotBearing − windFromDeg | + headwind / − tailwind | open-meteo `wind_speed_10m`, `wind_direction_10m` |
| **Temperature** | Cold air is denser → ball flies shorter → plays longer | + when colder than 70°F | open-meteo `temperature_2m` |
| **Altitude (ASL)** | Thinner air at altitude → ball flies farther → plays shorter | − at higher ASL | GPS `alt` or barometric from `surface_pressure` |
| **Elevation (NEW)** | Target higher than ball (uphill) → ball must climb → plays longer; downhill shorter | + uphill / − downhill | DEM delta: `targetElevFt − playerElevFt` |

**Critical distinction (not double-counting):** *Altitude (ASL)* is the absolute height where you're playing (Denver vs sea level → air density). *Elevation (NEW)* is the **delta** between target and ball (uphill/downhill ball flight). A Denver uphill shot legitimately gets both: thinner air (shorter) **and** uphill climb (longer). Both terms coexist.

**Elevation magnitude (tunable constant, documented, not over-claimed):** uphill/downhill is applied as `elevation_yds ≈ elevDeltaFt × K_ELEV`. We start with a defensible, conservative constant and expose it as a named constant so it can be tuned against on-course truth. We will **not** advertise a precision figure (per the marketing stance in the bulletproof plan — never publish an error margin, never claim "laser").

**Return shape (new):**
```
{ plays, adj, base, factors: { wind, temp, alt, elevation } }   // each factor rounded yards, signed
```
`plays` and `adj` stay byte-identical to today so nothing downstream breaks.

---

## 3. Slice sequence — each ships independently, builds+lints clean, device-verified before the next

### Slice A — Math foundation (`lib/geo.js` + `EagleEye.jsx` mirror)
Extend `computePlaysLike` in **both** copies (they are an intentional mirror — the `lib/geo.js` header says so; diverging them is a latent bug). Add the elevation term + factor split. Add a small node-run assertion harness covering: headwind > 0, tailwind < 0, crosswind ≈ partial, cold > 0, hot < 0, uphill > 0, downhill < 0, all-zero → adj 0, factor sum ≈ adj.
→ **verify:** `node` runs the assertions green; existing `plays`/`adj` outputs unchanged for the current call sites.

### Slice B — Cached DEM elevation service (server + migration 029)
- Migration `029_tm_elevation_cache.sql`: `(lat_round, lon_round, elevation_ft, source, fetched_at)`, PK on rounded coords. Append-only; apply by hand on Matt's Mac (`psql $DATABASE_URL -f`).
- Server route `GET /api/eagle-eye/elevation?lat=&lon=` (grep first for `api.` namespace collisions): rounds coords to ~5 dp (~1 m), L1 in-memory + L2 Supabase cache (mirrors the OSM-cache pattern from 1.2), provider abstraction `getElevation(lat, lon, { provider })` with `usgs` (EPQS, US, 1 m) default and an `open-meteo` worldwide fallback stub.
- **Validation gate:** reject any out-of-range/sentinel value (EPQS's exact no-data format for ocean/off-grid is **to be confirmed in this slice** — gate on a sane absolute range so it's robust regardless), return `null` elevation rather than a wild number. Elevation is static per coordinate → cache effectively forever.
→ **verify locally:** cold call → row persisted → warm call cache-hit (ms); ocean/non-US coord → graceful `null`, no crash; `node --check` on the route.

### Slice C — Wire elevation into the live model (`EagleEye.jsx`)
- Throttled fetch (like the weather throttle) of **player** elevation (by rounded live position) and **target** elevation (green/aim — same target the distance uses), compute `elevDeltaFt`, feed into `computePlaysLike`.
- **Hard rule:** the distance number and every existing readout must **never block on or break from** elevation. Missing elevation (non-US, no-data, fetch fail) → the elevation factor is simply absent; wind/temp still compute.
→ **verify:** DOM/console (not screenshots — they cache stale per the 6-24 lesson); elevation factor appears for a US course, absent + non-fatal for a fabricated non-US coord.

### Slice D — `PlaysLikeSheet` + tappable HUD chip (`EagleEye.jsx` / new component)
- Replace the 8px `PLAYS` row with a legible, obviously-tappable chip coupled to the hero distance (`PLAYS LIKE 252 ▸`). Always shown on trusted distance + conditions (including the +0 case — a vanishing tap target is a bad tap target).
- Bottom sheet (native-iOS pattern): base yardage → Wind / Elevation / Temp rows. Each row: auto value + "auto" tag; tap to override → slider (temp), stepper (elevation ft), speed + draggable direction dial (wind); overridden rows show "manual" + reset. Footer: **the total plays-like as the sheet's hero** — large tabular numeral, factor rows visually secondary to it.
- **Design-audit fixes folded in (2026-06-25):** (1) **wind dial is shot-relative, not compass-north** — headwind at top (into your face), matching the course-up map + golfer intuition; (2) **"manual" state uses a badge/icon, not color alone** (WCAG — never color-only); (3) reuse the existing PLAYS color tokens (warm `#F0A868` = plays longer / green `#5ED47A` = shorter) so the sheet speaks one language; (4) **no sub-~13 px labels** — the 8 px tell is the thing we're removing; (5) iOS **grabber handle** as the swipe-dismiss affordance.
- Reduced-motion aware (existing pattern), all controls ≥ 44 px, `font-variant-numeric: tabular-nums` on every number, swipe-down + scrim-tap dismiss.
- **Override lifecycle:** overrides reset when the hole changes (a stale manual wind silently corrupting hole 12 is a real trust bug). Active overrides are visually unmistakable while they apply.
→ **verify:** design-critique pass; on Matt's iPhone — open/dismiss feel, legibility in daylight, override + reset, no map occlusion of markers.

### Slice E — Verify, audit, ship
`npm --prefix client run build` + `lint` + `node --check` on changed server files → individual commits per slice → push to `main` (beta) → Matt device-tests → `audit-before-claim` + `design-critique` on the result before "done." End-of-session: `wiki/log.md`, trust-anchor refresh (CLAUDE.md/index.md), `notebooklm-wiki-refresh.py` (`verify_failed: 0`), preflight green.

---

## 4. Risk register — what could go wrong, and the built-in mitigation

Sorted by threat to **accuracy / usability / trust**.

| # | Risk | Severity | Mitigation (built in from the start) |
|---|---|:--:|---|
| A1 | **Elevation sign backwards** (uphill shown as shorter) — destroys trust instantly | 🔴 | Single documented sign convention (`target − player`, + = uphill = longer); unit assertion in Slice A locks it; device sanity check on a known uphill hole |
| A2 | **Unit mismatch** (feet vs yards vs meters) → silent 3× error | 🔴 | EPQS queried in feet explicitly; one conversion point; assertion + a logged worked example |
| A3 | **DEM returns no-data sentinel** for ocean/off-grid/non-US and we render a wild number | 🔴 | Absolute-range validation gate in Slice B → `null`, never a fabricated yardage; non-US drops the term. (Exact EPQS no-data format unconfirmed — gate is range-based so it holds regardless) |
| A4 | **Elevation constant over/under-states** the effect | 🟡 | Conservative tunable `K_ELEV`, documented; no advertised precision; tune against on-course truth post-launch |
| A5 | **Double-counting ASL altitude and elevation delta** | 🟡 | Explicitly separate physical terms (§2); ASL uses absolute height, elevation uses target−player delta |
| P1 | **Querying USGS on every GPS fix** → latency, rate-limit, cost | 🔴 | Throttle + cache by rounded coord (player moves slowly within a hole); target elevation fetched once per hole |
| P2 | **USGS EPQS slow/down** (gov service) blocks the round | 🔴 | Server L2 cache; elevation never blocks the distance; term simply absent on failure; self-recovers |
| P3 | **iOS memory over a 4-hr round** (uncatchable reload) | 🟡 | No new map instances/canvases; sheet is one lightweight DOM node mounted on demand; release on close |
| U1 | **Sheet traps the user / occludes the map mid-round** | 🔴 | Bottom sheet never auto-opens; swipe + scrim dismiss; map stays visible above; markers not occluded (the top-left instrument stays put) |
| U2 | **Sticky overrides silently corrupt later holes** | 🔴 | Overrides reset on hole change; "manual" badge while active; one-tap reset per factor |
| U3 | **Tap target vanishes** when conditions flicker | 🟡 | Chip shown on trusted distance + conditions incl. +0; debounce the conditions presence |
| U4 | **Numbers dance / reflow** as they update | 🟢 | tabular-nums everywhere (existing discipline) |
| U5 | **Touch targets too small / low contrast in sun** | 🟡 | ≥44 px controls; AA contrast at each glass elevation; legibility is a competitive feature here |
| V1 | **Sheet motion janky / not reduced-motion aware** | 🟡 | transform/opacity only, 200 ms ease-out; honor `prefers-reduced-motion` (existing pattern) |
| C1 | **Mirror divergence** — extend one `computePlaysLike`, not both | 🔴 | Slice A edits both copies identically with a cross-reference comment; assertion runs against both |
| C2 | **`api.x` vs `api.x.y()` namespace shadowing** | 🟡 | grep the `api.` surface before adding the elevation call (standing repo convention) |
| C3 | **Server-only fn leaks into client bundle** (the `estimateAltFromPressure` ReferenceError class) | 🔴 | Client fetches elevation via the API only; `lint` `no-undef` + `node --check` gate before push |
| C4 | **Migration edited in place / not applied** | 🟡 | New numbered file 029, append-only; applied by hand on Matt's Mac; db.js schema check updated if needed |
| W1 | **Worldwide ambition vs US-only DEM** — USGS is US-only | 🟡 | Provider abstraction from day one; US = USGS (1 m, matches NAIP launch); non-US = open-meteo DEM (90 m) **stubbed** now, wired when worldwide imagery lands; non-US gracefully shows wind+temp, elevation overridable-manual |
| W2 | **open-meteo elevation contract UNVERIFIED** (timed out 2026-06-25) | 🟡 | Treated as unverified — must confirm contract before wiring the non-US path; not on the US launch path so not a launch blocker |

**The three that most decide success:** A1/A3 (elevation honesty — a wrong or fabricated elevation number is worse than none), U1/U2 (the sheet must never trap the user or silently corrupt later holes), C1/C3 (the boring repo-convention bugs that have bitten this codebase before).

---

## 5. Progress checklist

> ☐ not started · ◐ in progress · ☑ done

**Pre-build**
- ◐ Spec + risk register written (this doc)
- ☐ Audit the plan: `audit-before-claim` over claims + `design-critique` over the sheet design

**Slice A — Math**
- ☐ Extend `computePlaysLike` in `lib/geo.js` (factor split + elevation term)
- ☐ Mirror the change in `EagleEye.jsx` (keep copies identical)
- ☐ node assertion harness green (sign / magnitude / zero / factor-sum)

**Slice B — DEM elevation service**
- ☐ Migration `029_tm_elevation_cache.sql` written + applied by hand
- ☐ `GET /api/eagle-eye/elevation` with USGS provider + validation gate
- ☐ L1 + L2 cache; provider abstraction; open-meteo stub
- ☐ verify cold→DB→warm + graceful null on bad coord

**Slice C — Live wiring**
- ☐ Throttled player + target elevation fetch by rounded coord
- ☐ `elevDeltaFt` fed into `computePlaysLike`; distance never blocks
- ☐ verify via DOM/console (US present, non-US absent + non-fatal)

**Slice D — Sheet + chip**
- ☐ Tappable `PLAYS LIKE ▸` chip replaces the 8px row; always shown on trusted distance+conditions
- ☐ `PlaysLikeSheet`: base → Wind/Elevation/Temp rows, overrides + reset, total
- ☐ Reduced-motion, 44px targets, tabular-nums, swipe/scrim dismiss, overrides reset on hole change
- ☐ design-critique pass + Matt device test

**Slice E — Ship**
- ☐ build + lint + node --check clean
- ☐ audit-before-claim + design-critique on result
- ☐ commits per slice → push to `main` → Matt verifies on iPhone
- ☐ End-of-session: log, trust anchors, notebooklm refresh (`verify_failed:0`), preflight green

**Operational follow-ups (not this slice)**
- ☐ Verify + wire open-meteo worldwide DEM (W2)
- ☐ Tune `K_ELEV` against on-course truth (A4)

---

*Sources: USGS 3DEP / EPQS (verified live 2026-06-25, 1 m, public domain); open-meteo elevation API (UNVERIFIED — timed out, to confirm); existing `computePlaysLike` model in `client/src/lib/geo.js` + `client/src/pages/EagleEye.jsx`; the-match repo conventions (CLAUDE.md); the two companion plan docs in this folder.*


============================================================================
=== SOURCE PAGE: playslike-accuracy-rebuild-2026-06-30.md
============================================================================

---
type: synthesis
created: 2026-06-30
updated: 2026-06-30
tags: [the-match, eagle-eye, plays-like, accuracy, build-spec]
---

# Plays-Like Accuracy Rebuild — sourced coefficients (2026-06-30)

*Trigger: Matt found hole 6 (335 yd) showing "plays like 299 (−36)" — physically absurd. Root cause: the plays-like model was an unvalidated in-house heuristic (`geo.js`, 2026-06-06). This rebuild replaces the coefficients with sourced, physically-defensible values. Research: `plays-like-distance-research.md` + a physics pass (both this session, fully cited).*

## Headline findings
- **No major golf app/rangefinder publishes its plays-like math** (Arccos, 18Birdies, Garmin, Bushnell all proprietary; Garmin calls it "not predictable"). Our transparent per-factor breakdown is therefore a genuine differentiator — we just need the coefficients right.
- The accepted, sourced coefficients (Trackman, Titleist R&D, golf.com/Tutelman, Shot Pattern's June-2026 Trackman-derived model) are clear and below.

## What the old heuristic got wrong → corrected (all sourced)
| Factor | Old | New (sourced) | Source |
|---|---|---|---|
| Wind | symmetric ±1%/mph | **headwind +1.0%/mph, tailwind −0.5%/mph** (~2:1 asymmetry) | Trackman via GolfWRX; Shot Pattern (Trackman-derived) |
| Altitude | 2%/1000 ft | **1.16%/1000 ft** (×0.0116) | Titleist R&D (Aoyama, ×0.00116/ft); Trackman ~1%/1000 ft |
| Temp | 1%/10°F | **0.8%/10°F**, 70°F baseline | Andrew Rice/Trackman (~2 yd/10°F driver) |
| Elevation | 1 yd/3 ft both ways | **uphill 0.33 yd/ft, downhill ×0.67** (asymmetric) | probablegolfinstruction; caddiehq |
| Wind direction | along-shot cosine | unchanged (cosine component); crosswind = aim cue, not distance | aviation component math / golf-alcanada |

## Design decisions (audited)
1. **Additive model, not multiplicative.** The transparency UI (`playsLikeView`) requires the four factors `{wind, temp, alt, elevation}` to **sum** to the total. The research's "rigorous" multiplicative-density model would force an artificial decomposition anyway, and is only meaningfully different from additive at large *stacked* extremes (the temp×alt cross-term is <1 yd at realistic golf conditions). Additive-with-correct-coefficients is the right architecture here, not a shortcut.
2. **Caught a bug in the research agent's sample JS:** its `densityFactor = 1 + (ρ₀/ρ − 1)×0.4` is **inverted** — it makes hot/high (thin) air play *longer*, but thin air → ball flies farther → plays *shorter*. We did NOT implement that. The additive model below has every sign verified by hand.
3. **Sane caps per channel** (App-Store robustness — a bad sensor reading can't produce an absurd number): wind pct ∈ [−30%, +40%], temp ∈ ±10%, alt ∈ ±15%, elevation ∈ ±40 yd.
4. **Plays-like stays on the full tee distance** (Matt: a 335 drive is real). The −36 was the coefficients, not the reference distance.
5. **Temp baseline 70°F** kept (Titleist; Rice uses 75 — both defensible).
6. Mirror copies that must stay identical: **`client/src/lib/geo.js` + `client/src/pages/EagleEye.jsx`** (two copies). The server `routes/eagle-eye.js` is a *separate* LLM camera-analyze feature, out of scope.

## The model (additive; signs verified)
```
per-factor (all scale with baseYds except elevation, which is geometric yards):
  wind:      along = windSpeed·cos(shotBearing−windFromDeg)   // + head, − tail
             pct   = along≥0 ? 0.010·along : 0.005·along       // 1%/mph head, 0.5%/mph tail
             pct   = clamp(pct, −0.30, +0.40)
             wind  = pct · baseYds
  temp:      ((70−tempF)/10) · 0.008 · baseYds,  clamp ±10%·base   // colder → longer
  alt:       −(altFt/1000) · 0.0116 · baseYds,   clamp ±15%·base   // thinner → shorter
  elevation: elevDeltaFt≥0 ? ·(1/3) : ·(1/3)·0.67,  clamp ±40 yd   // uphill longer; downhill ⅔
  adj = wind + temp + alt + elevation
```

## Worked sanity checks (become unit-test assertions)
- 150 yd, 20 mph pure headwind, 70°F: wind +30 → **180** (unchanged; headwind side was already right).
- 150 yd, 20 mph pure tailwind: wind −15 → **135** (was −30; the fix).
- 150 yd, 20 mph crosswind: ~0.
- 150 yd, 50°F: +2 (was +3).
- 150 yd, 5000 ft: −9 (was −15).
- Asymmetry: 20 mph head (+30) ≈ 2× |20 mph tail (−15)|.
- Elevation: +30 ft → +10; −30 ft → −7 (downhill smaller).
- **Hole-6 realism:** 335 yd, 9 mph tailwind, 90°F → wind −15, temp −5 → adj ≈ **−20** (was −36).

## Honest residual
These are sourced rules-of-thumb, not a per-shot trajectory ODE solve. They're calibrated to typical conditions; extreme stacked conditions (high altitude + cold + strong wind) are first-order approximations. Marketing stance unchanged: never advertise a precision figure; the in-app number is a helpful estimate, not a laser. Future upgrade (deferred, not a shortcut-dodge): a true launch-condition trajectory model.

## Refinement 2026-06-30 PM — carry cap (fixes long-distance overstatement)
Follow-up audit (Matt: "still feels off vs other apps") + a second research pass found the shipped model, while calibrated correctly at approach distances (150y/10mph head = +15 = 165, matches Shot Pattern/Trackman exactly), **overstated wind at long/hole distances** because it scaled the %-terms linearly on the full distance (400y @ 15mph head = +60). Physics: wind acts on the **carry** (flight time), which barely grows across the bag (Trackman apex ~30-32y all clubs → similar hang time), so a driver loses the *smallest* % — a flat %-of-distance rule inverts that, and applying it to a whole-hole number is a category error (wind never touches rollout / a second shot).

**Fix (shipped):** `flightYds = min(baseYds, 250)`; wind + temp + altitude scale on `flightYds`, not `baseYds`. Elevation (geometry to target) is uncapped. Approach shots ≤250 are unchanged; long holes stop ballooning (400y/15mph head: +60 → +37.5; hole-6 335y/9mph tail/90°F: −20 → −15). Sourced: no competitor publishes a cap (so this is *more* correct than the market); 250y sits under tour driver carry (~282) and above most amateur carries. Tests: geo.test.mjs 31/31 incl. cap + approach-unchanged assertions.

**Option B — aim-point trigger — SHIPPED 2026-06-30 PM (build-verified; needs on-device confirmation).** When the golfer **drags** the aim point short of the pin (the auto-default aim does NOT count — Matt's call), the **whole readout retargets to that aim**: hero distance = tee/player→aim, plays-like on that (a real shot, so the carry cap rarely binds = full physics), wind bearing + header arrow relative to the aim, elevation refetched to the aim point (same `/api/eagle-eye/elevation` endpoint, cached), label "TO AIM", F/C/B hidden. No user aim ⇒ Option A (to the pin, capped). Wiring: `HoleMapGL` emits `onAimChange({userPlaced, teeAimYds, aimGreenYds, aim})` on default-draw + dragend (not per frame); `EagleEye` holds `aimInfo`, derives `userAim = userPlaced && aimGreenYds > 8`. Gates: eslint 0, build ok, geo 31/31, vitest 24/24. **Not yet behavior-verified on a device** (drag interaction, elevation refetch, F/C/B hide) — Matt to confirm on-course/in-browser. Honest residual: ideal is to scale wind by club/trajectory (high wedge > low driver); carry-cap is the pragmatic minimum-correct version.


============================================================================
=== SOURCE PAGE: range-rings-dispersion-build-spec-2026-07-02.md
============================================================================

---
type: synthesis
created: 2026-07-02
updated: 2026-07-02
tags: [the-match, eagle-eye, range-rings, dispersion, build-spec, phase-2-5, accuracy]
---

# Range-Rings + Club-Arc Dispersion Bands — Bulletproof Build Spec

Closes the two "accuracy refinements on the shipped GPS gate" residuals from the premium
plan: the **held concentric range-rings (2.5)** and **club-arc dispersion bands**. Companion
to `own-club-arcs-3.3-build-spec-2026-06-25.md` (whose dispersion model shipped but was
never wired to the renderer) and `eagle-eye-premium-plan-2026-06-23.md`.

> **North Star:** usability, accuracy, visual flow. This slice's thesis: **honest zones,
> not fake-precise circles** — and rings done the way the market actually validates, not
> the way the 2.5 line item originally imagined them.

---

## 1. What the research changed (agent, 2026-07-02, cited in session log)

The 2.5 rings were "held pending a live-map clutter check." The competitive research
delivered that check's answer:

- **Nobody ships always-on concentric rings from the player.** The market splits into one
  arc for one decision (Garmin driver arc), opt-in fixed **layup arcs to the green**
  (TheGrint GPS 2.0: 100/150/200/250, toolbar-toggled, persisted), and club-anchored arcs
  (GolfLogix/18Birdies/Hole19, premium-gated). Clutter is the #1 vendor-confessed failure.
- **Dispersion leaders (Arccos, Shot Scope/DECADE) render one club's soft cone/zone at a
  time**, from real data where available; crisp boundaries = false precision. 18Birdies
  uses a user-declared accuracy baseline when data is thin.
- Cartography best practice: stroke-only rings, thin dark-halo labels ≥4.5:1, never fill
  ring interiors, feather dispersion edges.

**Decision:** rings ship as **green-anchored layup arcs (100/150/200/250), opt-in via a
persisted RINGS toggle** — the market-validated semantic ("what do I leave myself?") —
NOT player-centered concentric circles. Dispersion ships as **one soft zone at a time**.

## 2. The accuracy bug this fixes

`HoleMapGL.redrawAim()` draws the selected-club landing zone as `ringCoords(landing, 11)`
— a **fixed 11-yard circle**, same for a lob wedge and a driver. Meanwhile
`clubModel.dispersionEllipse()` (1 SD ≈ 5% of distance, short-skew 1.3, 4-yd floor —
sourced in the 3.3 spec) shipped 2026-06-25 and **is not imported by the renderer**. The
zone the user sees today asserts a precision that isn't real and doesn't scale with club.

## 3. Build slices

### S1 — `lib/mapOverlays.js` (new, pure, unit-tested)
- `projectPoint(start, bearingDeg, yards)` (pure copy of the proven local helper —
  additive; does NOT touch geo.js or HoleMapGL math).
- `dispersionZonePolygon(landing, bearingDeg, {depthYds, widthYds, shortSkew})` → ellipse
  ring (48 pts), long axis along the shot line, **short-side semi-axis × shortSkew**
  (amateurs miss short more than long — the zone must extend TOWARD the player).
- `arcBandPolygon(center, bearingDeg, radiusYds, {depthYds, shortSkew}, halfDeg)` →
  annular sector between `radius − depth×skew` (inner) and `radius + depth` (outer) —
  the highlighted club's dispersion band in ARCS mode.
- `layupRingsInPlay(distToGreenYds)` → subset of [100,150,200,250] with ring ≤ dist − 15.
- New test file wired into the client `test` script.
→ verify: node --test — skew extends inward not outward; polygon closes; rings filter
  (par-3 160y + GPS 140 → none in play from player; 435y → all four).

### S2 — `HoleMapGL.jsx` renderer (additive; distance math untouched)
- **Token bridge** (the Phase-4.3 HoleMapGL pattern, established here): `eeColor(name,
  alpha?, fallback)` reads `--tm-ee-*` via `getComputedStyle` at layer-creation (MapLibre
  paint does NOT resolve CSS `var()`). Literal fallbacks so a failed read can never blank
  a layer. New layers only — existing layer literals untouched (no drive-by).
- **Landing zone** → `dispersionZonePolygon` replaces the fixed 11-yd circle; softer
  paint (lower fill opacity + blurred outline, no crisp 2.5px line); label gains the
  honesty tilde: `Driver · ~230y`.
- **ARCS mode**: new `bagArcBand` source/fill under the arc lines — the **highlight club
  only** gets its band (annular sector, feathered edges via low-opacity fill + blurred
  edge lines). Other clubs stay thin lines.
- **Layup rings**: new `rangeRings` source + stroke-only lines (white ≈ raw-distance
  semantic, ~1.5px, low opacity, subtle dark under-glow for fairway legibility) swept
  around the green→player bearing; small dark label chips ("150") at the arc's right end.
  Added below the club layers in z-order. Drawn only when toggled on AND in play.
- Cleanup: new marker refs nulled in the existing unmount block.

### S3 — `EagleEye.jsx` RINGS toggle
- Third pill on the right control rail (above ARCS, same glass style, tokens):
  `RINGS`, `aria-pressed`, persisted `localStorage['tm-eye-rings']`, passed as a prop.
- Default **off** (research: opt-in is the category-correct default; empty map stays clean).

### S4 — Gates + audits + ship
- lint + build + geo.test 31/31 + full `npm test` (incl. new S1 tests) per slice.
- audit-before-claim on all claims; design-critique pass on the rendered overlay specs.
- Wiki log + this spec's checklist + handoff updated; push to `main` (beta).

## 4. Risk register

| # | Risk | Sev | Mitigation |
|---|------|-----|-----------|
| D1 | False precision — crisp zone edge / decimals | 🔴 | Feathered fills, no hard outline, `~` whole yards, zone labeled by club only, never a dispersion figure on screen |
| D2 | Clutter (the market's #1 failure) | 🔴 | One club's band at a time; rings opt-in + persisted OFF; stroke-only rings; ≤4, in-play filtered |
| D3 | Skew rendered the wrong way (zone extends long) | 🟠 | S1 unit test asserts inner > outer extension; geometry pure + testable |
| D4 | MapLibre paint can't resolve CSS var() | 🟠 | `eeColor` getComputedStyle bridge + literal fallbacks (never a blank layer); pattern documented for the Phase-4.3 HoleMapGL slice |
| D5 | Touching load-bearing distance math / teeOffset | 🔴 | Additive only; geo.test 31/31 gate; no edits to redrawAim's yardage lines |
| D6 | Perf regression on drag (per-frame redraw) | 🟡 | Geometry is trivial (≤4×34 + 48 pts/frame); no new timers; sources setData in the existing redraw path |
| D7 | Ring labels collide with arc labels when both on | 🟡 | Ring chips at right arc end (bag labels default left); accepted v1 residual, note for device pass |
| D8 | Marker leaks on course switch | 🟡 | New refs added to the existing null-out cleanup block |
| D9 | Untrusted GPS skews ring bearing | 🟢 | Bearing-only cosmetic use (existing landing-ring pattern); quoted numbers still gated by GPS_ACCURACY_GATE_M |

**Rollback:** each slice its own commit; rings behind the user toggle (default off) are
also a behavioral off-ramp.

## 5. Progress checklist

**Planning**
- [x] Competitor research (agent, cited) — 2026-07-02
- [x] Spec grounding: premium 2.5 hold-reason, 3.3 dispersion model, HoleMapGL pipeline — 2026-07-02
- [x] This spec + risk register
- [x] S1 lib/mapOverlays.js + 6 unit tests (skew-direction asserted — D3 closed) — 2026-07-02
- [x] S2 HoleMapGL renderer (zone, arc band, rings, eeColor token bridge w/ fallbacks) — 2026-07-02
- [x] S3 EagleEye RINGS toggle (persisted `tm-eye-rings`, default off, control rail) — 2026-07-02
- [x] S4 gates green (lint ✓ build ✓ geo 31/31 ✓ tests 10/10 ✓) → design-critique vs the
      research do/don't list (all "do"s ✓ except zoom-declutter = accepted v1 residual;
      zero "don't"s violated) → **SHIPPED `d904347` to `main`** — 2026-07-02
- [x] Self-review catch: `clearAll()` in redrawAim now clears rangeRings + bagArcBand +
      ring chips so nothing survives a hole with missing tee/green data
- [ ] On-device pass (Matt, on the beta): clutter check with ARCS+RINGS both on, band
      reads as a zone not a target, rings legible over bright fairway. Also note: the
      RINGS/ARCS pills share the existing ~33px rail height (below the 44px ideal —
      pre-existing rail convention; revisit in Stage C if it bothers on device).

## 6. Scope guardrails

- No dispersion FIGURES on screen ever (no "±", no yard-width numbers) — standing rule.
- Entered bag data only — no fabricated distances (3.3 correction, Matt).
- No always-on overlays added; default map stays exactly as it is today.
- No edits to distance math, teeOffset, geo.js internals, or existing layer paint.

## Sources
- Agent research report 2026-07-02 (TheGrint GPS 2.0, Garmin manuals, Shot Scope
  MyStrategy, Arccos AI Strategy, 18Birdies dispersion, GolfLogix arcs; cartography:
  Dawson/Peterson/ESRI halo practice) — full cites in session log.
- `own-club-arcs-3.3-build-spec-2026-06-25.md` §dispersion model + risk A1/A4.
- `build-plan-bulletproof-2026-06-23.md` 2.5 hold note; `next-session-handoff-2026-07-02.md`.
- Live reads: `client/src/pages/HoleMapGL.jsx`, `client/src/lib/clubModel.js`.


============================================================================
=== SOURCE PAGE: live-putt-capture-outings-build-spec-2026-07-06.md
============================================================================

---
type: synthesis
created: 2026-07-06
updated: 2026-07-06
tags: [the-match, sg, putt-capture, outings, f5, build-spec]
---

# Live Putt Capture in Outings (self-score only) — Bulletproof Build Spec

Closes the solo/multiplayer parity gap in SG capture: putt chips currently exist only in
the solo scorer (Dale's SG v2, PR #1); outing rounds join the SG dataset post-hoc. This
adds the SAME two-tap capture to live outings — **only when you score yourself** — with
facts stashed on your participant row and carried into your `tm_rounds` record at close.
Sits at the seam of Dale's SG work and the F.5 scoring engine → spec-first, flag to Dale.

> **North Star:** usability (≤3 optional extra taps, never gates the score), accuracy
> (integrity rules, no fake numbers), visual flow (identical chips to solo — one shared
> component, zero drift).

## 1. What the research mandates (agent, 2026-07-06, cited in session log)

- **Same-sheet, expandable, optional-always** is the universal pattern (18Birdies/TheGrint/
  Golfshot); NO app forces stats to advance a hole. Score-only stays one tap.
- **Putt count is the privileged stat** (survives every vendor's trimming); **first-putt
  distance is the enthusiast layer** — optional even when count is entered (SwingU gates it).
- **Self-entered stats win**; TheGrint's notify-on-conflict validates our S2 chip design.
  Golfshot precedent exists for scorekeeper putt-count entry — we deliberately DON'T (Matt:
  nobody enters your putts but you). Post-hoc editor stays prominent (Arccos philosophy) —
  live capture and backfill are complements.
- Buckets/steppers only, never free-text distance mid-round. Tap budget: ≤3 extra.

## 2. Design

**Data:** migration **041** — `tm_outing_participants` gains `putts JSONB`, `first_putts
JSONB` (parallel per-hole arrays, null entries = no data; identical convention to
`tm_rounds` 039). Additive + idempotent (`IF NOT EXISTS`).

**Write path (the wrinkle recon caught):** client routing sends a host/marker scoring
THEMSELVES through `/scores/host`, so "self-only" keys off **writer === target**, never
off the endpoint. Both endpoints accept optional `putts`/`firstPutt` per-hole fields;
`/scores` is inherently self; `/scores/host` applies them **only when `user_id` param ===
`req.user.id`** and silently ignores them otherwise. Facts ride inside the SAME
UPDATE/transaction as the score write — same OCC row, same idempotency claim (putt fields
are in the keyed body → replays are automatically consistent). Invalid putt shapes are
DROPPED, never 400 — optional capture must never break a score write (F.5 prime directive).

**Integrity rules (pure lib `server/src/lib/puttFacts.js`, unit-tested):**
- putt count: int 0–6, and **≤ that hole's score** (same rule as solo's chips); violations → null.
- first-putt bucket: closed set `in3|3-10|10-25|25plus`; stored only when count > 0 (count 0
  = holed out from off the green → no first putt).
- fan-out clean: a later conflict resolution can LOWER a score below an earlier putt count —
  `/end` re-cleans arrays against final scores before insert (`putts[i] > scores[i] → null`).

**Fan-out:** `/end`'s existing `INSERT INTO tm_rounds` gains `putts, first_putts` sourced
from the participant row through the fan-out clean. `ON CONFLICT DO NOTHING` semantics
unchanged (re-end never overwrites; post-hoc editor covers edits).

**Client:** extract solo's inline chips into shared **`components/PuttChips.jsx`** and use
it in BOTH `ActiveRound` and LiveOuting's `ScoreModal` — one component = zero visual drift
(the exact disease the tokenization work cured). Chips render in ScoreModal **only when the
modal's target is the signed-in user**; BulkScoreModal (host entering everyone) gets
nothing. `saveScore` threads `{putts, firstPutt}` into the queued body only on
writer===target; the offline queue + idempotency key flow is untouched (bigger body, same
machinery). No prefill in v1 (matches solo's session-local behavior); the post-hoc editor
remains the correction surface.

## 3. Risk register

| # | Risk | Sev | Mitigation |
|---|------|-----|-----------|
| P1 | Destabilizing F.5 scoring (the headline risk) | 🔴 | Additive columns; facts ride the EXISTING write/tx/idempotency path; invalid putts dropped never 400; zero changes to score/state/conflict/flag logic; full suite + targeted tests |
| P2 | On-behalf putt entry sneaks in (host/marker for others) | 🔴 | writer===target check server-side on BOTH endpoints; client renders chips only for self; BulkScoreModal untouched |
| P3 | Conflict-lowered score < entered putts | 🟠 | fan-out re-clean vs final scores (tested); write-time clean vs current score |
| P4 | Offline replay divergence (putts in one attempt, not the other) | 🟠 | putt fields inside the idempotency-keyed body — replay returns the stored outcome; a new tap = new key (existing S3 contract) |
| P5 | Solo/outing chip drift over time | 🟠 | single shared PuttChips component; ActiveRound refactor is surgical (same state/props) |
| P6 | Guest rows | 🟢 | guests have `user_id NULL` → can never be writer===target; fan-out skips guests already |
| P7 | Slowing group play (research's #1 complaint class) | 🟠 | chips optional, below score, zero new screens/taps for score-only users; score saves regardless |
| P8 | 9-hole / partial arrays index drift | 🟡 | per-hole index writes into sparse arrays (same as scores); clean handles nulls |

**Rollback:** migration is inert if unused; server ignores absent fields; client chips are
an isolated render block — each slice independently revertible.

## 4. Progress checklist

- [x] Competitor research (agent, cited) — 2026-07-06
- [x] Code recon: self-score routing wrinkle (host-self via /scores/host), doSelfWrite tx,
      idempotency body, /end fan-out, ScoreModal/BulkScoreModal split — 2026-07-06
- [x] This spec + risk register
- [x] S1 migration 041 — applied to prod, columns verified — 2026-07-06
- [x] S2 `lib/puttFacts.js` + 13 tests (incl. Number([])→0 coercion catch) — 2026-07-06
- [x] S3 server ride-along + fan-out carry — plus audit catch #1: score corrections without putt fields never wipe earlier entries (hasOwnProperty guard) — 2026-07-06
- [x] S4 shared PuttChips + ScoreModal(self) + queue threading — plus audit catch #2: client omits null counts so re-saves can't wipe — 2026-07-06
- [x] S5 gates green: server 83/83, client lint/build/tests clean; audit caught 2 real wipe-bugs pre-ship — 2026-07-06
- [x] SHIPPED `833e67e` to main — 2026-07-06. Residual: on-course pass (joins the standing list); Dale review-on-pull. UPDATE same-day: hedge CLOSED — full live e2e run against the beta + prod DB (test outing 8L3U, dedicated test users #2/#14, scripts/e2e-putt-capture*.mjs): 9/9 API steps + data verified — self putts land, host-self path lands, on-behalf putt fields ignored (B row+round NULL), score-correction preserves putts, invalid count>score dropped w/ score saved, /end carries facts into tm_rounds ([2,1,2,2,2,2,2,2,null,2×9]). Only remaining residual: the human on-course pass.

## 5. Scope guardrails

- Nobody enters another player's putts. Period. (Golfshot allows count-by-proxy; we don't.)
- Putt capture NEVER gates or fails a score write.
- No SG reads from participant putt columns — SG reads `tm_rounds` only (facts flow at close).
- No changes to conflict/OCC/designated-scorer/flag logic.
- First-putt distance stays optional-optional (enthusiast layer).

## Sources
- Agent research 2026-07-06 (18Birdies/TheGrint/Golfshot/Hole19/Arccos/Golf Pad/SwingU/
  Shot Scope capture patterns; GolfWRX friction threads) — full cites in session log.
- Live reads: `server/src/routes/outings.js` (/scores 980, /scores/host 1150, /end 2103,
  fan-out 2240), `client/src/pages/Outing/LiveOuting.jsx` (ScoreModal 404, saveScore 1844,
  routing 1864), `client/src/pages/ActiveRound.jsx` (chips 345–381), migrations 002/039.
- `f5-never-lose-your-round-build-spec-2026-06-28.md`, `docs/SG-DESIGN.md` (PR #1).


============================================================================
=== SOURCE PAGE: eagle-eye-tokenization-plan-2026-07-02.md
============================================================================

---
type: synthesis
created: 2026-07-02
updated: 2026-07-02
tags: [the-match, eagle-eye, design-tokens, phase-4-3, refactor, build-plan]
---

# Phase 4.3 — Eagle Eye Inline-Style → Token Refactor (Bulletproof Build Plan)

Master build plan for converting `client/src/pages/EagleEye.jsx` from ad-hoc inline
style literals to a governed design-token system. Companion to
`build-plan-bulletproof-2026-06-23.md` (Phase 4.3) and
`eagle-eye-premium-plan-2026-06-23.md` (Phase 3 app-wide premium polish).

> **North Star (Matt, 2026-07-02):** best golf app in the world — usability, accuracy,
> visual flow. This refactor is a *foundation* move: it makes the hero screen consistent,
> maintainable, and ready to be elevated. It is not cosmetic busywork; it removes the
> single largest source of silent visual drift on the most important screen in the app.

---

## 1. Why this matters (the problem, measured)

Verified this session against the live file (`EagleEye.jsx`, `tokens.css`):

- **2,544 lines · 237 inline `style={{}}` blocks · only 11 `var(--tm-*)` references.**
  The hero screen is ~99% hardcoded literals.
- **~30 distinct color bases, ~130 color literal uses**, plus large opacity families:
  **29 distinct `rgba(255,255,255,*)` opacities alone**, ~40 gold-tint rgba, ~35 green
  rgba, ~30 dark-bg rgba.
- The app's design tokens **moved to a light parchment theme** (`--tm-bg` = `#F2EEE6`).
  Eagle Eye is a **dark instrument screen** (`#070C09` bg, `#F5D78A` light-gold readouts,
  `#5ED47A` alignment green). **The existing `--tm-*` palette does not cover it.**

**Consequence:** every color on the hero screen is a raw literal that can drift from the
rest of the app with nobody noticing — exactly the failure class this project keeps
getting bitten by. Tokenizing it is how we make "consistent + on-palette" a guarantee
instead of a hope.

### The traps (why this is NOT a find-and-replace)

1. **`#070C09` ≠ `--tm-dark-0` (`#0A0E0C`).** Verified. A naive "swap to nearest token"
   would shift the background on OLED. 6 direct uses + ~30 `rgba(7,12,9,*)`.
2. **Only 3 colors map to an existing token exactly:** `#C9A040`→`--tm-gold`,
   `#E8C05A`→`--tm-gold-bright`, `#2A7A38`→`--tm-green-bright`. Everything else has **no
   token** or is a **trap**.
3. **Conditional/ternary colors** (verified lines): 333 (`accent='#5ED47A'` default prop),
   495, 505, 660, 799, 1753 (triple ternary), 2068. These carry *logic* — each branch must
   be handled, they cannot be blindly substituted.
4. **SVG `fill`/`stroke` attributes** (not CSS) at 267–275, 346–348, 551–561, 590–598,
   915–921 — different substitution mechanics than CSS `style`.
5. **No type scale, no spacing scale, no letter-spacing scale exist in `tokens.css`.**
   Radius/shadow/duration are only partially covered. Creating those scales is a *design
   decision*, not a mechanical swap.

---

## 2. Competitive research — what "better" looks like (informs token *values*, staged for later)

Full report in session log. Verified highlights that shape our design direction:

- **The dark-instrument metaphor is an unclaimed lane on phones.** Only Arccos (charcoal)
  and Garmin AMOLED watches go truly dark; the phone leaders (18Birdies, Golf Pad) are
  bright satellite maps criticized as "vanilla" and hard to read in sun. Eagle Eye's dark
  screen is a *strategic differentiator* — the token system should protect and sharpen it.
- **Emerging cross-industry color code: white = raw distance, green = plays-like/adjusted**
  (appears on *both* Arccos app and Bushnell hardware). Our tokens should encode this
  semantic (a `--tm-ee-raw` / `--tm-ee-adjusted` pairing) so the meaning is named, not
  incidental.
- **Big-number hero** (Garmin "Big Numbers", Golfshot auto-enlarge, readable without
  glasses) is the category convention. Our type scale (when built) should make the primary
  yardage dominant.
- **Hard DON'T (unanimous):** never show a ± margin / confidence band on the hero number.
  No mainstream app or device does. It reads as false precision and kills commitment. Our
  standing marketing/accuracy rule already forbids this — the token work must not sneak in
  a "confidence chip." (Matches `build-plan-bulletproof` operational decision, Matt.)
- Other documented competitor mistakes to *not* reproduce: 18Birdies' backwards F/C/B
  ordering; GolfLogix's forced irreversible view switch; finger-occlusion of the aim number.

**Scoping decision:** value *elevation* toward best-in-class (white=raw/green=adjusted
semantics, big-number hierarchy) is **Stage C**, a separate reviewed pass. Stages A–B
freeze today's exact values so the refactor is provably pixel-identical first. We reach the
"full" destination Matt chose, but staged behind verification gates so each step is safe.

---

## 3. Token architecture (the design)

### 3.1 Namespace: Eagle Eye owns its palette — `--tm-ee-*`

Eagle Eye gets a **dedicated instrument-palette namespace** rather than reusing the app's
`--tm-*` tokens, even for the 3 that currently match. Rationale:

- The app theme went **light**; the instrument is **dark**. They are different surfaces
  with different intent. Coupling them is what *created* this drift risk.
- If a future app-theme change shifts `--tm-gold`, the instrument must **not** silently
  move with it. EE-owned tokens make the boundary explicit.
- Self-contained = safe to reason about the hero screen in isolation.

Defined in a clearly-commented block in `tokens.css` (single source of truth), values
**exactly equal to today's literals**.

### 3.2 Solid-color tokens (exact current values)

```css
/* ---- Eagle Eye instrument palette (dark surface, self-contained) ---- */
--tm-ee-bg:          #070C09;  /* instrument background (NOT --tm-dark-0) */
--tm-ee-ink:         #0A0A0A;  /* near-black SVG stroke (WindDial) */
--tm-ee-gold:        #C9A040;  /* primary gold (== --tm-gold today, owned by EE) */
--tm-ee-gold-bright: #E8C05A;  /* gradient/pulse endpoint (== --tm-gold-bright today) */
--tm-ee-gold-light:  #F5D78A;  /* readout / chip-label light gold (34 uses) */
--tm-ee-green:       #5ED47A;  /* alignment / GPS-locked / "shorter" (14 uses) */
--tm-ee-green-deep:  #2A7A38;  /* gradient deep green (== --tm-green-bright today) */
--tm-ee-amber:       #F0A868;  /* acquiring / "plays longer" warm (7 uses) */
--tm-ee-red:         #F87171;  /* adjustment penalty / "plays longer" (1 use) */
```

### 3.3 Opacity families: RGB-triplet tokens + `rgb(... / a)` syntax

The opacity explosion (29 white opacities, ~40 gold-tint, ~35 green, ~30 dark) makes
one-token-per-opacity untenable. Instead, define **one RGB-triplet token per color** and use
modern space-separated `rgb()` with slash-alpha at the call site — this preserves the
**exact** value while collapsing ~140 rgba literals to 9 tokens.

```css
--tm-ee-bg-rgb:          7 12 9;
--tm-ee-gold-rgb:        201 160 64;
--tm-ee-gold-bright-rgb: 232 192 90;
--tm-ee-gold-light-rgb:  245 215 138;
--tm-ee-green-rgb:       94 212 122;
--tm-ee-green-deep-rgb:  42 122 56;
--tm-ee-amber-rgb:       240 168 104;
--tm-ee-white-rgb:       255 255 255;
--tm-ee-black-rgb:       0 0 0;
```

Call site: `rgba(255,255,255,0.25)` → `rgb(var(--tm-ee-white-rgb) / 0.25)`.

**Runtime safety:** `rgb(R G B / a)` slash-alpha syntax (CSS Color 4) is, per known WebKit
support history, available since Safari 12.1 / iOS 12.2 — comfortably below the iOS 15+ App
Store target. **This has NOT been re-verified against a live compatibility source this
session** — treat it as high-confidence-but-unconfirmed and make the on-device smoke-test in
the Stage-B gate a hard requirement, not a formality. If it fails on the shell, fall back to
named per-opacity tokens for the values actually used.

### 3.4 Semantic aliases (named meaning, points at palette)

```css
--tm-ee-raw:      var(--tm-ee-gold-light);  /* raw GPS distance readout */
--tm-ee-adjusted: var(--tm-ee-green);       /* plays-like / adjusted (white→green convention) */
--tm-ee-aligned:  var(--tm-ee-green);       /* reticle alignment success */
--tm-ee-acquiring:var(--tm-ee-amber);       /* GPS acquiring */
```

These make the *intent* legible and set up Stage C (elevate values behind a stable name)
without a second literal-hunt.

### 3.5 Deferred to their own tickets (NOT Stage A/B — these are new scales = design work)

- **Type scale** (15 font sizes), **spacing scale** (20+ values), **letter-spacing scale**
  (12 values). Creating these means *choosing* a scale (e.g., 4px grid, modular type ramp),
  which can change values → not pixel-identical → belongs in a reviewed design-system task.
- **Radius/shadow/duration:** only swap the ones that match an existing token **exactly**
  (radius 6/12/9999, shadow-lg `0 8px 32px`); leave the rest until the scale question is
  settled.

---

## 4. Staged build plan (each stage independently shippable + verifiable)

### Stage A — Establish tokens (no behavior change)
- **A1.** Add the `--tm-ee-*` block (§3.2–3.4) to `tokens.css` with exact values. No JSX
  touched yet. → verify: `npm --prefix client run build` clean; visual diff = zero (nothing
  references them).
- **A2.** Add a short comment header in `tokens.css` documenting the EE namespace + the
  white=raw/green=adjusted intent + "values frozen to 2026-07-02 literals."

### Stage B — Swap literals → tokens, region by region (pixel-identical)
Swap in **small, independently-verifiable commits by file region** (from the inventory map),
easiest/safest first. After each region: lint + build + geo.test + vitest + screenshot diff.

- **B1.** Static solid colors (non-conditional, non-SVG): the bulk of `#F5D78A / #5ED47A /
  #C9A040 / #E8C05A / #F0A868 / #070C09` in plain `style={{ color/background/border }}`.
- **B2.** Opacity families → `rgb(var(--tm-ee-*-rgb) / a)` (whites, gold-tint, green, dark-bg).
- **B3.** Conditional/ternary colors (lines 333, 495, 505, 660, 799, 1753, 2068). Keep the
  ternary *logic* byte-for-byte; only the color operands become tokens. One commit, careful
  review, each branch checked.
- **B4.** SVG `fill`/`stroke` attributes (267–275, 346–348, 551–561, 590–598, 915–921).
  `stroke="rgb(var(--tm-ee-*-rgb) / a)"` works in SVG presentation attributes; verify each
  renders identically. The `accent` prop default (333) becomes `accent = 'var(--tm-ee-green)'`.
- **B5.** box-shadow / drop-shadow / inset-highlight strings that use EE colors (357, 584,
  1911, 2007, 2379) → token-based `rgb(... / a)` inside the shadow string.
- **B6.** Exact-match non-color tokens only: radius 6/12/9999 → `--tm-radius-sm/--tm-radius/
  --tm-radius-full`; shadow `0 8px 32px` → `--tm-shadow-lg`. Skip anything not an exact match.

### Stage C — Visual elevation (SEPARATE, reviewed, optional; only after A+B verified)
- Using competitor research: consider elevating specific *values* behind the now-stable
  token names (big-number type ramp, sharpen white=raw/green=adjusted). Each change is a
  deliberate design decision reviewed with Matt + verified on device. **Not part of the
  pixel-identical guarantee.** Type/spacing/letter-spacing scale creation lives here or in
  its own design-system ticket.

---

## 5. Verification gates (every stage, non-negotiable)

Per `CLAUDE.md` beta discipline — a clean `vite build` is NOT sufficient (it compiles
undefined identifiers that then ReferenceError on device):

```
npm --prefix client run lint      # ESLint no-undef — catches server-only leaks / typos
npm --prefix client run build     # must be clean
node client/src/lib/geo.test.mjs  # 31/31 — geometry untouched, proves no collateral damage
npm test                          # vitest suite green
```
Plus, because this is a *visual* refactor with a pixel-identical claim:
- **Screenshot diff** of Eagle Eye (welcome, distance view, plays-like sheet, camera modal,
  course picker, bag sheet) before vs after each region — must be visually identical.
- **On-device pass** on the native iOS shell before Stage B is called done (POST-LAUNCH #25
  covers the on-course confirmation; the visual pixel-check can be done in the beta first).

Only after all gates pass: commit + push to `main` (beta = `main`).

---

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | Naive swap `#070C09`→`--tm-dark-0` shifts bg color | High if careless | Visible on OLED | Dedicated `--tm-ee-bg` = exact `#070C09`; never point at `--tm-dark-0` |
| R2 | Ternary color operand mishandled → wrong branch color | Med | Broken alignment/GPS feedback | B3 isolated commit; verify each branch renders; keep logic byte-identical |
| R3 | `rgb(... / a)` slash-alpha unsupported in runtime | Low | Colors fail to render | Target iOS 15+ guarantees support; smoke-test on device in B2 gate |
| R4 | Undefined `var()` typo compiles but renders wrong | Med | Silent visual break | Lint + screenshot diff per region; small commits localize blast radius |
| R5 | SVG presentation attr doesn't accept `var()`/`rgb()` as written | Med | Icon renders wrong | B4 verifies each SVG individually; fall back to inline `style` on the SVG node if attr rejects it |
| R6 | Scope creep into type/spacing "while we're here" | Med | Pixel drift, blown guarantee | Hard rule: A/B are exact-value only; scales are Stage C / separate ticket |
| R7 | Drive-by refactor of adjacent logic | Low | Violates code discipline | Every changed line traces to token swap; no logic edits (CLAUDE.md) |
| R8 | Big diff hard to review/rollback | Med | Hard to bisect a regression | Region-by-region commits; each independently revertable |
| R9 | Touching HoleMapGL distance code | Low | Breaks verified-accurate distances | Out of scope — do not touch; geo.test guards it |

**Rollback:** each region is its own commit; revert the offending commit. Stage A alone is
inert (defining unused tokens changes nothing) so it can sit safely even if B is paused.

---

## 7. Progress checklist

**Planning**
- [x] Research competitor yardage/instrument screens (agent) — 2026-07-02
- [x] Full inventory of EagleEye.jsx literals + token gaps (agent, spot-checked) — 2026-07-02
- [x] Design `--tm-ee-*` token architecture — 2026-07-02
- [x] Write this bulletproof plan + checklist — 2026-07-02
- [x] Audit plan with `audit-before-claim` — 2026-07-02 PM (see §9 execution record: corrections found + applied)
- [x] Matt greenlights Stage A build — 2026-07-02 ("lock in work autonomously on this")

**Stage A — establish tokens**
- [x] A1 add `--tm-ee-*` solid + rgb-triplet + semantic tokens to `tokens.css` (exact values) — commit `6fcbd72`
- [x] A2 comment header documenting namespace + white=raw/green=adjusted intent — same commit
- [x] Gate: build clean, zero visual change — lint ✓ build ✓ geo 31/31 tests 4/4

**Stage B — swap literals (consolidated to 2 bisectable commits, gated each — see §9)**
- [x] B1 static solid colors — commit `e63ef0c` (all hex, 84 lines)
- [x] B2 opacity families → `rgb(var(--tm-ee-*-rgb) / a)` — commit `7add76f` (225 substitutions, 0 `rgba(` remain)
- [x] B3 conditional/ternary colors — inside `e63ef0c`/`7add76f`; operands only, logic byte-identical (333, 495, 505, 660, 799, GPS pill 1747–1758, chip 2068, `PL_LONGER`/`PL_SHORTER`, `distAccent` 1592)
- [x] B4 SVG fill/stroke attrs + accent prop — inside the same commits; runtime-verified in a live browser (var-in-attr + `stopColor` var + nested `rgb(var()/a)` in attr all resolve to exact values — TOKEN-CHECK-PASS)
- [x] B5 box-shadow/drop-shadow/inset strings — inside the same commits (incl. keyframes in `<style>` template literals)
- [x] ~~B6 exact-match radius/shadow non-color tokens~~ — **DROPPED after audit**: no `0 8px 32px` shadow exists in the live file, and pill radii are `999` (≠ `--tm-radius-full` 9999px — swapping would change the value). Coupling EE radii to app tokens also contradicts the EE-owns-its-surface rationale. See §9.
- [x] Gate each commit: lint ✓ + build ✓ + geo.test 31/31 ✓ + `npm test` 4/4 ✓ (note: the suite is `node --test`, not vitest) + **programmatic value-equivalence check** (stronger than screenshot diff from a sandbox): 244/244 changed lines resolve byte-identical to the pre-refactor literals through tokens.css
- [x] Pushed to `main` (beta) — `f39eea4..7add76f`, 2026-07-02 PM
- [ ] On-device pixel-identical eyeball pass on the beta (Matt, next time on the phone) — residual, low-risk given the equivalence + live-browser checks

**Stage C — visual elevation (separate, optional, reviewed)**
- [ ] Type/spacing/letter-spacing scale as a design-system decision
- [x] Elevate values behind stable token names — **C1 SHIPPED 2026-07-07** (`a70a1b7`): aliases
      re-ruled white=measured/green=computed/gold=locked/dim=acquiring + wired (heroes,
      distAccent, GPS pill/chip); C2 11px label floor shipped; C3 soft-halo staged behind
      `tm-ee-halo-soft`. Spec: `ee-stage-c-holemapgl-tokenization-build-spec-2026-07-07.md`
      (also closes §"HoleMapGL trap" — converted via the bridge same day, 57/57 equivalence)
- [◐] Per-change review with Matt: C1/C2 approved + shipped 2026-07-07; on-device eyeball
      folded into the on-course pass (POST-LAUNCH #25); C3 A/B pending on-device

---

## 8. Scope guardrails (what this plan will NOT do)

- Will **not** touch `HoleMapGL.jsx` distance logic or the `teeOffset` band-aid (load-bearing,
  verified accurate — handoff 2026-07-02).
- Will **not** change any visual value in Stage A/B — pixel-identical is the contract.
- Will **not** add a confidence/±-margin chip (standing marketing/accuracy rule).
- Will **not** create type/spacing scales inside the mechanical refactor.
- Will **not** drive-by refactor adjacent logic — every changed line traces to a token swap.

---

## 9. Execution record — Stage A+B SHIPPED 2026-07-02 PM (audited)

Executed autonomously on Matt's greenlight. Three commits on `main`:
`6fcbd72` (Stage A tokens) · `e63ef0c` (all hex → tokens, 84 lines) · `7add76f`
(all 225 `rgba()` → `rgb(var(--tm-ee-*-rgb) / a)`). Every gate green per commit.

**Audit corrections to this plan (live file had drifted since the plan was written):**
- File was 2,523 lines / 236 style blocks at execution (plan said 2,544/237 — the
  2026-07-02 ANALYZE-button removal shifted it).
- **7 colors the plan's palette missed** were found and added to the token set with exact
  frozen values: `#F5E070`+`rgba(245,224,112)` (gauge/landing-zone pulse), `#07100C`
  (course-picker bg), `#0E1F13` (bag-sheet gradient), `#1A6B28`/`#2E9E45` (CTA gradient),
  `rgba(224,82,82)`/`rgba(220,38,38)` (error reds), glass darks `8,12,10`/`10,14,12`/`4,8,6`.
  Final namespace: 34 tokens (14 solids + 16 rgb-triplets + 4 semantic aliases).
- **B6 dropped** — its premise was false in the live file (no `0 8px 32px`; radii are `999`
  not `9999`, and 999→9999px is a value change violating the freeze).
- The test suite is `node --test` (4/4), not vitest.
- Region-by-region commits consolidated to **2 bisectable commits** (all-hex, all-rgba):
  the value→token mapping is context-independent, so finer regions added review surface
  without adding safety; the equivalence verifier covers the whole diff regardless.

**Verification actually performed (evidence, this session):**
1. Lint + build + `geo.test` 31/31 + `npm test` 4/4 after each of the 3 commits.
2. Combined-diff equivalence: a resolver script mapped every `var(--tm-ee-*)` /
   `rgb(var(--tm-ee-*-rgb) / a)` in the new tree back through `tokens.css` — **244/244
   changed lines byte-identical** to the pre-refactor literals. Fails loudly on unmapped
   colors/typos, so an undefined-token silent break (risk R4) is mechanically excluded.
3. Live-browser runtime check (Chrome via localhost probe page): `rgb(R G B / a)` w/ var,
   var in box-shadow, **var in SVG `fill`/`stroke` attributes**, nested `rgb(var()/a)` in
   an SVG attribute, and `stopColor` var all computed to the exact expected colors
   (TOKEN-CHECK-PASS). Closes R3/R5 in Blink; WebKit syntax support separately confirmed
   (caniuse: Safari/iOS ≥ 12.2 — below the iOS 15 floor).
4. Design-system audit of the namespace: 0 used-but-undefined tokens, 0 orphans beyond the
   4 intentional Stage-C aliases, naming consistent. Residual color literals in the file:
   `#fff`×19/`#000`×1 (kept by design) + 1 hex inside a comment.

**Findings logged, not fixed (out of scope):**
- The same instrument literals appear in **34 other files** (HoleMapGL, Login, Stats, the
  Outing suite, …) — future Phase-4.3 slices.
- ⚠ **HoleMapGL trap for the next slice:** it feeds colors into MapLibre **paint
  properties**, where CSS `var()` does NOT resolve. That slice needs a
  `getComputedStyle`-at-init bridge (or equivalent) — do NOT extend this codemod to it naively.
- `ResultSheet` (unreachable since the ANALYZE removal) mixes light-theme app tokens
  (`--tm-surface`, now parchment) with dark-surface white-opacity text — a pre-existing
  inconsistency to resolve whenever the AI-camera flow is rebuilt.

**Competitor-research verification (agent, cited):** white=raw/green=adjusted is
**Arccos-specific precedent**, not industry-wide (token comment says so); Garmin ships a
literal "Big Numbers" mode (hero-number convention confirmed); **no mainstream app prints a
± margin on the hero number** — standing rule reaffirmed.

---

## Sources
- Live file reads this session: `client/src/pages/EagleEye.jsx`, `client/src/design/tokens.css`
  (line-level claims spot-checked via grep/sed).
- Competitor research agent report (session log, 2026-07-02) — 18Birdies, Golfshot, Arccos,
  Hole19, SwingU, GolfLogix, TheGrint, Golf Pad, Garmin; Bushnell/Garmin hardware aesthetic.
- `wiki/synthesis/next-session-handoff-2026-07-02.md` (Eagle Eye state, do-not-touch list).
- `wiki/synthesis/build-plan-bulletproof-2026-06-23.md` (Phase 4.3 parent), `CLAUDE.md`
  (beta discipline, App-Store bar, framing check).


============================================================================
=== SOURCE PAGE: ee-stage-c-holemapgl-tokenization-build-spec-2026-07-07.md
============================================================================

---
type: synthesis
created: 2026-07-07
updated: 2026-07-07
tags: [eagle-eye, design-tokens, maplibre, phase-4-3, build-spec]
---

# EE Stage C + HoleMapGL tokenization — bulletproof build spec (2026-07-07)

Parent: [[synthesis/eagle-eye-tokenization-plan-2026-07-02]] (Stage A+B shipped `f39eea4..7add76f`).
Greenlit by Matt 2026-07-07 ("greenlight… lock in") with the standing bar: usability, accuracy,
visual flow — do it better than the most-used golf apps, not just match them.

## 1. What this ships

Two slices, deliberately different contracts:

- **Slice 1 — HoleMapGL token conversion (pixel-identical, mechanical).** All ~44 color-literal
  lines in `client/src/pages/HoleMapGL.jsx` move behind `--tm-ee-*` tokens: MapLibre paint props
  via the `eeColor` bridge (resolved-at-creation, literal fallbacks), DOM/JSX/`<style>` via
  `var()` / `rgb(var()/a)`. Zero visual change is the contract, verified per line.
- **Slice 2 — Stage C visual elevation (reviewed design deltas).** Research-grounded value
  changes behind the now-stable token names. Each delta is presented to Matt with before/after
  values and shipped only on approval (per the Stage C contract in the parent plan).

## 2. Research foundation (2 agents, 2026-07-07, cited in session log)

**Competitive/UX** (10 most-used golf GPS apps + rangefinder hardware surveyed):
- Documented color precedent (the only one in the category, current as of Feb 2025): **white =
  raw GPS, green = weather-adjusted** (Arccos). Garmin codes plays-like with icons (▲▪▼), not
  color. **No leader uses gold for a distance value** — gold is unclaimed; we can own it as the
  "locked/aligned" state. No leader color-codes GPS-acquiring; instrument-panel convention
  (aviation/automotive) is that unverified data never displays in a confidence color.
- Our hero type (46/900 gauge, 52/900 sheet, 68/800 result, tabular) is **at/above the category
  bar**. Cited gaps: 9px micro-labels are below every outdoor-legibility guideline surveyed
  (Apple 11pt floor; sunlight research wants ≥5:1 effective contrast + bolder/bigger);
  category leader ships a named **"Big Numbers" mode** we lack (logged as follow-up, not this slice).
- Map labels: bare haloed numbers (no pill) is the correct approach per cartography canon
  (ESRI/Penn State); refinement is a **soft blurred dark casing ~40–60% opacity** rather than a
  hard stroke; oversized halos hurt. Category color language: white=target, blue=you,
  gold/yellow=pin, warm=hazard — our palette already complies.
- Leaders' weaknesses = our openings: admitted screen clutter (TheGrint's own copy), hierarchy
  regressions (18Birdies), mid-round upsells (Bushnell), binary numbers-vs-map modes (Garmin).
  Calm-by-default instrument screens are the winning posture.

**MapLibre engineering** (primary-source verified: maplibre-style-spec `parse_css_color.ts`,
`validate_color.ts`, `style.ts`, `style_layer.ts`):
- Spec ≥19 (gl-js v3/v4/v5) parses hex 3/4/6/8, comma `rgb()/rgba()`, space/slash CSS Color 4,
  `hsl()`, named colors. **`var()` never.** Comma-form `rgba(r,g,b,a)` is the safest interchange —
  exactly what `eeColor` emits.
- **Worst failure mode: an invalid color at `addLayer` silently drops the entire layer**
  (validation returns early, fires ErrorEvent → console.error, no exception). Literal fallbacks
  in the bridge are therefore load-bearing, not decoration.
- `['case', …]` expression branches parse the same formats; invalid literal = same layer-drop.
- `getComputedStyle` at map `load` is timing-safe (Vite awaits chunk CSS before JS; React mounts
  post-DOMContentLoaded; `load` fires later). WebKit may serialize leading whitespace on custom
  properties — `eeColor`'s `.trim()` is load-bearing. Always read `document.documentElement`,
  never the map container.
- `var()` in **SVG presentation attributes** inside marker `innerHTML` is the likeliest
  silent-wrong-color trap (attribute values don't do CSS substitution in the general case, and
  Stage B's TOKEN-CHECK-PASS verified JSX-rendered SVG in Blink, not innerHTML-injected markers
  in WebKit). Guard: use `style="fill:…"` declarations inside injected SVG — guaranteed CSS.
- In CSS with space-separated triplets, only `rgb(var(--x-rgb) / a)` is valid;
  `rgba(var(--x-rgb), a)` is a dropped declaration. (JS bridge output uses comma-form on
  resolved numbers, which is fine.)
- Latent `eeColor` defect: alpha path fed a solid (hex) token emits `rgba(#hex,a)` → invalid →
  fallback path saves rendering but masks the bug. Guard: hex-detect in the alpha branch +
  dev-only warn on empty token reads.
- Recommended shape: resolve all tokens **once per map init into a frozen object** (one
  computed-style read), each entry with its literal fallback.

## 3. Slice 1 — HoleMapGL conversion (build plan)

Inventory (44 literal lines, three categories):

- **M — MapLibre paint props** (must use bridge): base style `bg` `#0c1a10` + `tint` `#0E3B23`
  (264–266); fairway glow/line `#F5E070` (328–329); green fill/line `#5ED47A` (330–331); halo
  fill/line `#F5D78A` (332–333); landing fill/line `#F5E070` (362–363); `['case']` branches
  `#F5E070`/`#F5D78A`/`rgba(245,224,112,0.62)` (371, 377). Lines 341–355 already bridged.
- **D — DOM cssText / innerHTML** (CSS `var()` works): popup pill (139–142), `distEl` white
  number + halo (173–183), GPS dot (446), pin-flag marker SVG (454–455), target circle (469),
  green-center dot (726). SVG fills inside `innerHTML` move to `style=` declarations (research
  guard), never presentation attrs.
- **J — JSX inline styles + `<style>` template** (CSS `var()` works): fallback screen + CTA
  (772–781), popup/ctrl-group CSS (790–800), container bg (807).

Token gaps → 3 new tokens (append to the EE block in `tokens.css`, exact current values):
`--tm-ee-map-bg: #0c1a10` (map base under imagery) · `--tm-ee-map-tint: #0E3B23` (green tint
wash) · `--tm-ee-flag: #E53935` (pin-flag red, also the distEl flag glyph).

Bridge hardening (same commit, behavior-identical): resolve-once frozen object at map init;
`eeColor` alpha-path hex guard + dev-only `console.warn` on empty reads. Literal fallbacks stay
byte-identical to today's values on every call site.

Conventions carried from Stage B: bare `#fff`/`#000` literals stay (kept-by-design); every
`rgba(255,255,255,a)`/`rgba(0,0,0,a)` in CSS-land → `rgb(var(--tm-ee-white-rgb) / a)` /
`rgb(var(--tm-ee-black-rgb) / a)`; operands-only in ternaries/case-expressions, logic
byte-identical.

**Out of scope (hard lines):** distance math, `teeOffset`, layer structure/order, opacities,
widths, blurs, `distEl` sizes — nothing but color-value indirection. R9 from the parent plan
stands: `geo.test` guards geometry untouched.

## 4. Slice 2 — Stage C proposals (each requires Matt's approval before ship)

Grounded in §2; presented as before → after:

- **C1. Re-rule the semantic aliases** (tokens.css lines 140–143): `--tm-ee-raw` gold-light →
  **white**; `--tm-ee-aligned` green → **gold**; `--tm-ee-acquiring` amber → **dimmed white
  (60% opacity ramp)**; `--tm-ee-adjusted` stays **green**. Ruling: white = measured, green =
  computed, gold = locked/trusted, dim = not yet trustworthy. Then **wire the aliases** into the
  call sites that today reference palette tokens directly (hero surfaces first), so future
  design moves are one-line token edits.
  ⚠ Visible consequences to review: plays-like sheet hero `52px` flips gold-light → green
  (it's a computed number); gauge hero stays white (raw); GPS-locked accents flip green → gold;
  acquiring amber loses its color reward. This is the deliberate, research-backed re-ruling —
  the single highest-leverage visual-semantics change available.
- **C2. Micro-label floor 9px → 11px** on the gauge label + YDS unit (2 sites in EagleEye.jsx),
  tracking kept. Outdoor legibility floor; smallest possible diff.
- **C3. Map-label halo softening**: `distEl` swaps the hard 0.75px text-stroke for a slightly
  wider soft shadow casing at reduced opacity (tuned on device with Matt — imagery-dependent,
  not shippable blind).
- **C4 (logged follow-up, NOT this session): "Big Numbers" glance mode** — hero ≥68px, F/B as
  labels — as a build-plan item, closes the one structural gap vs the category leader.

## 5. Verification gates (every commit, non-negotiable)

```
npm --prefix client run lint          # no-undef + jsx-no-undef (af059f3 gate)
npm --prefix client run build         # clean
node client/src/lib/geo.test.mjs      # 31/31 — geometry untouched
npm test                              # node --test suite green
```
Plus, slice-specific:
- **Value-equivalence check (Slice 1)**: script resolves every token/bridge expression against
  `tokens.css` and diffs byte-for-byte vs the pre-edit literal per changed line — the Stage B
  244/244 technique. MapLibre-bound outputs additionally validated against the accepted-format
  regex (`^(#|rgb|hsl|[a-z])`).
- **Layer-presence check (Slice 1)**: because the failure mode is a *silently missing layer*,
  a browser walk of Eagle Eye's map view must confirm all converted layers render (fairway,
  green, halo, landing, hole-line, rings/arcs) — visible window per the 07-06 lesson.
- **Lockfile discipline**: no `npm install` is expected; if any dependency changes, lockfile
  diff + clean-slate install with Vercel's exact command (07-07 rule).
- Slice 2 ships only after Matt approves each delta; on-device eyeball is his call per C-item.

## 6. Risk register

| # | Risk | L | Impact | Mitigation |
|---|------|---|--------|-----------|
| R1 | Invalid color at addLayer → whole layer silently missing | Med | Map loses fairway/green/etc., no error surfaced to user | Literal fallbacks byte-identical to today; dev-format assertion; layer-presence browser walk |
| R2 | `var()` in injected SVG attrs ignored in WKWebView → wrong fill | Med | Flag/marker renders black/wrong | `style=` declarations only inside `innerHTML` SVG; browser-verified |
| R3 | Alpha path fed hex token → invalid rgba masked by fallback | Low | Token edit later silently no-ops | Hex guard + dev warn in `eeColor` |
| R4 | `rgba(var(--x-rgb), a)` written in CSS → declaration dropped | Med | Element loses color entirely | Slash-form only in CSS; grep gate for `rgba(var(` before commit |
| R5 | Ternary/case operand slip changes logic branch | Low | Wrong highlight color | Operands-only rule; value-equivalence diff catches |
| R6 | Scope creep into opacity/width/size "while we're here" | Med | Pixel drift, blown guarantee | Slice 1 is color-indirection only; C-deltas quarantined to Slice 2 |
| R7 | C1 re-ruling looks wrong on device despite being right on paper | Med | Hero loses premium feel | Ship C1 behind Matt's explicit approval; aliases make revert a 4-line change |
| R8 | Touching distance logic / teeOffset | Low | Breaks verified accuracy | Out of scope; geo.test 31/31 gate |
| R9 | Stale SW serves old bundle during browser walk → false failure | Med | Wasted debugging | Retry after reload per 07-06 rule; served-bundle gate (vercel inspect + content grep) |

Rollback: Slice 1 is one revertable commit (or two if M/D+J split aids bisection); C-deltas are
one commit each. Aliases mean C1's revert is `tokens.css`-only.

## 7. Progress checklist

**Planning**
- [x] Recon: live inventory of HoleMapGL literals, bridge, token gaps — 2026-07-07
- [x] Research agents: competitive UX + MapLibre engineering (cited) — 2026-07-07
- [x] This spec + risk register
- [ ] Audit spec + claims with audit-before-claim

**Slice 1 — HoleMapGL conversion (pixel-identical)**
- [x] S1a. 3 new tokens (`--tm-ee-flag/map-bg/map-tint`, exact values) + bridge hardening
      (module-level computed-style cache, alpha-path hex guard, dev warns) — 2026-07-07
- [x] S1b. M-category: paint props → bridge (fallbacks byte-identical, case-expression
      operands only) — 2026-07-07
- [x] S1c. D+J categories → var()/slash-form; injected-SVG colors moved to `style=`
      declarations (research guard R2) — 2026-07-07
- [x] Gate: lint ✓ build ✓ geo 31/31 ✓ npm test 83/83 ✓ value-equivalence 57/57 color
      occurrences byte-identical ✓ `rgba(var(` grep = 0 ✓ — 2026-07-07
- [x] Browser walk (dev server, visible window): imagery + gold dashed fairway line
      (bridge-converted paint layer) + red pin-flag + white distEl labels + red flag glyph
      rendered; zero `[HoleMapGL]`/validation console errors. Occlusion killed the later
      re-walk (07-06 lesson reproduced: rAF frozen while hidden — diagnosed live);
      remaining full-layer eyeball moved to PROD per Matt ("we test live on production").
- [ ] Prod eyeball (Matt, on the beta): fairway/green/halo/landing/arcs layers + aim ring

**Slice 2 — Stage C (per-delta approval)**
- [x] Present C1–C3 to Matt with before/after values — approved 2026-07-07 (C1 ship,
      C2 ship, C3 stage-for-device)
- [x] C1 semantic re-ruling + alias wiring (raw=white · adjusted=green · aligned=gold ·
      acquiring=dim white; wired: gauge hero, sheet hero, distAccent, GPS pill, GPS chip.
      Camera-modal alignment UI left untouched — unreachable since ANALYZE park, same
      status as ResultSheet) — 2026-07-07; headless-verified: hero white, labels/accent
      resolve, gates green
- [x] C2 label floor 11px (gauge label + YDS) — 2026-07-07; headless-verified 11px
- [x] C3 halo softening staged behind localStorage `tm-ee-halo-soft`='1' (default OFF =
      today's halo byte-identical) — A/B on the course with Matt before any default flip
- [ ] C4 Big Numbers mode → logged as follow-up (below)

**Wrap**
- [ ] audit-before-claim over the session's claims
- [ ] log.md entries · handoff update + rollup regen · trust anchors · commit/push ·
      notebooklm refresh verify_failed:0 · preflight green

## Sources
- Live reads this session: `client/src/pages/HoleMapGL.jsx` (810 lines), `client/src/pages/EagleEye.jsx`,
  `client/src/design/tokens.css` (EE block lines 94–143).
- Agent 1 (competitive UX): Arccos support (Feb 2025), Garmin manuals (Big Numbers, PlaysLike),
  18Birdies/Hole19/Golfshot/SwingU/Bushnell/GolfLogix/TheGrint reviews + help centers, Apple
  Typography HIG + WWDC20, MIT AgeLab Ergonomics 2020, ESRI/Penn State halo guidance — URLs in
  session transcript.
- Agent 2 (MapLibre): maplibre-style-spec source (`parse_css_color.ts`, `color.ts`,
  `validate_color.ts`), gl-js `style.ts`/`style_layer.ts`, spec CHANGELOG 19.x, WebKit blog —
  URLs in session transcript.
- [[synthesis/eagle-eye-tokenization-plan-2026-07-02]] · [[synthesis/range-rings-dispersion-build-spec-2026-07-02]]
  (eeColor establishment) · CLAUDE.md (beta gates, framing check).


============================================================================
=== SOURCE PAGE: eagle-eye-next-level-plan-2026-06-06.md
============================================================================

---
type: synthesis
created: 2026-06-06
updated: 2026-06-06
tags: [the-match, eagle-eye, plan, gps, osm, build-plan]
---

# Eagle Eye — Next-Level Build Plan: Tap-to-Measure + Front/Center/Back Green

**Goal:** finish Eagle Eye to a standard a golfer deletes other apps for — done right from the
start, with every risk anticipated and a fallback so the worst case is "feature absent," never
"app broken." Branch: `feat/eagle-eye-upgrades`. Nothing deploys until Matt ships.

## 0. Where we are (verified this session)

- **Shipped on `feat/eagle-eye-upgrades` (commit 438bdb5), build-passing, NOT device-tested:**
  pull-to-refresh data-loss fix (course+hole persist/resume), Wake Lock, plays-like on the live
  GPS number.
- **Reliability fix lives on a separate branch** `fix/osm-mirror-only` (kumi demoted + 10s
  per-mirror timeout) — **unmerged**. This branch's OSM route is still the pre-fix version
  (verified: `eagle-eye.js` mirrors[0] = kumi, no AbortController).
- **OSM green-polygon coverage — measured (lz4 mirror, 2026-06-06):** Augusta 43, Pebble Beach 32,
  Rancho Park muni 48 green polygons; **0** node-only greens. Bethpage + St Andrews returned HTTP
  429 (rate-limited by rapid probing — operational signal, not absence). *Encouraging but a small,
  US-biased, famous-course sample; counts include practice greens, so polygon→hole association is
  mandatory.*
- **leaflet-rotate click→latlng under bearing rotation: UNVERIFIED.** Top risk for Feature A.

## 1. Guiding principles (the five axes)

- **Function:** distances must be correct or absent — never confidently wrong. Authoritative
  source order: real OSM geometry → fallback to today's single center number → never crash/NaN.
- **Usability:** glove-friendly targets (≥44px), one-glance hierarchy, sunlight-legible contrast,
  every new control clearable/obvious. No new taps required to get core value.
- **Adaptability:** works with or without GPS, with or without green polygons, on a rotated or
  north-up map, on a course OSM has barely mapped. Each capability degrades independently.
- **Security/Privacy:** no new PII; GPS stays on-device; OSM stays behind our server proxy; map
  labels rendered as text (no HTML injection); only non-sensitive values persisted (course id,
  hole #).
- **Design:** matches the Augusta-night token system (`--tm-*`), gold/green palette, the existing
  glass HUD; additions feel native, not bolted on.

## 2. Pre-build gates (MUST pass before feature code)

- **G1 — Reliability foundation.** Merge `fix/osm-mirror-only` → main, rebase
  `feat/eagle-eye-upgrades` on it, so F/C/B's server edit sits on the mirror-fixed route. Verify:
  `git log` shows the timeout/reorder in this branch's `eagle-eye.js`; build clean.
- **G2 — Broaden coverage sample.** Probe `golf=green` ways across ~12 varied courses (muni,
  international, links, obscure) with backoff to avoid 429. Verify: record %-of-holes-with-polygon;
  decide whether F/C/B is on-by-default or behind a "data available" check.
- **G3 — Resolve rotation math.** Read leaflet-rotate 0.2.8 source for `mouseEventToLatLng` /
  `containerPointToLatLng`, OR build a tiny harness logging `e.latlng` at known taps on a rotated
  map. Decide: trust `e.latlng`, or convert via `map.containerPointToLatLng`. Verify: a tap at a
  known feature returns coordinates within a few yards.
- **G4 — Device loop.** Confirm Matt can run the branch on a real iPhone (PWA or TestFlight) for
  the on-course checks I cannot run from here.

## 3. Feature A — Tap-to-Measure (BUILD FIRST; no server change)

- **A1 Live refs.** Add `gpsLiveRef` in HoleMap updated by a `[gps]` effect (handler reads current
  player pos; `livePosRef.greenPt` already live — verified :645/:725). → verify: build clean.
- **A2 Handler + marker.** `map.on('click')` drops/moves a distinct measure marker; compute
  `carry = haversine(gpsLive, tap)`, `toGreen = haversine(tap, greenPt)`; render a Leaflet
  `divIcon` label set via `textContent` (no innerHTML — XSS-safe). Tapping the marker clears it.
  → verify: build + code review.
- **A3 Lifecycle.** Clear on hole change + in the existing unmount teardown (add to the ref-null
  block). → verify: grep teardown covers `measureMarkerRef`.
- **A4 Rotation (depends on G3).** Use the G3-decided latlng path. → verify: device tap test.
- **A5 Polish (design/usability).** Marker/label styled to tokens; ≥44px hit area; no-GPS →
  show only "to green from here," never NaN; label sits in the marker pane, not under the HUD.
- **Failure register A:** stale closure → refs; tap on existing aim marker → target guard; rotation
  skew → G3; no GPS → partial readout; label z-index → marker pane; raw touch listeners → use
  Leaflet events only.

## 4. Feature B — Front/Center/Back Green (BUILD SECOND; server change)

- **B0 (=G1).** Reliability merge done first — hard dependency.
- **B1 Server, additive.** New query `type=greengeom` → `way["golf"="green"](bbox);out geom;`.
  Existing `holes`/`teegreen` untouched (zero regression). Inherits per-mirror timeout. Validate
  `type` against an allowlist. → verify: `node --check`; curl returns polygons for a known course.
- **B2 Client parse + associate.** 3rd parallel fetch; parse `way.geometry`→polygon; match each
  polygon to a hole by nearest centroid to existing `greenPositions[hole]` within a threshold
  (~40y); store `greenPolys[hole]`. **Bump OSM cache version** (precedent: commit c1fa817) so
  stale cached payloads without polys fall back cleanly. → verify: parse against saved fixtures;
  assert correct hole association.
- **B3 Compute (pure, unit-tested).** `greenFCB(player, polygon, centerPt)`: front = nearest
  vertex to player, back = farthest, center = existing centroid; player = GPS else tee;
  `<3 vertices → null`. → verify: Node unit tests on synthetic + real-fixture polygons.
- **B4 UI.** Three numbers (F/C/B) when available; big number = center; plays-like stays on center;
  **unavailable → today's single number, unchanged.** Optional front/back dots on the green. →
  verify: build + visual review against tokens.
- **B5 Coverage gate.** Per G2, only show 3 numbers when a polygon is actually matched; otherwise
  silent fallback. → verify: forced no-poly path still renders single number.
- **Failure register B:** server/mirror tangle → B0; no polygon → center fallback; wrong polygon →
  centroid threshold + skip-if-ambiguous; player off-axis (nearest≠true front) → documented v1
  approximation, flagged for on-course check; stale cache → version bump; greengeom fetch fails →
  F/C/B absent, core distance unaffected; mistagged feature → filter `golf=green` only.

## 5. Test strategy (pyramid — the "prevent anything wrong" layer)

- **Unit (many, free, run now in Node):** pure helpers — `haversineYards`, `calcBearing`,
  `computePlaysLike` (incl. wind-sign cases), `greenFCB`, polygon centroid + polygon→hole match.
  Add `client/src/pages/__tests__/eagleeye-geo.test.mjs`. Target: 100% of the geo/math helpers,
  including edge cases (no GPS, <3-vertex poly, player behind green, tie distances).
- **Integration (some):** run the OSM parser against **captured real fixtures** (save the
  Augusta/Pebble/Rancho JSON) → assert tee/green/poly counts + hole association. Catches OSM-shape
  regressions without the network.
- **Build gate (every phase):** `npm --prefix client run build` + `node --check` server.
- **Manual/E2E (device, Matt — the part I can't run):** on-course checklist in §9.
- **Coverage targets:** geo/math 100%; OSM parse covered by ≥3 fixtures; UI fallback path exercised.

## 6. Security & privacy review

- No new personal data; GPS never leaves the device (used client-side; only lat/lon already sent to
  the OSM proxy via bbox, not identity). New `type=greengeom` validated against an allowlist (no
  injection into the Overpass query beyond the existing bbox path). Map labels use `textContent`,
  not `innerHTML`. Persisted values (`tm-shared-course`, `tm-eye-hole`) are non-sensitive. No new
  secrets, no new third parties.

## 7. Rollout & rollback

- A and B as **separate commits**. Guard each feature behind a simple `const ENABLE_X` toggle so a
  problem can be switched off without a revert. Preview-deploy smoke test before merge
  (anti-pattern #11: never skip the preview check). Matt triggers all deploys.

## 8. Definition of done (acceptance criteria)

- Build + `node --check` clean; geo unit tests green; every new path has a verified fallback; no
  crash/NaN with GPS off, polygons missing, or OSM 429; commits separated; preview smoke-tested;
  on-course checklist passed by Matt.

## 9. On-course validation protocol (Matt, on a real round)

1. Tap-to-measure: tap a known sprinkler/yardage plate → carry within ~3y; rotate map → still
   correct.
2. F/C/B: compare to a scorecard/yardage book on 3 holes → within a few yards.
3. Unmapped-course path: load a course OSM barely covers → confirm graceful single-number fallback.
4. Pull-to-refresh mid-round → course + hole resume (the already-shipped fix).
5. Screen-awake holds; no crash/reload across 18 holes.

## 10. Consolidated risk register

| Risk | Likelihood | Prevention |
|---|---|---|
| Rotation latlng wrong | Med | G3 resolve before A4; device test |
| OSM green coverage thin on some courses | Med | G2 sample; silent fallback; (long-term: licensed data) |
| Server change reintroduces mirror regression | Low | G1 merge first; additive query only |
| Wrong polygon→hole match | Med | centroid threshold + skip-if-ambiguous |
| Stale OSM cache breaks parse | Low | cache-version bump |
| Off-axis front/back inaccuracy | Med | v1 nearest/farthest approximation; flagged + on-course check |
| Label XSS | Low | textContent only |
| Regression in working single-number distance | Low | additive paths + fallback + unit/fixture tests |

## Next decision for Matt

Approve the gate order (G1→G4 before feature code), then I build A, then B, unit-testing the math
as I go, committing separately, presenting diffs — no deploy.


============================================================================
=== SOURCE PAGE: eagle-eye-premium-plan-2026-06-23.md
============================================================================

---
type: synthesis
created: 2026-06-23
updated: 2026-07-02
tags: [the-match, eagle-eye, roadmap, build-plan]
---

# The Match — Premium Look & Eagle Eye Upgrade Plan

*Design audit + competitive research + prioritized roadmap. Prepared 2026-06-23.*
*Competitors referred to generically throughout (per the no-competitor-names rule).*

---

## 1. The thesis (where we win)

The category leaders each own **one** signature "wow" — a deep AI caddie + shot-tracking platform; a 3D-flyover-and-AR app; an all-in-one with the deepest plays-like panel; a no-subscription hardware play. **None** combine all four of these at once:

1. A **premium-looking, generous, ad-free free rangefinder** (rivals paywall the good stuff and stuff free tiers with ads/in-round pop-ups).
2. **Glanceable, large-type legibility** (the loudest "cheap" tells in the category are tiny fonts and one-chart-per-page clutter — golfers read this mid-round, in sun, often older eyes).
3. **Transparent, adjustable plays-like as the free default** (best science is hidden behind hardware+subscription; best UX is paywalled).
4. **Genuinely crafted polish** — haptics, motion, map cinematics, considered loading/empty states. Most rivals feel *functional*, not *crafted*.

**Eagle Eye is the hero surface that anchors all four.** The plan below makes it look obviously more expensive and high-tech than rivals, then carries that polish across the app.

---

## 2. Honest design critique — Eagle Eye today

The current screen is already **above the category's floor**: satellite map, course-up bearing, draggable aim point, tap-to-measure, F/C/B distances, a plays-like number, a glassy dark HUD, and intentional (not gratuitous) animation. That's a real foundation. But against a "looks expensive / high-tech" bar, here's where it falls short.

**First impression (2 seconds).** The landing hero (spinning dual-ring crosshair + "Know Every Yard. Play Every Shot.") is good. But the *actual* rangefinder — the thing that has to feel like a $400 instrument — currently reads as "a satellite map with a dark info card in the corner," not a designed HUD.

**Usability / hierarchy.**
- The hero distance (36px number in a corner card) doesn't dominate the way it should. On rival flagships the distance *is* the screen.
- Multiple floating controls (ANALYZE pill bottom-left, BAG toggle right edge, hole strip up top, yardage card top-left) compete without a clear spatial system.
- "Plays-like" exists but isn't transparent/adjustable — the single biggest unmet need in the category is a hero plays-like number you can break apart (wind / elevation / temp) and override.

**Visual maturity — specific tells holding it back:**
- **Raster satellite tiles** (ESRI via Leaflet). Soft on a 2× phone screen; reads as a "cheap embed" next to vector/3D-cartography rivals. *This is the #1 premium signal in the whole category and our weakest link.*
- **No cinematic map motion.** Holes pan/zoom; rivals fly *down the fairway at a pitch angle* on tee-up. That one move is the biggest perceived-quality lever available.
- **System fonts only**, no tabular-figure discipline everywhere, no "instrument" numerals for the hero distance.
- **Flat shadows / hardcoded colors** in Eagle Eye (190+ inline styles, not using the design tokens; dark theme is bespoke per element). Brittle and inconsistent.
- **Spinner/"Loading…" text**, no skeletons; no haptics; no number-roll on the live distance.

**Accessibility.** Some small text (e.g., 8px labels) on low-opacity overlays is borderline for contrast/legibility — and legibility is a *competitive feature* here, not just compliance.

**Verdict:** the aesthetic instincts are sound; the *execution* is mid-tier. The gap to "expensive" is closeable with focused work, and most of it is concentrated in the map + the hero readout.

---

## 3. The upgrade plan (phased, prioritized)

Ordered by **perceived-quality gained per hour**. Phase 0 is mostly find-and-replace and moves the needle most for least code. Each phase ships independently and is build/lint-verified per our beta discipline.

### Phase 0 — Foundation: the "expensive in an afternoon" pass (app-wide)

> **STATUS — PARTIAL** (code-verified 2026-07-02; spec: `phase0-foundation-build-spec-2026-06-30.md`). The primitives are in the codebase; the app-wide sweep + inline-style→token refactor (Phase 3 below / build-plan Phase 4.3) are NOT done. Per item: **(1) tabular numerals ☑** (verified app-wide, `tokens.css:145-146,323`). **(2) elevation + layered shadows ◐** — `--tm-shadow-layered` token + utility exist (`tokens.css:92,331`), but app-wide application unverified. **(3) palette tells ◐** — pure-`#fff`/`#000` sweep not confirmed. **(4) motion discipline ◐** — reduced-motion block present (`tokens.css:360`); full vocabulary conversion unverified. **(6) grain overlay ◐** — present on the Eagle Eye hero (`EagleEye.jsx:2014`), not confirmed on all dark surfaces. **(5) type system — DROPPED by decision** (Matt, 2026-06-30): keep the system SF Pro stack; instrument feel from size/weight/tabular + depth/motion/grain, not a typeface (removes the WKWebView font-loading risk). ⚠ The spec §7 checklist shows these `☐` and the 06-30 log says "C/D/F deferred," but the code shows the primitives landed — code above is ground truth; finish the app-wide application in Phase 3 / build-plan Phase 4.3.

These are the 80/20 wins. Low risk, high visible payoff, set the system the rest builds on.

1. **Tabular numerals on every live number** (`font-variant-numeric: tabular-nums`) — distances, scores, timers. One line; stops numbers "dancing" as they update. Highest ratio on the list.
2. **Real elevation + layered shadows.** On dark surfaces, elevation = *lighter surface*, not shadow (base `#0A0A0A`/our `#070C09` → tiered lighter surfaces). On light surfaces, replace single grey `box-shadow`s with stacked hue-tinted shadows (one consistent light direction). New tokens.
3. **Fix the palette tells:** never pure `#000` or pure `#FFF` text; desaturate accents for dark mode; verify AA contrast at each elevation. Mostly token edits.
4. **Motion discipline:** animate only `transform`/`opacity`, 200ms ease-out (`cubic-bezier(0.4,0,0.2,1)`) as the default; springs for gesture-driven moves. Makes existing motion feel intentional, kills jank.
5. **Type system:** adopt one UI sans + one mono/tabular face (strong free options exist), a single derived type scale, em-based tracking, optical sizing. The mono/tabular face becomes the "instrument" numerals for Eagle Eye.
6. **Faint grain overlay** (~8% SVG noise) on dark surfaces — removes the "flat digital" look and gradient banding.

### Phase 1 — Eagle Eye becomes the hero instrument

The showcase. This is where we visibly pass rivals.

1. **Move the map to vector + hybrid satellite (MapLibre GL).** Free, no token, premium by default: crisp vector geometry at any zoom, a **custom branded style** in our green/gold palette, satellite base with transparent vector fairway/green overlays. Retires the soft raster look. *Biggest single visual upgrade in the plan.*
2. **Cinematic hole intro:** one `flyTo` on tee-up — look down the fairway at a pitch angle (bearing tee→green, pitch ~70°), ~3.5s, reduced-motion-aware. The category's biggest "wow" for ~10 lines.
3. **Redesign the hero distance as an instrument:** large tabular/mono numeral with an **animated number roll** (odometer) + a **270° SVG arc gauge** driven by the *same spring* as the number. The distance becomes the screen, not a corner card.
4. **Premium glass HUD:** proper glassmorphism (blur + saturate + the inset top-rim highlight that actually sells it), one coherent spatial system for the floating controls instead of four competing islands.
5. **Yardage arcs from Turf.js geometry** (true ground distance, not screen-pixel circles), a **smoothly-lerped player puck** (rAF interpolation between GPS fixes, not teleporting), and a clean center reticle.
6. **Skeletons instead of "Loading…"**, plus tasteful haptics where the platform allows (Android; iOS web has none — design so haptics are never the only feedback).

### Phase 2 — Signature features that *leapfrog* (not just match)

> **Status (updated 2026-07-02):** #1 transparent adjustable plays-like, #3 own-club distance arcs, and #5 data→practice loop are **SHIPPED** (build-plan Phase 3.1/3.3/3.5). The **handicap & scoring-accuracy track** shipped (gender foundation, gender-correct ratings, Course Handicap, a WHS-faithful index rewrite, 9-hole/solo fixes) — `handicap-accuracy-audit-2026-06-25.md`. And the entire **F.5 "never lose your round" data-model rework is COMPLETE** (S1–S7 live: OCC, idempotent offline, guests→rows, row-derived readers, designated-scorer mode, rows-as-sole-store) — `build-plan-bulletproof-2026-06-23.md` Track F.5. **So scoring reliability (thesis pillar) is now best-in-class.** Remaining leapfrogs: #2 ad-free generous free tier, #4 green slope+putt-line, #6 clean AR. **UPDATE 2026-06-30 → 07-02: Phase 0 foundation is PARTIAL** (tabular numerals verified app-wide; layered-shadow token + grain-on-hero + reduced-motion primitives in code, but the app-wide sweep + inline-style→token refactor are open = Phase 4.3; custom-font item dropped by decision — keep SF Pro), and Eagle Eye accuracy advanced materially — the **plays-like coefficients were rebuilt to sourced values + a carry cap**, **Option B aim-retarget** shipped, and the **on-map segment distances were corrected to true great-circle math** (Matt verified accurate on-course). **The remaining VISUAL-FLOW + ACCURACY-polish layer:** Phase 3 app-wide polish + the Eagle Eye 190+ inline-style → token refactor (still NONE done; = build-plan Phase 4), plus accuracy refinements on the shipped GPS gate — club-arc dispersion bands, battery discipline/instant-on, the held concentric range-rings. **NOTE (marketing rule):** do **not** build a graded/±-margin confidence chip — showing an error figure anywhere was ruled out (Matt, 2026-06-30). See `next-session-handoff-2026-07-02.md`.

Each maps to a documented category gap. Sequence by appetite.

1. **Transparent, adjustable plays-like — free.** Hero plays-like number you tap to expand into wind / elevation / temperature, each individually overridable (slider + draggable compass). Best science is hidden behind hardware+sub elsewhere; best UX is paywalled. Shipping it free + transparent beats both.
2. **A genuinely generous, ad-free free rangefinder.** No in-round pop-ups, no paywalled tap-to-measure. This is the clearest wedge — it makes us feel radically more generous than every incumbent on day one.
3. **Distance arcs drawn from the player's *own* club averages** rendered on the map — personal, data-driven, visually rich (ties into the existing bag/club model).
4. **Pro-grade green view:** slope/break shading and a putt-line, ideally backed by a credible contour data source.
5. **The data → practice loop nobody closes:** turn on-course Eagle Eye + shot data into structured practice/range sessions. The biggest category-wide unmet need — a true differentiator.
6. **AR live-camera distance overlay, done cleanly** (we already have a camera/scan flow to build on) — currently the top-of-market flex.

> **UPDATE 2026-07-07:** three more of the "remaining" items above are DONE, and EE's reliability class got hardened. **Shipped 07-02→07:** club-arc **dispersion bands** (honest dispersionEllipse zones, soft feathered — no false-precision outline) + the held **concentric range-rings** (opt-in green-anchored layup arcs, white=raw-distance semantic) — both live; **EE tokenization Stage A+B** (34-token `--tm-ee-*`, pixel-identical 244/244; build-plan 4.3 now ◐ — Stage C + HoleMapGL conversion open, use the `eeColor` bridge); **AI Caddie live** on the merged SG v2 (claude-sonnet-5, answers from the player's real bag — a premium-thesis feature in production). **Reliability (invisible premium):** the 07-06 EE outage produced three structural fixes — asset-404 fallback exclusion (cache-poisoning class closed), visibility-aware map stall guard (no more spurious "check your connection" on app-switch), and the maplibre-chunk import retry validated. Battery discipline/instant-on remains the open accuracy-polish item; green slope + putt-line and clean AR remain the open leapfrogs.

### Phase 3 — App-wide premium polish

Carry Eagle Eye's bar across every screen.

- **Skeletons** on all content/map loads; **view-transition** page morphs where supported.
- **Performance as polish:** RAIL budgets (100ms input, 60fps), `content-visibility:auto` on long scorecards/history (measured ~7× render win), optimistic UI on score entry. Perf *is* premium.
- **Score-entry micro-interactions, empty states, first-run animation** — the crafted details rivals skip.
- **Consolidate Eagle Eye's 190+ inline styles** into a small `<Sheet>`/HUD component set on tokens — *◐ Stage A+B done 2026-07-06 (EagleEye.jsx on `--tm-ee-*` tokens, pixel-identical); HoleMapGL + Stage C open* — pays down the brittleness the audit flagged and keeps the new look consistent.

---

## 4. Effort vs. impact — recommended sequencing

| Phase | Effort | Visible impact | Risk |
|---|---|---|---|
| 0 — Foundation tokens/type/motion | Low | High (whole app feels tighter) | Low |
| 1 — Eagle Eye hero (MapLibre, flyTo, arc gauge, glass HUD) | Med–High | **Highest** (the showcase) | Med (map migration) |
| 2 — Leapfrog features (plays-like, free rangefinder, own-club arcs, greens, practice loop, AR) | High | High + strategic moat | Med–High |
| 3 — App-wide polish + refactor | Med | High (consistency) | Low–Med |

**Recommendation:** do **Phase 0 first** (fast, derisks everything), then the **MapLibre + cinematic flyTo + instrument hero distance** slice of Phase 1 as the flagship demo, then pick Phase 2 features by appetite. The map migration is the one genuinely meaty engineering item and the single biggest look upgrade — worth staging carefully (keep the current Leaflet path behind a flag until the MapLibre path is device-tested).

---

## 5. Decisions I need from you

1. **Scope of the first build** — Phase 0 only (quick, safe, whole-app lift), or Phase 0 **+** the Eagle Eye map/hero slice (the flagship)?
2. **Map migration appetite** — green-light moving off raster Leaflet to vector MapLibre? It's the biggest look win but the biggest single change.
3. **Free vs. paid line** — are we committing to "generous, ad-free, plays-like-included free tier" as the strategic wedge? It shapes what goes where.
4. **Which Phase 2 leapfrog** excites you most (transparent plays-like / own-club arcs / green slope+putt-line / data→practice loop / AR) — I'll sequence around it.
5. **Brand fonts** — OK to introduce a UI sans + mono "instrument" pair (free web fonts), or keep system fonts?

Give me direction on these and I'll turn the chosen slice into a concrete, build-ready spec and start shipping it through the beta with the same test-and-audit discipline as today.


============================================================================
=== SOURCE PAGE: sg-map-tap-capture-build-spec-2026-07-02.md
============================================================================

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
