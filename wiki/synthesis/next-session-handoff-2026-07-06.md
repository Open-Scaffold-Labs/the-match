---
type: synthesis
created: 2026-07-06
updated: 2026-07-06
tags: [the-match, handoff]
---

# Next-Session Handoff — 2026-07-06 (SUPERSEDED by 2026-07-07)

Start with the mandatory CLAUDE.md first actions (roll-call → wiki/index.md → this file +
`wiki/log.md`'s 07-02→07-06 entries). This was a marathon multi-day session; the log has
per-item detail. Everything below is SHIPPED AND LIVE unless marked open.

## Shipped this session (all browser- or data-verified)

1. **Eagle Eye tokenization Stage A+B** — 34-token `--tm-ee-*` palette, pixel-identical
   (244/244 equivalence). `eagle-eye-tokenization-plan-2026-07-02.md` §9.
2. **Range-rings + dispersion zones** — honest dispersionEllipse landing zones, opt-in
   green-anchored layup rings, `eeColor` getComputedStyle bridge for MapLibre paint
   (REQUIRED for any future HoleMapGL color work — paint props don't resolve var()).
3. **SG v2 (Dale's PR #1) MERGED** — SG engine, Stats card, Practice signals, AI Caddie
   (model `claude-sonnet-5`, env override `CADDIE_MODEL`; robust text-block extraction —
   content[0] is NOT guaranteed text). Caddie confirmed answering from Matt's real bag.
4. **Prod DB moved** to OSL org (Pro), project "Open Design Studio" `bqjdiixkygslaryxcyfg`,
   us-east-2, nightly backups. ⚠ THE LESSON: Vercel `DATABASE_URL` must be the
   **transaction pooler (:6543)** — session (:5432) exhausted its 15-client cap and took
   the beta down (EMAXCONNSESSION). Local .env stays :5432 for dev.
5. **Anthropic billing** — company org (Dale owner, Matt admin, $100 prepaid ceiling);
   live key = `the-match-prod-2` (validated by 200-probe BEFORE install).
6. **Live putt capture in outings** (self-score only; writer===target enforced both
   endpoints; migration 041 on prod) — `live-putt-capture-outings-build-spec-2026-07-06.md`.
   e2e-verified vs prod (scripts/e2e-putt-capture*.mjs, test outing 8L3U).
7. **Solo/multi scorecard unification COMPLETE (S1–S3)** — solo renders the SAME
   ScorecardTable/TotalsRow/MatchScoreboard/LeadersPlaque/AugustaPlaqueFooter as outings,
   one row, no filler rows, chrome pinned full-width with the grid scrolling between.
   Zero Solo* scorecard components remain. `solo-multi-scorecard-unification-spec-2026-07-06.md`.

## Open items, in priority order

1. ~~**Unification S4**~~ ✅ SHIPPED 2026-07-06 PM (`7f5902c`, deploy verified Ready; browser walkthrough still owed) — move shared scorecard components (incl. PuttChips pattern) to
   `components/scorecard/`, BOTH consumers import from there, and add defensive default
   props: `playerTeam = () => null`, `diffStr`/`diffColor` accepting value-or-fn,
   `skinsByPlayer = {}`. Separate commit (bisection). The two prop-contract crashes on
   07-06 are the motivation — make them structurally impossible.
2. **Re-land the `react/jsx-no-undef` lint gate** — the fix is known-good (regression-
   proven to catch the PuttChips crash class) but its first landing churned the lockfile
   and DROPPED `onnxruntime-web`, breaking Vercel builds. Redo: install plugin, then
   verify `npm install` from a CLEAN node_modules builds, diff the lockfile for dropped
   packages (grep onnxruntime), THEN commit. The `.npmrc`/overrides attempts were reverted.
3. ~~**One glance at a real multiplayer match**~~ ✅ DONE 2026-07-06 PM (throwaway outing 7EAX) — plaque/footer confirmed structurally
   unchanged (verbatim component swap, diff-verified) but not eyeballed on a live match.
4. **Matt's on-course round** (POST-LAUNCH #25 umbrella): putt chips both modes, ShotSheet,
   rings/dispersion clutter check, tokenized EE eyeball, unified scorecard in the field.
5. **Dale housekeeping**: pull-review of 07-06 work (putt capture + unification touch his
   SG + solo surfaces); drop dead `ods_` tables in the DB project; revoke orphaned
   never-used `the-match-prod` key.
6. **Retire the old free-tier DB** (~after 2026-07-10 if the week stays clean; old
   connection string is commented in Matt's .env).
7. **ANALYZE un-park decision** — root causes all fixed (key + extraction); needs a
   product call + end-to-end camera pass before re-surfacing the button.
8. Carried forward: EE Stage C (reviewed value elevation), Phase 4.3 other-file
   tokenization (use eeColor bridge for HoleMapGL), Caddie free-vs-Elite at launch,
   solo/multi scorecards were only THE START of visual-flow parity — Matt cares about
   this class of drift; sweep other surfaces with fresh eyes.

## Hard-won process rules (enforce these — they all bit us this session)

- **"Deployed" = the SERVED bundle hash changed + content verified** (curl the asset).
  `vercel ls` deploys can silently Error while local gates are green.
- **Browser-walkthrough loop with Matt logged in is the highest-value QA in the stack** —
  it caught 4 issues automated gates structurally couldn't. Hard-refresh (cmd+shift+r)
  after every deploy; the SW serves stale bundles otherwise.
- **Any npm install → diff the lockfile + build from clean node_modules before commit.**
- **Shared-component prop contracts**: several LiveOuting scorecard props are FUNCTIONS
  called per-player; passing values crashes. Until S4 hardens defaults, check the call
  census (grep `prop(`) before wiring a new consumer.
- **The slice definition defines done.** Matt caught three quiet scope-narrowings in one
  night. Claims of completion must match the written scope, verbatim.
- **Verify against the actual DDL/objects** (the migrations-check false alarm) and
  **validate secrets by live probe BEFORE installing** (the key saga).

## Environment facts (trust anchors current as of `6eaed06`+)

CLAUDE.md is up to date (DB section, 42 migrations, SG v2 note). Wiki synced to
NotebookLM (verify_failed 0 throughout). Prod: Vercel `the-match-roan.vercel.app`,
DB OSL/bqjd :6543, ANTHROPIC_API_KEY = the-match-prod-2, all SCORING_* flags on.
Test accounts: #2 Test User, #14 Demo Tester; test outings 8L3U/UDCX (closed, keep).
e2e harness: `scripts/e2e-putt-capture*.mjs` (JWT minted blind from .env).
