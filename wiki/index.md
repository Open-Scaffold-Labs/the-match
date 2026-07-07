---
type: overview
created: 2026-04-29
updated: 2026-06-27
---

# Wiki Index

Content catalog — every page listed here. The preflight's index-completeness check warns when a `wiki/*.md` exists but isn't referenced here.

## Top-level

- [[overview]] — top-level synthesis of the wiki and the project's current shape
- [[log]] — chronological append-only activity log (every session writes here)
- [[HIGH-PRIORITY-TODO]] — urgent / overdue items; read every session
- [[POST-LAUNCH-TODO]] — deferred items from polish-pass sessions

## Entities

*(none yet)*

## Apps

*(Add one page per app. Each app page should include: vertical, NAICS sector, self-heal phase, canonical files checklist. See `claude-md/repo-schema.md` for the template.)*

## Concepts

- [[concepts/llm-wiki-pattern]] — the LLM-curated wiki pattern this vault implements
- [[concepts/notebooklm-workflow]] — how this project routes content into NotebookLM (main bucket + reminder bucket) and the desktop-commander invocation pattern

## Sources

- [[sources/claude-code-karpathy-obsidian-video-2026-04-14]] — Karpathy's Claude-Code-on-Obsidian walkthrough, transcribed and annotated

## Synthesis

- [[synthesis/f5-never-lose-your-round-build-spec-2026-06-28]] — **F.5 staged build spec** — "never lose your round" scoring data-model fix (participants single source of truth + OCC + idempotency + offline hardening), grounded in a complete read/write inventory + implementation research. 7-stage flag-gated plan, split-brain risk register. **COMPLETE — all 7 stages SHIPPED + LIVE on beta** (S1 read-from-rows, S2 OCC, S3 idempotency, S4 guest rows, S5 reader flip, S6 designated-scorer, S7 cutover-to-rows-as-sole-store — see the per-stage sub-specs below). S7 was made reversible (flag, not a one-way door); every `SCORING_*` flag is an off-ramp. Only open item: a real on-course round on the native iOS shell (confidence check, not a gate) · created 2026-06-28
- [[synthesis/f5-s2-s3-build-spec-2026-06-28]] — **F.5 S2+S3 detailed build spec** — OCC on the score-on-behalf path (FOR UPDATE serialization + enriched 409 inline conflict chip) + offline idempotency (tap-time keys, claim+write+response in one txn). **LIVE on beta 2026-06-29** (`SCORING_OCC_ONBEHALF`, `SCORING_IDEMPOTENCY`); verified vs real Postgres + live-beta e2e · created 2026-06-28
- [[synthesis/f5-s4-guest-rows-build-spec-2026-06-29]] — **F.5 S4 build spec** — guests get real `tm_outing_participants` rows (`user_id NULL` + `is_guest`/`guest_id`), keeping every `user_id`-keyed stat exclusion working with no query change. **LIVE on beta 2026-06-29** (migration 038 applied, 13 guests backfilled, `SCORING_GUEST_ROWS`); safety thesis proven vs real Postgres + live e2e · created 2026-06-29
- [[synthesis/f5-s5-reader-flip-build-spec-2026-06-29]] — **F.5 S5 build spec** — flip friends-live/season/leagues-standings/CSV from `state.total` to row-derived (only the score values; participant list/flags stay state-sourced), the last prep before S7. **LIVE on beta 2026-06-29** (`SCORING_AGG_READ_FROM_ROWS`); parity proven (45/45 on real prod data) · created 2026-06-29
- [[synthesis/f5-s6-designated-scorer-build-spec-2026-06-29]] — **F.5 S6 build spec** — designated-scorer mode (opt-in; only host + assigned scorer enter others, players keep self-scoring) built on the existing markers plumbing, + the scorer banner / who's-scoring indicator / assign-nudge the market doesn't ship. **LIVE on beta 2026-06-29** (`SCORING_DESIGNATED`); 9/9 sandbox + 7/7 live verified · created 2026-06-29
- [[synthesis/foundation-lock-build-spec-2026-06-27]] — **Foundation-Lock build spec + master checklist** — strategic, failure-mode-hardened plan across the 3 pillars (usability/accuracy/visual-flow), backed by competitive research on the most-used golf apps (generic). Track F slice 1 SHIPPED 2026-06-27 (`d282074`: /api/v1, CI gate+tests, pool, indexes-file, sentinel, fixes); F.5/F.6 data-model + security specced not executed · created 2026-06-27
- [[synthesis/audit-2026-06-27]] — **Full-stack build-it-right audit** — 4-dimension parallel audit (architecture/scale · security · code-quality/testing · App-Store/UX). Confirms existing checklists; surfaces net-new foundational findings (N1–N15) folded into the build plan as **Track F** + POST-LAUNCH #25/#26. The "expensive to change after the App Store freezes clients" class · created 2026-06-27
- [[synthesis/handicap-accuracy-audit-2026-06-25]] — **Handicap accuracy audit vs WHS** — gap table (our calc vs USGA/R&A 2024) + tiered fix plan. Tier-1 (0.96 removed, sliding table, clamp, min-3, round) SHIPPED 2026-06-25 · created 2026-06-25
- [[synthesis/per-player-gender-ratings-2026-06-25]] — **Per-player gender ratings (mixed matches)** — each player's Course Handicap uses their own gender's tee rating (tee_ratings JSONB, migration 031). SHIPPED to beta 2026-06-25 · created 2026-06-25
- [[synthesis/course-handicap-match-strokes-2026-06-25]] — **Course Handicap → match strokes** — net strokes off slope-based Course Handicap (Index×Slope/113+CR−Par) so gender/slope drive results. SHIPPED to beta 2026-06-25 (NET-mode only; verify on a real match) · created 2026-06-25
- [[synthesis/gender-handicap-wiring-2026-06-25]] — **Gender → handicapping** — gender-correct tee CR/SR selection + USGA differential enabled so ratings/gender drive the index. SHIPPED to beta 2026-06-25 · created 2026-06-25
- [[synthesis/player-data-foundation-2026-06-25]] — **Player-data foundation** — gender field (migration 030) + effortless distance entry: why it matters, slice sequence, risk register. Gender field SHIPPED to beta 2026-06-25 (verified `/me` carries it) · created 2026-06-25
- [[synthesis/own-club-arcs-3.3-build-spec-2026-06-25]] — **Phase 3.3 build spec** — own-club distance arcs with handicap-seeded empty state: competitive research synthesis (UX + data/accuracy), slice sequence, risk register, checklist. SHIPPED to beta 2026-06-25 (on-map visual pending device verification) · created 2026-06-25
- [[synthesis/playslike-3.1-build-spec-2026-06-25]] — **Phase 3.1 build spec** — transparent, adjustable plays-like + real USGS DEM elevation: slice sequence, full risk register, progress checklist. SHIPPED to beta 2026-06-25 · created 2026-06-25
- [[synthesis/next-session-handoff-2026-06-29]] — superseded by 2026-06-30 · created 2026-06-29
- [[synthesis/next-session-handoff-2026-07-07]] — **ACTIVE handoff** — S4 complete + walked, join-intent fix, EE outage root-caused (3 structural fixes), NotebookLM cap + rollup + --check-caps, withdraw provenance + rejoin reinstate (6/6 e2e), jsx-no-undef re-landed w/ root cause; PM UPDATE: EE tokenization complete (Slice 1 + C1/C2 live, C3 staged); opens: on-course round, parity sweep · created 2026-07-07
- [[synthesis/ee-stage-c-holemapgl-tokenization-build-spec-2026-07-07]] — **EE Stage C + HoleMapGL tokenization build spec — SHIPPED 2026-07-07 PM** (`7c260d4`+`a70a1b7`) — HoleMapGL colors → --tm-ee-* via hardened eeColor bridge (pixel-identical, 57/57 equivalence); C1 semantic re-rule (white=measured/green=computed/gold=locked/dim=acquiring) + C2 11px label floor live; C3 soft-halo staged (`tm-ee-halo-soft`); dual research agents (MapLibre internals + 10-app competitive) · created 2026-07-07
- [[synthesis/next-session-handoff-2026-07-06]] — SUPERSEDED handoff — the 07-02→06 marathon: EE tokenization A+B, rings/dispersion, SG v2 merged + Caddie live, DB→OSL org (:6543 lesson), live putt capture, solo/multi unification complete; open items S4 + lint-gate re-land + on-course pass; hard-won process rules · created 2026-07-06
- [[synthesis/handoffs-rollup]] — single NotebookLM source concatenating ALL session handoffs (ACTIVE first) — handoff files are excluded from notebook routing since the 50-source cap hit (manifest exclude_paths); regenerate on every new/edited handoff · created 2026-07-06
- [[synthesis/sg-map-tap-capture-build-spec-2026-07-02]] — SG map-tap shot-capture build spec (ShotSheet lineage) · created 2026-07-02
- [[synthesis/next-session-handoff-2026-07-02]] — superseded by 2026-07-06 handoff — Phase-0 status corrected to PARTIAL (tabular done; shadows/grain/motion primitives in code, app-wide sweep + token refactor = Phase 4.3); both master plans brought current; Eagle Eye distance/label great-circle fix + ANALYZE button removed (parked pending proper wiring); where to pick up on Eagle Eye + the bulletproof/premium plans · created 2026-07-02
- [[synthesis/eagle-eye-tokenization-plan-2026-07-02]] — **Phase 4.3 build plan — Stage A+B SHIPPED 2026-07-02 PM** (pixel-identical, §9 execution record) — `EagleEye.jsx` inline-style literals → governed `--tm-ee-*` token system; Stage C + other-file slices remain · created 2026-07-02
- [[synthesis/solo-multi-scorecard-unification-spec-2026-07-06]] — **Solo/multi scorecard unification — SPECCED, next session's first build** — solo renders the SAME ScorecardTable/Board components as outings with one participant (deletes the May solo fork); recon'd component map, risk register, slices; flag to Dale before build · created 2026-07-06
- [[synthesis/live-putt-capture-outings-build-spec-2026-07-06]] — **Live putt capture in outings — SHIPPED 2026-07-06** (`833e67e`) — self-score-only putt chips in live outings (shared PuttChips w/ solo), facts ride the F.5 write/tx/idempotency, /end fan-out re-cleans vs final scores; migration 041 · created 2026-07-06
- [[synthesis/range-rings-dispersion-build-spec-2026-07-02]] — **Range-rings + club-arc dispersion bands — SHIPPED 2026-07-02 PM** (`d904347`) — honest dispersion zones replace the fixed 11-yd circle; held-2.5 rings ship as opt-in green-anchored layup arcs (market-corrected form); eeColor MapLibre token bridge established · created 2026-07-02
- [[synthesis/next-session-handoff-2026-06-30]] — handoff (superseded by [[synthesis/next-session-handoff-2026-07-02]]) — the 6 fixes shipped this session (reduced-motion, GPS ±margin removal, wind pre-fix + shot-relative + blow-direction arrow, plays-like rebuild), the CORRECTED marketing stance (never show a precision figure — in-app ±chip removed, no graded chip), real Phase-0 status (A+E done; C/D/F deferred as a Phase-4.3 inline refactor; keep system font), open items, and the recommended pivot to functional/accuracy/App-Store work · created 2026-06-30
- [[synthesis/playslike-accuracy-rebuild-2026-06-30]] — **plays-like accuracy rebuild** — sourced Trackman/Titleist coefficients replacing the unvalidated heuristic: asymmetric wind (1%/0.5% per mph), altitude 1.16%/1000ft, temp 0.8%/10°F, downhill ×0.67, caps; fixes the −36 bug; 29 pinned tests. SHIPPED `a2f5b73` · created 2026-06-30
- [[synthesis/phase0-foundation-build-spec-2026-06-30]] — **Phase 0 visual-foundation build spec** — audited status (tabular done, reduced-motion shipped, dark/shadow/grain deferred as a per-element refactor), font decision (keep system SF Pro), competitor + foundation research, risk register, progress checklist · created 2026-06-30
- [[synthesis/next-session-handoff-2026-06-28]] — superseded handoff — F.5 Stage 1 shipped; reusable sandbox-Postgres harness + prod state changes · created 2026-06-28
- [[synthesis/next-session-handoff-2026-06-27]] — superseded handoff (audit + Foundation-Lock kickoff) — pick up after the 2026-06-27 session (practice loop finished to full interactivity + whole-bag arcs + Eagle Eye full-bleed deferred to native shell, POST-LAUNCH #24); ranked next-steps (EE Phase-0 polish, next leapfrog, native packaging), standing rules, key files · created 2026-06-27
- [[synthesis/next-session-handoff-2026-06-26]] — superseded handoff (9-hole corruption guard + solo rounds handicap like any round) · created 2026-06-26
- [[synthesis/next-session-handoff-2026-06-24]] — superseded handoff (MapLibre sole renderer / Leaflet removed / offline tiles shipped) · created 2026-06-24
- [[synthesis/build-plan-bulletproof-2026-06-23]] — **the-match bulletproof build plan** — zero-cost stack, risk register, phased checklist (Phase 0–4). Phase 1 + 2 ☑; Phase 3.1 + 3.3 + 3.5 ☑; Track H (handicap accuracy) ☑ through H.6 (WHS-complete). Eagle Eye full-bleed deferred to native shell (POST-LAUNCH #24). Updated 2026-06-27 · created 2026-06-23
- [[synthesis/eagle-eye-premium-plan-2026-06-23]] — **Eagle Eye premium design plan** — competitive thesis + design audit + phased upgrade roadmap. Phase 2 status note added 2026-06-26 · created 2026-06-23
- [[synthesis/session-report-2026-06-06]] — full session record: GolfNow affiliate (Dale applied), Eagle Eye OSM-mirror regression fix + 5 next-level features on `feat/eagle-eye-upgrades` (undeployed), course-data provider research, push/branch discipline rule + anti-patterns #21/#22 · created 2026-06-06
- [[synthesis/eagle-eye-next-level-plan-2026-06-06]] — Eagle Eye build plan: tap-to-measure + front/center/back green distances, risk anticipation + fallbacks, branch `feat/eagle-eye-upgrades` · created 2026-06-06
- [[synthesis/audit-2026-05-07]] — E2E auth walk + visual sweep + bug list + improvement backlog + new-ideas brainstorm. Found 11 bugs (2 high: no logout, no /settings route; 4 medium; 5 low) + 13 improvements + ~25 new ideas across engagement loops, Eagle Eye depth, social, platform, AI · created 2026-05-07
- [[synthesis/audit-2026-04-29]] — full static audit + runtime click-through findings: 12 bugs + 8 runtime bugs + 11 UX issues + 10 tech-debt + 14 missing-feature candidates. Priority list re-marked 2026-05-01 to show what's shipped vs still open · created 2026-04-29
- [[synthesis/audit-fixes-proposal-2026-04-29]] — **CLOSED 2026-05-01** — every item in the original approval queue shipped (commits `1fa6ee4`, `8d74a76`, `93053ba` on 2026-04-29). Page preserved as historical record · created 2026-04-29
- [[synthesis/eagle-eye-tile-grid-handoff-2026-05-01]] — Eagle Eye tile-grid UX handoff notes from 2026-05-01
- [[synthesis/match-page-completion-plan]] — multi-session plan for the LiveOuting / Match page completion (refactor sequenced in stages 1/6 → 6/6, all shipped)
- [[synthesis/claude-anti-patterns]] — institutional memory of mistakes (entries inherited from LimitlessStack base + project-specific additions)
