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
