# Swing Intelligence — Build Spec (video AI + optional launch-monitor stats)

**Date:** 2026-07-16 · **Author:** Dale Raaen (via Claude session)
**Status:** Approved direction — strategy: `~/Projects/The-Match-SwingIntelligence-Strategy.docx`
**Scope decision (Dale):** ONE module. Video analysis is the core; launch-monitor
statistics are an OPTIONAL second stream that enriches it. Never required.

## Thesis

Every swing-video product grades faults with no outcome data (Mustard scored a
Tiger swing 9.3/10). Nobody joins swing video to strokes gained — 18Birdies has
both halves, unjoined. The Match builds the join: **swing (video body metrics)
→ ball (optional monitor stats) → score (SG facts we already have)**, narrated
by the existing Caddie, anchored to the round loop. Architecture rule from the
research: pose-model + LLM narrator — an LLM never watches video directly
(vision-LLMs demonstrably hallucinate faults).

**Founding dataset:** Dale's multi-year range archive — self-video filmed
alongside launch-monitor sessions (club head speed etc.), with swing duration
tracked deliberately throughout. The join exists in his archive already; V0
validates video-derived metrics against that ground truth.

## Data model (new migration when built)

- `tm_swing_sessions` — user_id, date, context ('range'|'round'|'import'),
  club_slot?, notes, source ('capture'|'archive').
- `tm_swings` — session_id, video ref (user-owned storage; metrics outlive
  footage), **duration_ms (takeaway→impact)**, **tempo_ratio (backswing:downswing)**,
  pose_metrics JSONB (backswing length, hip/shoulder turn, sway, early
  extension, head movement + per-metric confidence), flags[].
- `tm_ball_data` — OPTIONAL, session- or swing-level: club_speed, ball_speed,
  smash, launch_deg, spin, carry, total; source ('manual'|'csv'|'garmin'),
  device label. Nullable join to tm_swings when timestamps align.

Facts only, SG-style: metrics stored deterministic; narration computed at read
time; per-metric confidence recorded; **never-fabricate** — unmeasurable =
null + flag, clubface is explicitly out of scope for video (monitor leg or
nothing).

## Pipeline

1. **Ingest** — batch camera-roll import (archive mode) or guided in-app
   capture (face-on / down-the-line framing hints).
2. **Swing detection** in clip: motion energy + audio impact spike →
   takeaway/top/impact frame indexes.
3. **Tempo engine** (flagship, zero pose uncertainty): duration_ms +
   tempo_ratio from frame indexes. Tour Tempo lineage (~3:1, total time is a
   teaching factor — the stat Dale tracked for years).
4. **Pose metrics**: MediaPipe-class 2D on-device where possible; monocular 3D
   is a later upgrade, never a prerequisite.
5. **Ball-data attach (optional)**: manual quick-entry, CSV mapping
   (Rapsodo / Garmin R10 / Mevo exports), later Garmin Golf Premium API
   (exists — Clippd was first partner). Session-level pairing default;
   per-swing when timestamps allow.
6. **Narration**: existing Caddie plumbing; correlation engine (V2) reports
   swing-metric × ball-data × SG-category co-movement with sample-size gates
   (SG putting-gate discipline — "too early to tell" below threshold, never
   invented causality).

## Surfaces

- **Swing Timeline** — longitudinal view: tempo/turn/extension across years,
  era detection ("the flat-backswing era"). Archive import is the onboarding
  hook (unclaimed in market).
- **Round-loop anchors** (retention design — no standalone analyzer tab):
  post-round SG dip → capture prompt; GamePlan warm-up card → "film one swing,
  I'll check the hook pattern" (self-report loop closes); Practice engine logs
  drills against it.
- **"Worth strokes" ranking** (V2): faults ordered by SG impact, not by
  distance from a Platonic ideal.

## Phases (from the strategy paper)

- **V0 — Timeline pilot (2–3 wks, zero production risk):** batch importer +
  tempo engine + core pose metrics on DALE'S ARCHIVE; validate against his
  paired monitor stats; Swing Timeline rendered. Needs: Dale points at the
  video folder + whatever monitor exports survived.
- **V1 — Capture & narrate (3 wks):** guided capture, session metrics, Caddie
  narration, round-loop prompts.
- **V2 — The join (3–4 wks):** correlation engine + worth-strokes ranking +
  drill prescriptions + SG-trend receipts.
- **V3 — Moats (3 wks):** launch-monitor stream fully integrated (manual/CSV/
  Garmin API), public archive-import onboarding, optional coach-share export.

## Sequencing & competitive clock

After Watch W0–W1 foundations (platform gap first, moat second), though V0 is
independent and can run any time. Sportsbox/SAMI (DeChambeau group, Gemini
conversational 3D coach) ships late 2026 — the swing-to-score join should be
staked before it lands. Tasks: #24 (V0 pilot), #21 (launch-monitor stream —
folded into this module as the optional ball leg).
