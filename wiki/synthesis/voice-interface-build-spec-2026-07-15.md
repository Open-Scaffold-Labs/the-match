# Voice Interface ("Talk Your Round") — Build Spec

**Date:** 2026-07-15 · **Author:** Dale Raaen (via Claude session)
**Status:** Proposed — strategy memo approved deliverable is `~/Projects/The-Match-Voice-Interface-Strategy.docx`
**Origin:** 2026-07-10 friends-round feedback (Dale's son-in-law): in-round data entry takes too long.

## Thesis

Voice is the only interface cheaper than a glance. The Match's edge over the
voice-first entrants (Barkie, CaddyChat, Caddie AI): **the app already knows** —
Eagle Eye GPS gives shot start position, OSM polygons give the lie, `gpsToGreen`
gives distance to pin, geofencing gives the hole. Voice supplies only the delta
(outcome, club, score). A six-field form becomes a five-word sentence, and every
fact lands in the existing SG fact model unchanged.

Target conversation (the product spec, verbatim from Dale):

> "I'm on tee six now. Hit my ball — you can see where I am. What's the AI
> Caddie think? … Okay, I'll aim there. … Oops, missed the green, well right,
> ten yards."

## Architecture (Phase 1 target)

- **Transport:** WebRTC directly from the PWA to a realtime speech-to-speech
  provider (OpenAI gpt-realtime class). A Vercel function
  (`/api/v1/voice/session`) mints **ephemeral session tokens** — no audio
  proxies through our servers, no new long-running infra. (If we later go
  multi-provider/pipeline — Deepgram/ElevenLabs STT → Claude → Cartesia TTS —
  that's a websocket gateway and per the Deployment Decision Rule it goes on
  Fly, not Vercel Functions.)
- **Tools (function calling), executed client-side against `/api/v1` with the
  user's JWT** — same endpoints the tap UI uses:
  - `set_hole(hole)` — advance/select hole
  - `log_shot({club?, lie?, toPin?})` — lie/toPin default from GPS+OSM inference; voice overrides
  - `log_hole_score({score, putts?, firstPuttBucket?})` — writes the PuttChips facts
  - `correct_last({field?, value?} | undo)` — rewrite/undo last fact
  - `get_caddie_advice()` — wraps Eagle Eye advisor + caddie route (Claude stays the strategist; `sgPromptBlock` + PLAYER PROFILE unchanged)
  - `get_round_status()` — score/match state readback
- **Context injector:** on session start + every hole change, push a compact
  block: hole/par/yardage, live `gpsToGreen`, inferred lie, weather/plays-like,
  score state, SG + tendencies profile. Keep it under ~1KB; refresh, don't
  accumulate (prompt caching keeps cost down).
- **On-device front end:** "Hey Match" wake word (small WASM model) + VAD while
  screen on; push-to-talk always available; local earcons for instant ack;
  Safari 18.4 keep-awake for cart-mount Round Mode.
- **Half-duplex, user-barge-in-only.** Mic state always visible. VAD-gated
  streaming only while armed; no partner audio retained.

### Latency budget

| Event | Budget |
|---|---|
| Earcon ack (local) | < 300 ms |
| Final transcript | < 700 ms |
| Spoken write-confirmation (first audio) | < 1.2 s |
| Caddie advice (first audio) | < 2 s |

### PWA constraints (verified 2026-07)

Foreground mic works in installed home-screen apps; Safari 18.4+ can prevent
screen lock. **No lock-screen/background listening in a PWA** — that requires
the Phase 4 native shell.

### iOS 27 / "Hey Siri" (Dale's question, answered)

SiriKit is deprecated (WWDC 2026); App Intents 2.0 is the only Siri path and
requires a **native app**. Phase 4 = thin iOS shell (WKWebView/Capacitor)
exposing `LogShot` / `LogScore` / `CaddieAdvice` / `RoundStatus` App Intents
backed by the same REST endpoints → "Hey Siri, tell The Match I made a five"
works screen-locked and from the Watch. The in-app voice loop (Phases 0–3) is
independent of Apple's terms and ships first.

## Phases

**Phase 0 — Push-to-talk spike (1–2 wks).** Hold-to-talk button in
ActiveRound: streaming STT → Claude Haiku utterance parser → existing
score/shot endpoints → short TTS confirm. No wake word, no realtime session.
*Accept:* Friday group logs a full 9 by voice; utterance grammar survives
on-course noise; entry faster than taps.

**Phase 1 — Round Mode (3–4 wks).** Realtime session, tool schema, context
injector, earcons, undo, keep-awake, wake word.
*Accept:* latency table met on-course; scorecard matches voice log 18/18;
"scratch that" always recovers.

**Phase 1.5 — Walking Mode (Dale, 2026-07-15; shipped with Phase 1).** Cart
mode assumes a mounted, visible screen; a walker pockets the phone with
earbuds — and a PWA can't listen screen-locked. Running-app pattern: the
session + wake lock stay alive under a full-black pocket shield (black ≈ off
on OLED), all touches swallowed, deliberate 1.2s hold to wake, minimal status
(hole number + listening/caddie/muted dot) at low brightness. WALK button in
the live Round Mode pill. Battery honesty: continuous session + wake lock over
a 4h walking round is the stress case — measure on-course; auto-mute-on-idle
is the first lever if it's hungry.

**Phase 2 — Proactive caddie (2–3 wks).** Geofenced hole transitions speak the
tee brief unprompted; shot-detection nudges; post-hole SG one-liners.
*Accept:* SG fact coverage per round measurably up vs. tap-only baseline.

**Phase 3 — Social + tier (2 wks).** Voice scoring in outings (self-score
only, F.5-additive), match status readback. Gate: Round Mode → Pro, proactive
caddie → Elite.

**Phase 4 — Native shell (fall, parallel-trackable).** App Intents 2.0,
lock-screen, Watch/AirPods.

## Cost

gpt-realtime class, cached: ~$0.06–0.11/active-min (mini ~$0.02–0.05).
~10–20 armed minutes/round → **$0.60–2.00/round flagship**, $0.20–0.75 mini.
Later optimization: mini-for-capture / flagship-for-caddie routing (~60% cut).
Dale's call 2026-07-15: best experience first, optimize after retention proof.

## Hooks / related

- **GamePlan (new feature, Dale 2026-07-15, needs own spec):** pre-round
  AI strategy for every hole — player stroke history + SG profile vs. course
  layout. Voice hook: Phase 2's tee brief should read the GamePlan hole entry
  when one exists.
- Utterance grammar must map 1:1 onto SG facts (`lie`, `toPin`, putts,
  first-putt bucket) — see `docs/SG-DESIGN.md`; store facts, never SG.
- Risks & mitigations, competitive table, and full strategy narrative live in
  the memo docx.
