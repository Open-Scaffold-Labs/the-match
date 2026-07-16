# Game Day Strategy (GamePlan) — Build Spec

**Date:** 2026-07-15 · **Author:** Dale Raaen (via Claude session)
**Status:** Proposed — strategy memo: `~/Projects/The-Match-GameDayStrategy-Strategy.docx`
**Companion:** `voice-interface-build-spec-2026-07-15.md` (Phase-2 tee brief reads GamePlan)

## Thesis

SG run **forward**. The same E[lie, distance] tables that grade shots after the
fact price decisions before it: for each candidate plan on a hole, place the
player's dispersion ellipse over the course geometry, weight each landing
outcome by expected strokes, lowest sum wins — for *this* player's dispersion,
miss pattern, and short game. Amateurs leak strokes to bad plans, not just bad
swings; no competitor addresses that layer before the round.

Deliverable to the golfer: night-before push → hole-by-hole plan cards
(club · aim · avoid · expected range) + front-page "three holes that decide
your round."

## Engine — three layers

**Layer 1 — deterministic optimizer (`server/src/lib/gameplan/`).**
Per hole: enumerate candidates = (real tee clubs in range × aim corridors) ×
downstream choices (attack / layup-to-best-wedge / fat-side bail). For each:
dispersion ellipse (clubModel: 5% SD, short-skew 1.3) oriented by
`shot_shape`/`typical_miss`, discretized over OSM lie polygons → Σ p(outcome) ×
E[lie, dist] from the calibrated band baselines. Lowest expected strokes wins;
margin over runner-up = **conviction** (< ~0.05 → label "either way").
Pure math, no AI in the numbers, unit-tested with SG-lib-style invariants
(same philosophy as the open-design-studio deterministic judge). No Monte
Carlo needed — discretized integral is stable and milliseconds-fast.

**Layer 2 — Claude narrative.** Existing Caddie plumbing (PLAYER PROFILE +
`sgPromptBlock`). Input: winning plan + why-numbers per hole. Output: hole
cards, front-page summary (3 decisive holes, the leak this course punishes),
tone by mode (medal / net match / money game). Claude explains and
prioritizes; never overrides arithmetic.

**Layer 3 — learning loop.** Post-round, replay voice-captured shot facts
against the plan → **SG: Discipline** (strokes vs. your own plan), override
scoring, dispersion feedback. Surfaces on Stats next to the SG card; feeds
Practice and next GamePlan.

## Inputs (all existing)

| Input | Source |
|---|---|
| Personal E[lie, dist] tables | `server/src/lib/sg/baselines.js` (band-calibrated) |
| SG category profile + APP buckets | `server/src/lib/sg/index.js` |
| Tendencies (shape/miss/distance) | `tm_users` (migration 040) |
| Real bag + dispersion | `tm_user_clubs` + `client/src/lib/clubModel.js` |
| Course history per hole | `tm_rounds` (course_id, scores/shots/putt facts) |
| Hole geometry | OSM (hole lines + green polygons; hazards inconsistent) |
| Yardage/par/SI per tee | GolfCourseAPI (courses.js) |
| Plays-like inputs | USGS elevation cache + tee-time weather |
| Stroke allocation (net modes) | `server/src/lib/handicap.js` |

**Never-fabricate rule (Matt, 2026-06-25) applies.** Degradation ladder, always
visible on the card: full data → full optimizer · no bag distances →
band-typical heuristics + "enter distances" prompt · thin SG history →
band tables + onboarding tendencies · no geometry → yardage/par/SI plan
("your stroke holes are 4, 7, 12 — bogey is net par there").

## Net-mode planning

When the day's game is net (match or Saturday bet), plan to **net par** using
existing Course Handicap stroke allocation — attack/position often flips on
stroke holes. Aggressiveness dial (Conservative / Standard / Send It)
re-weights expected-strokes vs. variance in the objective; it never fakes
different arithmetic.

## Phases

**0 — Heuristic GamePlan (1–2 wks).** No geometry engine. New
`GET /api/v1/gameplan?courseId&tee&mode` composes via Claude from DB-resident
data (SG profile, APP buckets, tendencies, course history, SI, tee-time
weather). GamePlan page + night-before push (tee-time sheet gives the
trigger). *Accept:* Friday group opens it and reports a changed decision.

**1 — Geometry optimizer (3–4 wks).** Layer 1 in `server/src/lib/gameplan/`,
candidates + conviction, tests green. Claude narrates optimizer output —
same surface, better inputs. *Accept:* plans beat naive-play baseline in
simulation; numbers reproducible run-to-run.

**2 — Learning loop (2 wks).** SG: Discipline on Stats; override memory;
dispersion feedback. *Accept:* discipline metric computes on real rounds
end-to-end from voice-captured facts.

**3 — Voice + tier (2 wks).** Tee brief reads the hole card (voice spec hook);
aggressiveness dial; net-match mode; Elite gating with Pro teaser card.

## Follow-ups

- **Weather as a first-class endpoint input (Dale, 2026-07-15).** The plan
  should take the tee-time forecast as an input to `POST /api/gameplan` and
  reason about how conditions change the day — **wind above all** (direction
  vs. each hole's bearing → plays-like shifts, club changes, aim-line
  re-weighting; a two-club crosswind can flip attack→position on its own),
  plus rain (softer greens = more attackable, less roll = longer effective
  yardage, wet rough penalty up) and temperature (carry distance). Sources
  already wired: tee-time forecast via the eagle-eye weather path + USGS
  elevation cache; hole bearings derivable from OSM hole lines. Surface:
  weather line in the fact blocks (Phase 0), wind-adjusted candidate pricing
  in the Layer-1 optimizer (Phase 1), and a "conditions changed since you
  planned" morning re-check push. Not yet built — Phase 0 shipped without a
  weather input.

## Risks

- Bad plans burn trust → conviction margins + "either way" honesty + Layer 3
  catches systematic misses within a few rounds.
- OSM hazard gaps → degradation ladder now; June course-data provider upgrade
  (iGolf/GolfLogix/Golf Intelligence memo) raises the floor globally later.
- Empty bag/history → the card sells the fix (activation prompt, not a wall).
- Cost: one Sonnet composition per player per round-eve — single-digit cents.
