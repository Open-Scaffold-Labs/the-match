---
type: overview
created: 2026-04-29
updated: 2026-05-07
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

- [[synthesis/handicap-accuracy-audit-2026-06-25]] — **Handicap accuracy audit vs WHS** — gap table (our calc vs USGA/R&A 2024) + tiered fix plan. Tier-1 (0.96 removed, sliding table, clamp, min-3, round) SHIPPED 2026-06-25 · created 2026-06-25
- [[synthesis/per-player-gender-ratings-2026-06-25]] — **Per-player gender ratings (mixed matches)** — each player's Course Handicap uses their own gender's tee rating (tee_ratings JSONB, migration 031). SHIPPED to beta 2026-06-25 · created 2026-06-25
- [[synthesis/course-handicap-match-strokes-2026-06-25]] — **Course Handicap → match strokes** — net strokes off slope-based Course Handicap (Index×Slope/113+CR−Par) so gender/slope drive results. SHIPPED to beta 2026-06-25 (NET-mode only; verify on a real match) · created 2026-06-25
- [[synthesis/gender-handicap-wiring-2026-06-25]] — **Gender → handicapping** — gender-correct tee CR/SR selection + USGA differential enabled so ratings/gender drive the index. SHIPPED to beta 2026-06-25 · created 2026-06-25
- [[synthesis/player-data-foundation-2026-06-25]] — **Player-data foundation** — gender field (migration 030) + effortless distance entry: why it matters, slice sequence, risk register. Gender field SHIPPED to beta 2026-06-25 (verified `/me` carries it) · created 2026-06-25
- [[synthesis/own-club-arcs-3.3-build-spec-2026-06-25]] — **Phase 3.3 build spec** — own-club distance arcs with handicap-seeded empty state: competitive research synthesis (UX + data/accuracy), slice sequence, risk register, checklist. SHIPPED to beta 2026-06-25 (on-map visual pending device verification) · created 2026-06-25
- [[synthesis/playslike-3.1-build-spec-2026-06-25]] — **Phase 3.1 build spec** — transparent, adjustable plays-like + real USGS DEM elevation: slice sequence, full risk register, progress checklist. SHIPPED to beta 2026-06-25 · created 2026-06-25
- [[synthesis/next-session-handoff-2026-06-26]] — **ACTIVE handoff** — pick up after the 2026-06-26 session (9-hole corruption guard + solo rounds handicap like any round); ranked next-steps (WHS expected-9, desktop leagues, next leapfrog), standing rules, key files · created 2026-06-26
- [[synthesis/next-session-handoff-2026-06-24]] — superseded handoff (MapLibre sole renderer / Leaflet removed / offline tiles shipped) · created 2026-06-24
- [[synthesis/build-plan-bulletproof-2026-06-23]] — **the-match bulletproof build plan** — zero-cost stack, risk register, phased checklist (Phase 0–4). Phase 1 + 2 ☑; Phase 3.1 + 3.3 ☑; Track H (handicap accuracy) ☑ through H.5. Updated 2026-06-26 · created 2026-06-23
- [[synthesis/eagle-eye-premium-plan-2026-06-23]] — **Eagle Eye premium design plan** — competitive thesis + design audit + phased upgrade roadmap. Phase 2 status note added 2026-06-26 · created 2026-06-23
- [[synthesis/session-report-2026-06-06]] — full session record: GolfNow affiliate (Dale applied), Eagle Eye OSM-mirror regression fix + 5 next-level features on `feat/eagle-eye-upgrades` (undeployed), course-data provider research, push/branch discipline rule + anti-patterns #21/#22 · created 2026-06-06
- [[synthesis/eagle-eye-next-level-plan-2026-06-06]] — Eagle Eye build plan: tap-to-measure + front/center/back green distances, risk anticipation + fallbacks, branch `feat/eagle-eye-upgrades` · created 2026-06-06
- [[synthesis/audit-2026-05-07]] — E2E auth walk + visual sweep + bug list + improvement backlog + new-ideas brainstorm. Found 11 bugs (2 high: no logout, no /settings route; 4 medium; 5 low) + 13 improvements + ~25 new ideas across engagement loops, Eagle Eye depth, social, platform, AI · created 2026-05-07
- [[synthesis/audit-2026-04-29]] — full static audit + runtime click-through findings: 12 bugs + 8 runtime bugs + 11 UX issues + 10 tech-debt + 14 missing-feature candidates. Priority list re-marked 2026-05-01 to show what's shipped vs still open · created 2026-04-29
- [[synthesis/audit-fixes-proposal-2026-04-29]] — **CLOSED 2026-05-01** — every item in the original approval queue shipped (commits `1fa6ee4`, `8d74a76`, `93053ba` on 2026-04-29). Page preserved as historical record · created 2026-04-29
- [[synthesis/eagle-eye-tile-grid-handoff-2026-05-01]] — Eagle Eye tile-grid UX handoff notes from 2026-05-01
- [[synthesis/match-page-completion-plan]] — multi-session plan for the LiveOuting / Match page completion (refactor sequenced in stages 1/6 → 6/6, all shipped)
- [[synthesis/claude-anti-patterns]] — institutional memory of mistakes (entries inherited from LimitlessStack base + project-specific additions)
