---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, handicap, whs, audit, accuracy]
---

# The Match — Handicap accuracy audit vs the World Handicap System (WHS)

*2026-06-25. Audits our handicap math (`server/src/lib/handicap.js` + the Course Handicap work) against the authoritative WHS standard (USGA + R&A Rules of Handicapping, 2024 revision), which is what the major golf apps implement. Research sourced this session.*

## Verdict

Our index is **systematically wrong** in a few specific, fixable ways — most importantly an **obsolete ×0.96 multiplier** WHS removed in 2020, and a **missing sliding table** for players with <20 scores. The Course Handicap formula we shipped today is **correct** (2024 form). Below: every rule, our status, the fix.

## Gap table

| # | WHS rule | Our code | Status | Fix tier |
|---|---|---|---|---|
| 1 | **No ×0.96 multiplier** (removed 2020; 8-of-20 replaced "bonus for excellence") | `…× 0.96` in `computeHandicapFromRounds` | 🔴 **WRONG** — understates every index ~4% | 1 |
| 2 | **Sliding table**: 3→best1(−2.0), 4→best1(−1.0), 5→best1, 6→best2(−1.0), 7–8→best2, 9–11→best3, 12–14→best4, 15–16→best5, 17–18→best6, 19→best7, 20→best8 | Always "best 8 of 20" (or fewer) | 🔴 **WRONG** for <20 scores (and no −2.0/−1.0 low-count adjustments) | 1 |
| 3 | **Score Differential** `(113/Slope)×(AGS − CR − PCC)`, each rounded to 0.1 | `(total−rating)×113/slope`, not rounded per-differential | 🟡 PCC=0 OK (standard); but no per-diff 0.1 rounding; uses raw total not AGS | 1 (rounding) / 2 (AGS) |
| 4 | **Adjusted Gross Score**: each hole capped at **net double bogey** (par+2+strokes); **par+5** before an established index | Raw `total`, no per-hole cap | 🔴 **Missing** — inflates differentials for blow-up holes | 2 |
| 5 | **Min scores**: index after **54 holes** (table starts at 3 differentials) | Requires **5** completed rounds before displacing the seed | 🟡 Too strict (should be 3) | 1 |
| 6 | **Max Index 54.0** | No clamp | 🟡 Missing clamp | 1 |
| 7 | **Soft cap** (>3.0 over 365-day Low HI → excess ×50%) + **hard cap** (max +5.0) | None | 🟡 Missing (needs persisted 365-day low) | 3 |
| 8 | **9-hole**: 9-hole differential + Index-based expected-9 → one 18-hole differential | Treats `scores.length≥9` as a round; computes an 18-style differential on a 9-hole total | 🔴 Wrong for 9-hole | 3 |
| 9 | **Course Handicap** `HI×Slope/113 + (CR−Par)`, round to whole for play | Implemented today (float, unrounded into allowance) | 🟢 **Correct** (2024 form) | — |
| 10 | **Playing Handicap** = unrounded CH × allowance%, **rounded** (not floored). Allowances: singles match 100%, stroke 95%, 4-ball match 90% | Match net strokes `Math.floor(mag)`; allowance default 100% | 🟡 Floors instead of rounds; per-format allowance defaults not enforced | 1 (round) / 3 (defaults) |
| 11 | **Match-play allocation** (low to scratch, others get the difference, by SI) | Per-player strokes by SI (each vs scratch) | 🟡 Close; stroke-net style, not strictly low-relative match-play (acceptable for net leaderboards) | 3 |

## Fix plan (tiered)

**Tier 1 — clear, high-impact, bounded (build now, `handicap.js` + the match round):**
- Remove `×0.96`.
- Implement the **sliding table** (best-N + the −2.0/−1.0 adjustments at 3/4/6).
- Per-differential **round to 0.1**; **clamp index to 54.0**.
- **Min scores → 3** (was 5).
- Match playing handicap: **round, not floor**.
→ each with node assertions against worked WHS examples.

**Tier 2 — Adjusted Gross Score / net double bogey — ✅ SHIPPED (`2f171c0`):**
- Each hole capped at net double bogey (par+2+strokes; par+5 pre-establishment) before the differential. Pure `strokesOnHole`/`netDoubleBogey`/`adjustedGrossScore` (15 assertions). Wired via `roundDifferential` using the player's current Index for stroke allocation + per-hole data (round/outing pars; outing stroke index; **solo rounds default SI to 1..18** — flagged, capturing real SI on solo rounds is a precision follow-up). `stats.js` aligned so the displayed index matches the persisted one. 18 assertions incl. an integration proof. No migration (reuses existing columns).

**Tier 3:**
- **Soft/hard caps — ✅ SHIPPED (`9d0c1c9`):** migration 032 `tm_handicap_history` persists each index revision; Low HI = MIN over trailing 365 days; `applyHandicapCaps` (soft >3.0→50%, hard +5.0) applied after 20 scores. `stats.js` now reads the persisted index (single source of truth — no divergent recompute). 10 caps assertions; WHS+AGS regression green.
- **Per-format allowance — ✅ SHIPPED (`730be0d`):** `whsAllowance(formats)` (Appendix C: singles match 100, four-ball match 90, four-ball stroke 85, individual stroke/Stableford 95) surfaced as a ★ recommendation on the CreateWizard picker; corrected the labels (it had called 90% "singles match" — wrong; singles match is 100%).
- ☐ **Proper 9-hole handling** — **genuine data dependency:** needs 9-hole tee Course/Slope ratings captured (the WHS expected-9 method combines a 9-hole differential with an Index-based expected-9). We don't capture 9-hole ratings, so this can't be done correctly yet. Left unchanged (18-hole is the primary flow) rather than ship a half-correct version. Follow-up: capture 9-hole ratings → implement expected-9.
- ☐ **Solo-round Stroke Index capture** — **data plumbing:** solo rounds store hole pars but not Stroke Index, so AGS defaults SI to 1..18 for them (a small second-order effect on the net-double-bogey cap — outing rounds use real SI). Follow-up: pass the course Stroke Index in the solo round POST + store it (migration) + COALESCE it into the handicap query.

## Honest scope note
PCC and the soft/hard caps genuinely need data a standalone app doesn't have (the field's same-day scores; a persisted year of index history). The consumer-app norm — and what we'll do — is: implement everything else faithfully, **set PCC = 0** (correct on most days), and **label the index an estimate** (only an authorized association issues an official handicap). Tier 1 + Tier 2 gets us to a value that matches an official index for the large majority of golfers within ~0.1–0.2.

## Impact flag
Tier 1 **raises most players' indexes** (removing the 0.96 alone adds ~4%) and corrects low-score-count indexes. This changes displayed handicaps — and, via Course Handicap, match net results. It makes us *correct* (matching the major apps), but it's a visible change to flag.

*Sources: USGA + R&A Rules of Handicapping (2024) — Rules 3.1, 5.1a, 5.2, 5.3, 5.6, 5.7, 5.8, 6.1, App. C; USGA 2020 Change Summary (0.96 removed); USGA 2024 changes (CR−Par in Course Handicap). Researched this session; competitors referenced generically.*
