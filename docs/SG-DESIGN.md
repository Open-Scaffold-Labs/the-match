# Strokes Gained — Design

**Status:** Proposed · **Author:** Dale Raaen · **Date:** 2026-06-06
**Branch:** `feat/strokes-gained` (fork: `draaen-osl/the-match`; ported to `feat/sg-v2` 2026-07-02 — migrations renumbered 039/040)

## Why

The white paper slots Strokes Gained as a V2 / P2 item and argues (§ line 58) that
golfers care about beating their buddies, not analytics dashboards. Both things are
true, and this design resolves them: SG is table stakes for the Elite tier's
credibility with serious amateurs, it is the single highest-value input the AI
Caddie can have, and — the on-thesis move — **SG head-to-head** ("where do you gain
and lose strokes against *this* rival") is a feature no competitor has. SG here is
not a dashboard; it is fuel for the rivalry system and the Caddie.

## Core principle: store facts, compute SG at read time

SG is never persisted. Each shot is stored as observable facts; SG against any
baseline is arithmetic at query time.

```
shot = {
  club:  "7i",            // existing
  gps:   {lat, lng},      // existing
  dist:  164,             // existing — distance the ball traveled
  lie:   "fairway",       // NEW — tee | fairway | rough | sand | recovery | green
  toPin: 178              // NEW — distance to hole BEFORE the shot (yds; ft on green)
}
```

This makes the baseline toggle free, lets baselines be refined without data
migration, and keeps the write path ignorant of SG entirely.

`toPin` is computable today for most shots (shot GPS × OSM green center — the
`gpsToGreen` path already exists). `lie` is the genuinely new capture (below).

## Baselines: versioned JSON, user-selectable

```
server/src/lib/sg/baselines/
  tour.v1.json          // PGA Tour expected strokes (Broadie published tables)
  scratch.v1.json
  hcp-5.v1.json
  hcp-10.v1.json
  hcp-15.v1.json
  hcp-20.v1.json
```

Each table maps `(lie, startDistance) → expectedStrokes`, with distance buckets
(tee: per 25 yds; fairway/rough/sand: per 20 yds down to 10, finer inside 50;
green: per foot to 10 ft, then buckets). Linear interpolation between buckets.

**Toggle** (the headline UX decision): the user chooses the comparison baseline.

- Default: **same-handicap band** (auto-selected from the user's index) — right
  psychology for the median user, per the white paper's own argument.
- Toggle to **Tour** for the serious-amateur crowd. Persisted per-user
  (`tm_users.sg_baseline`, values `auto | tour | scratch | hcp-N`).
- Tier gating: same-handicap SG in **Pro**; Tour baseline + SG-vs-rival in **Elite**.

The Caddie and every UI surface must **name the baseline in the same breath as the
number** ("−2.1 putting vs a 10-handicap"). Silent baseline mixing is how SG
numbers lose user trust.

## The math

Per shot: `SG = E[strokes from start] − E[strokes from result] − 1`
(holed shot: `E[result] = 0`; penalty: result includes the stroke).

Categories follow the PGA Tour / Broadie conventions exactly — this is the part
that makes the stat "speak the official language":

| Category | Definition |
|---|---|
| SG: OTT | Tee shots on par 4s and 5s |
| SG: APP | Approach shots, excluding tee shots on par 3s ≤ 30 yds and shots within 30 yds |
| SG: ARG | Shots within 30 yds of the green edge, off the green |
| SG: P   | Shots on the putting green |
| SG: T2G | OTT + APP + ARG (derived) |

**Naming/IP note:** the methodology and the SG category names are Broadie's
published, freely usable framework. The PGA Tour's ShotLink *data* is proprietary.
Copy may say "the same Strokes Gained methodology used in PGA Tour statistics";
it must never imply official PGA Tour data or affiliation.

## Capturing `lie` and putts (the two data gaps)

1. **Lie**: one extra tap on the existing shot-log UI — five chips
   (Tee auto-set on shot 1; Fairway / Rough / Sand / Green). Inference assist:
   OSM courses often carry `golf=fairway` / `golf=bunker` / `golf=green` polygons;
   when present, pre-select the chip from the shot GPS and let the user correct.
   Coverage varies by course — inference is an assist, never the source of truth.
2. **Putting**: GPS is too coarse on greens. Capture `putts` per hole (already a
   one-tap pattern in scoring UIs) plus **first-putt distance** as a quick chip
   (inside 3 ft / 3–10 / 10–25 / 25+). That is enough for credible SG: P against
   bucketed baselines without pretending to foot-level precision.

Rounds logged without lie/putt data simply produce no SG for those categories —
no fake numbers. The Stats page shows SG coverage ("SG available for 12 of 20
rounds") so users understand why logging matters.

## Rollout phases

1. **SG: P + SG: T2G composite** — needs only putt count + first-putt distance.
   Lowest friction, immediately credible, ships the baseline architecture,
   the toggle, and the schema delta. **SHIPPED 2026-06-06** (commits c66d350,
   22a4d4f).
2. **Full four-category** — lie + distance-to-pin on the shot sheet;
   ARG/APP/OTT split with the complete-chain gate
   (`shots.length + putts === score`, no fake numbers). **SHIPPED 2026-06-06.**
   OSM lie-inference assist deferred to a follow-up (chips-only capture first;
   measure real-world logging friction before building inference).
3. **Integration** — SG profile block in the AI Caddie system prompt
   (alongside club distances), SG-vs-rival cards in the H2H system, and the
   Elite-tier gates. **SHIPPED 2026-06-06**, expanded with Dale's
   player-tendency questions:
   - `sgPromptBlock()` + `appBucketBreakdown()` (worst-APP-bucket callout,
     ≥5-shot sample floor) wired into Eagle Eye's system prompt via
     `buildPlayerProfile()` — fail-soft, omits unknowns, never fabricates.
   - **Player tendencies** (migration 029): `shot_shape` (draw/fade/straight),
     `typical_miss` (left/right/both), `distance_miss` (short/long/pin_high) —
     captured in a new OPTIONAL onboarding step ("How does your ball fly?",
     not added to BLOCKING_STEPS), editable via profile/update, and fed into
     the same prompt block ("aim opposite the typical miss, club up when the
     player runs short").
   - `GET /api/stats/sg/rival/:userId` — Elite-gated (effective-Elite =
     tier OR live elite_until), relationship-gated (accepted friendship or
     H2H record), both players against the viewer's SAME concrete baseline.
     `SgRivalCard` on FriendProfile renders the comparison, an Elite upsell
     on 402, or nothing.
   - Tour-baseline Elite gate wired but OFF (`GATE_TOUR_BASELINE_BEHIND_ELITE
     = false` in stats.js) until billing goes live — flip it then.

## Schema / API delta

> **Implementation note (2026-06-06):** putt facts shipped as PARALLEL ARRAYS
> (`tm_rounds.putts`, `tm_rounds.first_putts`) rather than restructured score
> entries — matches the existing scores/hole_pars number-array convention and
> leaves every consumer of `scores` untouched. Shot facts DID ship as additive
> keys on the shot objects as designed.

- `tm_rounds.shots` JSONB entries gain `lie` + `toPin` (additive; old rounds valid).
- `tm_rounds.putts` + `tm_rounds.first_putts` JSONB parallel arrays (migration 039).
- `tm_users.sg_baseline` TEXT DEFAULT 'auto' (migration 039).
- New `server/src/lib/sg/` — pure functions: `expectedStrokes(baseline, lie, dist)`,
  `shotSG(baseline, shot, nextShot)`, `roundSG(baseline, round)`. Unit-tested
  against Broadie's published worked examples.
- `GET /api/stats/sg?baseline=` — per-category aggregates (last 20 rounds, trend),
  plus per-round breakdown. Read-only; computed on demand; cache by
  `(user, baseline, latest round id)`.

## AI Caddie contract

The Caddie prompt receives a compact SG block:

```
SG (last 20 rounds, baseline: hcp-10):
OTT +0.4 · APP −1.8 (worst: 150–175 yds, −0.9) · ARG −0.3 · P −2.1 (3–10 ft: 61% make vs 78% baseline)
```

Worst-bucket detail is what turns the Caddie from generic to personal
("lay back to 120 — your 150–175 approach is your biggest leak").

## Open questions

- Which published amateur baseline tables to adopt verbatim vs. fit ourselves
  once we have enough user shot data (long-term: our own amateur baselines are
  a data moat).
- First-putt distance UX: chips vs. tap-on-green-map.
- Whether SG-vs-rival compares both players to the shared baseline (recommended:
  yes — difference of SG, not head-to-head expected strokes).
- Course-length normalization beyond distance-keyed tables: deliberately out of
  scope (no per-course fudge factors).

## Research notes (added 2026-07)

- **SG: Putting is noisy in small samples.** Brill & Wyner (2025), an empirical
  Bayes analysis of PGA Tour data, find putting skill nearly indistinguishable
  from noise even for pros ([arXiv:2506.21822](https://arxiv.org/pdf/2506.21822)).
  Implication: gate SG: Putting displays (and especially SG-vs-rival putting
  comparisons) behind a minimum round count, and have the Caddie hedge putting
  conclusions harder than tee-to-green ones.
- **Approach is where strokes live.** Broadie's handicap-level data: approach
  play is the largest gap at every level (~1.5 strokes lost for scratch vs.
  ~7.5 for a 20-handicap). Prioritize APP bucket quality and Caddie messaging
  accordingly.
- **Amateur baseline candidate.** Shot Scope's 2025 Performance Report (870K
  rounds, 74M shots, benchmarks by scoring bracket) is a citable published
  amateur baseline — relevant to the open question above about adopting
  published tables before we can fit our own.
