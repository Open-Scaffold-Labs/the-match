---
type: synthesis
created: 2026-07-16
updated: 2026-07-16
tags: [rounds, stats, partial-rounds, averages, scoring, build-spec]
---

# Partial Rounds — Holes-Played-Aware Stats · Build Spec (2026-07-16)

**Status:** SPECCED — next build. Not started.
**Origin:** Matt, 2026-07-16, immediately after the scoreless "-71" bug fix (`35bf692`):
*"if a person only keeps score for some holes and not all, is the app capable of only
counting the holes with scores… so it averages it out for the holes played and not
against all 18 holes?"*
**Companion:** the -71 fix (log `## [2026-07-16]`) — that fix rejects ZERO-score saves;
this spec makes PARTIAL (some-holes) rounds first-class citizens of the stats system.

## 1 · Thesis

The data model already knows which holes were played (`scores[i] > 0` = played; 0 =
no score — a golfer can never take 0 strokes, so 0 is unambiguous). What's missing is
that every aggregate treats `total` as a full-round score. A 47-thru-10 today would
drag Avg Score down like a full-round 47, could become "Best Round," and renders as
a nonsense to-par (−24). The fix is par-relative, holes-played-aware math in ONE
shared library used by every reader — not three parallel reimplementations.

## 2 · Definitions (canonical, used everywhere)

- **Played hole:** `Number(scores[i]) > 0`.
- **Full round:** every hole of the course scored (`playedCount === scores.length`,
  length 9 or 18). A full 9-hole-course round is FULL, not partial.
- **Partial round:** `1 ≤ playedCount < scores.length`.
- **Qualifying round (for averages):** `playedCount ≥ 9`. Below 9 holes a round is
  display-only ("thru 5") — never enters any aggregate. Rationale: sub-9 samples are
  statistical noise and align with the WHS 9-hole posting floor.
- **par_played:** sum of `hole_pars[i]` over played holes. When `hole_pars` is null
  (legacy rows only — solo sends it since migration 027, outing full rounds imply
  par_played = course_par), pro-rate: `course_par × playedCount / scores.length`.
- **to_par_through:** `total − par_played`.
- **equiv18 (18-hole-equivalent score):**
  `round( (to_par_through / playedCount) × 18 + par18, 1 )` where `par18` =
  `course_par` for an 18-hole course, `course_par × 2` for a 9-hole course.
  For a full 18-hole round equiv18 === total (exactly — parity gate, see §7).

## 3 · Current-behavior audit (verified in code this session)

| Consumer | File | Today | Partial-safe? |
|---|---|---|---|
| Recent Rounds list | `rounds.js` GET | raw total, client renders vs course_par | ✗ shows −24-style nonsense |
| Avg Score / Best / roundCount | `stats.js` /summary | mean/min of raw totals (already mixes 9-hole rounds raw — pre-existing wrongness) | ✗ |
| 3-RND AVG | `profile.js` avg3 | mean of last-3 raw totals | ✗ |
| Friend profile avg3/avg/best/trend | `friends.js` :friendId/profile | mirrors the above | ✗ |
| Friends activity feed | `friends.js` GET / (line ~64) | `diff = total − COALESCE(course_par,72)` in SQL | ✗ (no total>0 guard either — the -71 would have shown here too) |
| Trend chart | client `HcpBadge` via GET /rounds | plots raw totals | ✗ |
| Handicap | `lib/handicap.js` | `isRoundCompleted` = 9+ holes ALL scored → partials excluded; full 9-hole rounds post via WHS-2024 expected-score (`nineHoleDifferential`); 10–17 deliberately excluded | ✓ already correct-by-exclusion |
| Achievements | `lib/achievements.js` | round tiers gate on `filled === 18`; hole-level fire per scored hole | ✓ verified |
| Season W/L/T + weekly streak | `profile.js` | counts rounds/dates, not totals | ✓ (a partial round still counts as playing that week — intended) |
| SG engine | `lib/sg` | per-hole facts, skips holes without data | ✓ expected — pin with test (§7) |
| Practice signals | `lib/practice` via `practice.js` loader | per-hole analysis | ? — must verify 0-score holes are skipped, pin with test |
| Leagues/CSV/h2h | outing rows, not tm_rounds | n/a | ✓ unaffected |
| Outing `/end` recorder | `outings.js` ~2298 | records ONLY all-holes-scored rounds; a 15-of-18 match round vanishes from stats entirely | ✗ by omission (see D5) |

## 4 · Design decisions

**D1 — No migration.** `scores` zeros already encode played/unplayed. Everything else
is derived at read time. (Nothing new persisted ⇒ nothing to backfill, nothing to
drift.)

**D2 — ONE shared library: `server/src/lib/roundMath.js`.** Exports
`playedCount(scores)`, `parPlayed(scores, holePars, coursePar)`,
`toParThrough(round)`, `equiv18(round)`, `isFullRound(round)`,
`isQualifying(round)`. Every route (stats, profile, friends, rounds) imports it.
The three-copies-of-the-same-average pattern is exactly how the -71 bug got four
reader surfaces — never again. All functions `Number()`-coerce inputs (pg NUMERIC
arrives as string — established trap, see Hub conventions) and are divide-by-zero
safe (`playedCount ≥ 1` guaranteed by the save guard, but the lib still returns
null rather than NaN).

**D3 — Display.** Full rounds render exactly as today (pixel parity). Partial cards:
**"47 thru 10"** with to-par vs par-played (**+5**), everywhere a round renders
(Recent Rounds, friend profile list, friends activity feed with `thru N` label,
RoundScorecard header). Unscored holes already render "—" on reopen — unchanged.

**D4 — Averages become 18-hole-equivalent and par-aware.**
- **Avg Score** (stats /summary) and **3-RND AVG** (profile avg3, friends avg3):
  mean of `equiv18` over qualifying rounds (≥9 played). Partials count, normalized
  to holes actually played — Matt's ask. Side effect (a FIX, called out at release):
  full 9-hole-course rounds stop polluting the average as raw 45s.
- **UI label:** Avg tile `sub` becomes "per 18 holes" so the semantics are honest.
- **Best Round:** FULL rounds only, real totals only — never equiv18 (a record is a
  real score, not an extrapolation). If the min comes from a 9-hole full round,
  label "(9)". Partials never set records.
- **roundCount:** all saved rounds (a partial round is still a round you played).
- **Trend chart:** plots the same `equiv18` series as Avg (one definition), raw
  "thru N" in the tooltip for partials.

**D5 — Outing `/end` records partial rounds too.** Guard changes from "9+ holes,
every hole > 0" to `playedCount ≥ 9`. A 15-of-18 match round becomes a stats
citizen exactly like a solo partial (Matt doctrine: "solo rounds function exactly
the same as any other round" — symmetric obligation). No-shows are untouched
(0 played → still skipped); withdrawn players typically fall under 9 played and
stay excluded by the same threshold. Putt/shot facts on unscored holes must be
re-cleaned to null on the recorded row (verify `cleanPuttArraysForRound` /
`cleanShotsForRound` treat score-0 holes as no-data holes — pin with tests).

**D6 — Handicap: UNTOUCHED in v1.** Partials (10–17 played) remain excluded from
posting — today's behavior, correct under the engine's current WHS stance. The
sacred path gets a parity test pinning that this build changes zero differentials.
**Tier-2 (separate session, flag `HANDICAP_PARTIAL_POSTING`):** treat a round with
exactly 9 played holes as a 9-hole posting (extract played holes + pars →
`nineHoleDifferential`), and optionally 10–17-hole posting per WHS 2024
expected-score-for-remaining-holes. Requires a before/after recompute comparison on
real prod data before the flag flips — same discipline as the F.5 flags.

**D7 — Solo save UX (the accidental-partial failure mode).** The summary screen must
make partial state impossible to miss: a banner "12 of 18 holes scored", unscored
holes visually flagged in the grid and tappable (jump back to that hole), and the
button reads **"Save partial round"** (vs "💾 Save Round" when full). The 2026-07-16
zero-score guard stays as the floor (0 scored → button disabled). This is the
defense against "forgot hole 7, round silently stops counting toward Best/handicap."

**D8 — API shape.** Server computes and ships `holes_played`, `par_played`,
`to_par_through`, `is_partial` on GET /rounds and the friend-profile rounds so no
client ever re-derives them differently. Client never does par math on its own.

## 5 · What could go wrong — failure-mode register

1. **Three implementations drift** → D2's single lib; ESLint-able rule of thumb: no
   route computes an average from `r.total` directly anymore.
2. **NUMERIC-as-string** (pg) breaks math silently → lib coerces; tests feed strings.
3. **Divide-by-zero / NaN into JSON** → lib returns null; UI renders "—".
4. **hole_pars null on a partial** → pro-rate fallback (D2); only reachable for
   hypothetical legacy rows — today's partials always carry pars (solo sends them;
   outing partials get outing hole_pars — include in the `/end` INSERT, currently
   NOT in the column list: add `hole_pars`/`hole_handicaps` to the outing-round
   INSERT so D5 rows are self-sufficient).
5. **Forgot-one-hole accidental partial** → D7 UX.
6. **Sub-9 noise wrecking 3-RND AVG** → qualifying floor (≥9).
7. **9-hole course vs 9-of-18 partial conflated** → definitions in §2 key off
   `scores.length` (course size) vs `playedCount`; equiv18 handles both; tests pin.
8. **Best Round set by an extrapolation** → D4: records = real full totals only.
9. **Existing users' numbers shift on deploy** → parity gate (§7): for a corpus of
   full 18-hole rounds, new Avg/Best must equal old to the cent BEFORE push; the
   only sanctioned changes are (a) partials appearing, (b) 9-hole rounds
   normalizing — both called out to Matt at ship.
10. **Handicap regression via shared helpers** → v1 imports nothing new into
    handicap.js; parity test pins all fixtures' differentials byte-identical.
11. **Putt/shot facts on unscored holes leak into SG** → re-clean verification +
    tests (D5).
12. **Offline replay of old queued partial saves** → server guard is ≥1 played
    (already shipped); idempotency keys unaffected.
13. **Friends activity feed diff in SQL can't do par-played** → move the diff
    computation from SQL into JS via roundMath (the row already carries what's
    needed; add `scores`/`hole_pars` to that SELECT).
14. **Achievements** → already gated on filled===18; add regression tests so a
    partial 47 never awards breaking_100.

## 6 · Slices

- **S0** `lib/roundMath.js` + exhaustive vitest (strings, 9-hole course, missing
  pars, 0/1/8/9/17/18 played, null shields). *Verify: unit tests green.*
- **S1** Server readers on roundMath: stats /summary (avg/best/roundCount),
  profile avg3, friends profile (avg3/avg/best + rounds payload fields), friends
  activity (JS diff + thru), rounds GET (+D8 fields). *Verify: route tests with a
  mixed full/partial/9-hole fixture set; parity fixtures for full-only corpus.*
- **S2** Client: Recent Rounds + friend list + activity cards render "thru N / +X";
  trend chart on equiv18 series with raw tooltip; Avg tile sub "per 18 holes";
  Best "(9)" label case. *Verify: 390px viewport walk, full rounds pixel-parity.*
- **S3** Solo summary partial UX (banner, flagged holes, jump-back, "Save partial
  round"). *Verify: browser walk — full, partial, zero flows.*
- **S4** Outing `/end`: guard → `playedCount ≥ 9`; add hole_pars/hole_handicaps to
  the INSERT; fact re-clean on unscored holes pinned by tests. *Verify: e2e outing
  with a 12-hole player → round recorded, handicap unchanged, ceremony unaffected.*
- **S5** Prod parity run: script computes old-vs-new Avg/Best for every user on
  real data; diff must be exactly the sanctioned classes in §5-9. Then build +
  lint + push per beta rules.
- **Tier-2 (NOT this build):** `HANDICAP_PARTIAL_POSTING` per D6.

## 7 · Test plan (gates, not suggestions)

Unit (S0), route (S1), e2e (S4) as above, plus: handicap parity (all existing
handicap fixtures produce identical differentials/indexes with the branch merged);
SG indifference (a partial round's unscored holes contribute zero SG facts);
achievements regression (partial never awards round tiers). The S5 prod parity run
is the final gate before push — same discipline as F.5 S5's 45/45 row-vs-state
verification.

## 8 · Open decisions for Matt (defaults chosen, flag if wrong)

1. Avg Score labeled "per 18 holes" and includes ≥9-hole partials normalized — the
   direct read of his ask. **Default: yes.**
2. Sub-9-hole rounds are display-only, in no averages. **Default: yes.**
3. Outing partial recording at the same ≥9 floor (D5). **Default: yes.**
4. Tier-2 handicap partial posting deferred behind a flag. **Default: deferred.**
