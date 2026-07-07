---
type: synthesis
created: 2026-07-07
updated: 2026-07-07
tags: [the-match, handoff, active]
---

# Next-Session Handoff — 2026-07-07 (ACTIVE; supersedes 2026-07-06)

Start with the mandatory CLAUDE.md first actions (roll-call → wiki/index.md → this file +
`wiki/log.md`'s 07-06 PM13 → 07-07 AM4 entries). Everything below is SHIPPED AND
VERIFIED unless marked open.

## Shipped this session (07-06 PM → 07-07 AM; every item live + evidence-verified)

1. **Unification S4 COMPLETE** (`7f5902c`) — shared `components/scorecard/` surface (incl.
   PuttChips), both consumers import from it, defensive prop contracts (playerTeam default,
   value-or-fn diffStr/netDiffStr via perPlayer()). Browser-walked on solo AND multi
   (throwaway outing 7EAX). The whole solo/multi fork saga is closed: S1–S4 all live.
2. **Join intent > solo auto-resume** (`0084a16`) — ?join= QR/link lands in the match on
   first load; failed joins land on the hub where the error toast is visible.
3. **Eagle Eye outage — root-caused + 3 structural fixes.** Cause: 07-06 deploy-saga
   version skew let the browser HTTP-cache index.html UNDER the maplibre chunk URL
   (200 + cacheable). Fixes: (a) `/assets/*` excluded from SPA fallback (`b7a1ee4`) —
   missing assets 404, poisoning class closed, 8-route matrix verified; (b) map stall
   guard counts only VISIBLE time (`bdd6d92`) — Chrome freezes rAF when hidden/occluded;
   (c) poisoned entry healed; Matt confirmed EE renders. LESSON: map testing needs a
   VISIBLE browser window — occluded windows stall MapLibre 'load' by design.
4. **NotebookLM 50-source cap solved** — "Failed to get SOURCE_ID" = notebook FULL, not
   a broken CLI (anti-pattern #27 filed: same-target probes can't prove tool-wide
   failure). Handoffs now sync as ONE `handoffs-rollup.md` source (manifest
   exclude_paths); notebook at ~43/50; `--check-caps` preflight check added +
   regression-proven + synced byte-identical ×3 (the-match / Hub vault / LimitlessStack).
5. **Withdrawn provenance + rejoin reinstate** (`51ffe8e`) — traced the 7EAX mystery (no
   silent withdraw path exists; guard sheet or commissioner only), found the real bug:
   rejoining players stayed withdrawn. Now `withdrawn_by: self|host`; explicit re-join
   reinstates self-withdrawn; host authority preserved. 6/6 e2e vs prod.
6. **`react/jsx-no-undef` gate RE-LANDED** (`af059f3`) — first-landing killer reproduced
   under audit + root-caused: legacy-peer-deps skips peer AUTO-INSTALL → dropped
   @imgly's onnxruntime-web. Fixed: committed `.npmrc` (legacy-peer-deps=true — Vercel
   must resolve like local; plugin has no eslint-10 release), `onnxruntime-web` pinned
   EXACT 1.21.0 as direct client dep, rule regression-proven, clean-slate install with
   Vercel's exact command verified. ANY future npm install: lockfile-diff + clean-slate
   build remain mandatory.
7. **Progress docs updated**: `build-plan-bulletproof-2026-06-23.md` (Track G added —
   pipeline bulletproofing ledger; 4.3 flipped to ◐) and
   `eagle-eye-premium-plan-2026-06-23.md` (UPDATE 2026-07-07 block — dispersion bands,
   range-rings, tokenization A+B, Caddie all shipped).

## Open items, in priority order

1. **Matt's on-course round** (POST-LAUNCH #25 umbrella) — the field confidence check:
   putt chips both modes, ShotSheet, rings/dispersion clutter, tokenized EE, unified
   scorecard, and now withdraw/rejoin behavior.
2. **EE tokenization Stage C + HoleMapGL conversion** (build-plan 4.3 ◐) — use the
   `eeColor` bridge; MapLibre paint props don't resolve var().
3. **Visual-flow parity sweep** — solo/multi was only the START of the drift class Matt
   cares about; sweep other surfaces with fresh eyes.
4. **Dale housekeeping** — pull-review of 07-06→07 work (putt capture, unification,
   withdraw provenance touch his surfaces); drop dead `ods_` tables; revoke orphaned
   `the-match-prod` key.
5. **Retire old free-tier DB** ~after 2026-07-10 if the week stays clean.
6. **Caddie free-vs-Elite decision** + **ANALYZE un-park** (product calls).
7. Watch items: **Vercel deploy webhook** missed one push (empty-commit retrigger works;
   escalate if it repeats) · **participant-change audit trail** gap (operator-console
   era) · throwaway outing 7EAX + scratch league entries can be DB-cleaned whenever ·
   Hub vault has ONE pre-existing uncommitted file (tools/.notebooklm-opensalon-state.json)
   awaiting Matt's call.

## Environment facts (current as of `af059f3`+)

Prod `the-match-roan.vercel.app` (alias verified Ready, /health db:true) · DB OSL
"Open Design Studio" bqjd… :6543 transaction pooler · `.npmrc` legacy-peer-deps=true is
COMMITTED (required for eslint-plugin-react on eslint 10) · onnxruntime-web pinned 1.21.0
direct · all SCORING_* flags on · ANTHROPIC_API_KEY the-match-prod-2 · test accounts #2/#14,
outings 8L3U/UDCX closed-keep, 7EAX throwaway · e2e harness scripts/e2e-putt-capture*.mjs.

## Process rules carried forward (all bit us within 48h)

Served-bundle gate (vercel inspect + content grep) · lockfile diff + clean-slate install
on ANY npm install · browser-walkthrough with a VISIBLE window for map work · SW-activation
reload races the first post-deploy page load (retry before diagnosing) · slice definition
defines done · same-target probes prove nothing tool-wide (anti-pattern #27).
