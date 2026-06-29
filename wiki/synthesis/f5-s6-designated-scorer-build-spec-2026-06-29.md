---
type: synthesis
created: 2026-06-29
updated: 2026-06-29
tags: [the-match, f5, scoring, designated-scorer, conflict-ux, build-plan, s6]
---

# F.5 S6 — Designated-scorer mode + conflict-UX polish (build spec)

*Grounded in the existing code (markers system + permission gate + S2 conflict chip + client `isMarkerFor`/`canEdit`) and market research on how the field handles group scoring. Sources in the session record.*

## Strategic frame (what the research says to beat)

The field's designated-scorer is **implicit** (whoever holds the code / created the round). Three whitespaces nobody fills well:
1. **No visible "you're scoring for this group" indicator** — the #1 unspoken confusion.
2. **No real mid-round scorer hand-off** — apps degrade to "let everyone write," which causes conflicts.
3. **No explicit conflict reconciliation** — the best incumbent (TheGrint) does silent last-write-wins.

The Match already ships #3 (the S2 inline chip beats the whole field) and already has the plumbing for designated scoring (`state.markers`, `PUT /:code/markers`, marker-aware gate, client `isMarkerFor`). S6 turns that plumbing into a real *enforced mode* and fills #1 and #2.

## What already exists (don't rebuild)
- `state.markers = [{ marker_id, member_ids[] }]`; host-only `PUT /:code/markers`; assignment UI in Commissioner.jsx; client `isMarkerFor(user,target)` + `isMarker`.
- `/scores/host` gate = `isHost || isExplicitMarker || isSameGroup`. **Markers only ADD permission today** — the same-group bypass means anyone in the foursome can already score anyone, so markers don't *restrict* anything.
- Client already gates editing OTHERS by `canEdit = isHost || isMarkerFor` — so the same-group bypass is a server-side gap, not a client affordance.
- S2 conflict chip handles scorer-vs-self divergence (names who entered, Keep mine / Keep theirs, silent converge on equal).

## Decision (Matt): non-scorers CAN still self-score
Designated mode restricts scoring OTHERS to host + assigned scorer; every player always keeps their own card via `PUT /:code/scores` (untouched). A scorer-vs-self conflict on the same player reconciles via the S2 chip. Nobody is ever locked out of fixing their own score.

## Build

### Server (flag `SCORING_DESIGNATED`, default off)
1. `PUT /:code/scoring-mode` (host-only) → `state.scoring_mode = 'open' | 'designated'` (default absent = `'open'`).
2. `/scores/host` gate: when `SCORING_DESIGNATED && state.scoring_mode === 'designated'`, permission becomes `isHost || isExplicitMarker` — **drop the `isSameGroup` bypass**. Otherwise unchanged. With the flag off, `scoring_mode` is ignored entirely ⇒ current behavior everywhere. Per-outing opt-in + global flag = double safety, fully reversible.
3. The self path (`PUT /:code/scores`) is NOT touched — players always self-score.

### Client (LiveOuting.jsx + Commissioner.jsx)
4. **Host mode toggle** in Manage/Groups: "Anyone in group" vs "Designated scorer". Choosing designated surfaces the existing marker-assignment UI to pick a scorer per group.
5. **"You're scoring for this group" banner** — shown to a designated scorer (designated mode + I'm a marker). The whitespace differentiator.
6. **Scorer badge** on the scorecard/leaderboard next to the group's scorer.
7. **Mid-round hand-off** — "Make X the scorer" reassigns the marker via the existing `PUT /:code/markers`. The dead-phone fix nobody ships.
8. Native-feel: ≥44px targets, safe-area aware, on-brand (Augusta-night/fairway/trophy-gold), 60fps, no broken empty states.

## What S6 deliberately does NOT do
- Does NOT change default behavior (open mode = today; designated is opt-in + flag-gated).
- Does NOT lock self-scoring (Matt's decision).
- Does NOT touch the dead `/scores/marker` endpoint (S7 removes it).
- Does NOT add attestation/certification (a later, separate feature if wanted).

## Verification plan
- **Sandbox Postgres / HTTP:** in designated mode, a same-group non-marker is **blocked (403)** from scoring another player; host + assigned marker **succeed**; self-score via `/scores` always succeeds; with the flag off OR mode 'open', same-group scoring works exactly as today (no regression). Hand-off (reassign marker) flips who can score.
- **Live beta e2e** with real accounts (host + scorer + non-scorer), then clean up.
- **design-critique skill** on the assign-scorer flow + banner/badge (hierarchy, the "who's scoring" clarity, tap targets, empty/edge states).
- **audit-before-claim** pass; gate (`node --check` + lint + tests); ship behind flag; docs.

## Failure-mode register

| Risk | Mitigation |
|---|---|
| Designated gate locks everyone out (no marker assigned for a group) | Host can ALWAYS score; client prompts host to assign a scorer when designated + a group has none |
| Default behavior changes / casual outings break | `scoring_mode` defaults 'open'; global `SCORING_DESIGNATED` flag gates enforcement; both off ⇒ identical to today |
| Player can't fix their own score | Self path untouched — every player always self-scores |
| Scorer's phone dies, group stuck | Hand-off action reassigns the scorer (host or — optional — group can) |
| Two people (scorer + self) enter the same hole | S2 conflict chip reconciles (names who, Keep mine/theirs, silent converge on equal) |
| Stale marker after group changes | Markers keyed by user_id; reassign via existing endpoint; host owns it |
| Confusion about who's scoring | Visible banner + badge (the research's #1 gap) |
