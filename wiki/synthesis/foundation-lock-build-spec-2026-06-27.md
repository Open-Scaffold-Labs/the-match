---
type: synthesis
created: 2026-06-27
updated: 2026-06-27
tags: [the-match, build-plan, foundation-lock, scalability, accuracy, usability, visual-flow, competitive]
---

# The Match — Foundation-Lock Build Spec & Master Checklist (2026-06-27)

*Companion to `audit-2026-06-27.md` (findings), `build-plan-bulletproof-2026-06-23.md` (Track F lives there), and `POST-LAUNCH-TODO.md`. This is the strategic, failure-mode-hardened build plan for getting The Match to "biggest golf app, built right the first time" across the three pillars Matt named: **usability, accuracy, visual flow.** Competitive intel below is from a 3-agent research pass on the most-used golf apps; per the no-competitor-names rule every reference is generic.*

> **Autonomy note (this session):** the safe, reversible, build-verified slices were executed and pushed to beta `main` (see §1). The high-risk data-model cutover (F.5/F.6) and anything needing a real on-course multiplayer device test is **specced here but deliberately not executed** — those land with Matt's device verification, not blind.

---

## 0. The organizing principle — the App Store freeze

Everything splits into two buckets:

- **Freeze-sensitive / irreversible** — API contract, data model, auth shape. Cheap now, brutal once installed native apps depend on them. *This is the "don't come back and change it" bucket — lock it before the first native binary ships.*
- **Reversible anytime** — server config, indexes, infra, product features. Changeable forever.

"Build it right the first time" = get the first bucket right before launch. Polish and features (the second bucket) win the market but are never forced rewrites, so they come **after** the foundation is poured.

**Verification gate on every code change (non-negotiable):** `npm --prefix client run build` + `run lint` + `node --check` on changed server files + the relevant test runner + (for server routing/data changes) a live boot smoke test → only then push to beta `main` → device-test on a real iPhone for anything runtime-visible → audit-before-claim before declaring done.

---

## 1. Shipped this session (build-verified, on `main`)

Track F "slice 1" — all reversible, all gated through build+lint+check+tests+server-smoke:

- ☑ **F.1 `/api/v1` versioning** — every route on one router dual-mounted at `/api/v1` (canonical) + `/api` (legacy alias); client rewrites `/api/*`→`/api/v1/*` centrally (one constant, zero call-site churn). Smoke-verified: both mounts route, db-gate + auth enforced under v1, clean 404 fallthrough. *This is the keystone — it makes every future change non-breaking for installed apps.*
- ☑ **F.4 CI is a real gate** — lint `continue-on-error` removed (the `no-undef` rule that catches the 2026-06-06 ReferenceError class can now fail a build); new `test` job runs vitest suites + `node --test` math checks (server) + client unit tests. All verified green locally.
- ☑ **F.2 serverless pool** — `max 5→2` in prod + `allowExitOnIdle`. (Still TODO: confirm `DATABASE_URL` is the transaction-mode pooler, port 6543 — Matt, in Vercel env.)
- ☑ **F.3 indexes** — migration `035_tm_outings_indexes.sql` written (status partial+full, host_id), `CONCURRENTLY`. **NOT applied — Matt applies by hand.**
- ☑ **F.10 native-shell sentinel** — `isNativeShell()` + gated the PWA "Add to Home Screen" prompts off in the native shell (no-op in current PWA, so beta unchanged).
- ☑ **F.12** — server vitest scoped to real suites; client `test` script added.
- ☑ **F.13 two real bug fixes** — friendly camera-permission error (was raw `NotAllowedError`); fixed dead GPS `denied` banner branch → `denied-hard` (was showing "move to an open area" to permission-blocked users).

---

## 2. The master checklist

Legend: ☐ not started · ◐ in progress / specced · ☑ done · 🔒 freeze-sensitive (lock before native launch) · ⚠ needs device test

### Track F — remaining (Scale & Foundations)

**F-data-model (🔒 the highest-value, highest-risk — the "never lose your round" wedge)**

Competitive finding: **no major golf app reliably avoids losing rounds.** The dominant tournament platforms dodge the problem by allowing only one scorer per group; the big social scorecard apps allow multi-writer but resolve conflicts as last-write-wins with at best a "conflict" toast — and their forums are full of "lost my round" complaints (watch-sync drops whole rounds, offline rounds stuck un-synced, "deleted one duplicate card, lost both"). Nobody ships true optimistic-concurrency. **That makes "we never lose your round" a genuinely ownable promise** — and it's exactly what F.5/F.6 deliver.

- ◐🔒⚠ **F.5 Participants as the single source of truth for live scores.** Staged so every step is reversible:
  1. *(additive)* Add `score_version INTEGER` (optimistic-concurrency token) to the per-player score store + a durable idempotency key per queued mutation. Reads still derive from participants (already JOINed everywhere). → verify: leaderboard parity vs. today on a test outing.
  2. *(additive)* Server writes a player's score via `UPDATE … WHERE score_version = $expected`; on mismatch return 409 with both values and **keep both** (never silently clobber — beats the incumbents' last-write-wins). → verify: simulated concurrent double-write keeps both, surfaces conflict.
  3. *(additive)* Move guests to real participant rows (`is_guest` + nullable `user_id`) so there's ONE participant model, not two. → verify: guest scores survive a reload.
  4. *(cutover, ⚠ device test)* Stop writing scores into the `state` JSONB; `state` becomes config-only (groups/teams/policy). → verify on a real 4-player match: no score loss, leaderboard correct.
  - **Failure modes + mitigations:** migration/backfill on live outings → do it additive-first, backfill in a transaction, keep JSONB as fallback until step 4 proves out · concurrent writes mid-migration → version guard is in before cutover · client contract change → `/api/v1` already shipped, so this evolves under versioning.
- ◐🔒⚠ **F.6 `/end` match-close batching.** Today it's O(N²) sequential inserts (pair loop) + a sequential per-player handicap/referral loop → a 150-player league close ≈ 11k round-trips → **exceeds the Vercel function timeout and half-closes the event.** Fix: one multi-row `INSERT` (or `unnest`) for the pair history; move handicap/referral fan-out off the request path (queue or set-based). → verify: h2h rollup identical before/after on a test outing; timed close of a large simulated field stays well under the 60s function limit.
- ☐ **Designated-scorer mode for leagues/tournaments** (competitive best-practice): default the highest-stakes rounds to one group scorer (with optional self-scoring), sidestepping concurrency entirely — what the reliable tournament platforms do.
- ☐ **Durable offline queue hardening** (we already have an offline queue — the right pattern): persist it so a mid-round crash can't lose it; idempotency keys so a flaky-signal retry can't double-apply; visible "unsynced" state that auto-resolves (don't make the user pull-to-refresh).
- ☐ **Human-review step before a score hits the WHS handicap record** (the official-handicap bodies do this) — protects index integrity and gives a reconciliation point.

**F-security (🔒 server-side, greenlit in handoff)**

- ☐🔒 **F.7 JWT revocation** — add `tm_users.token_version`, embed + check it, bump on `reset-pin`/logout-everywhere; consider shorter TTL + refresh. (90-day un-revocable token survives a PIN reset today.) → verify: post-reset old token rejected.
- ☐ **F.8 PIN brute-force** — account-keyed rate limit + exponential lockout in a **shared store** (`tm_login_attempts` or Upstash); in-memory per-IP limiter is defeated on serverless. Consider 6-digit PINs. → verify: lockout holds across simulated cold starts.

**F-native-shell (🔒⚠ verify together in TestFlight)**

- ☐🔒 **#25 iOS Info.plist usage strings** (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`) — crash + hard rejection without them.
- ☑ **#26 (web side) sentinel flag** shipped (F.10); ☐ native side: inject `window.__TM_NATIVE__` from the WKWebView; handle `target="_blank"`/`mailto:` via `WKUIDelegate` so the in-app Privacy Policy link opens.
- ☐⚠ **#24 safe-area / zoom / first-tap keyboard** — `contentInsetAdjustmentBehavior = .never`, drive insets natively; verify edge-to-edge + keyboard-on-first-tap on device.

**F-opportunistic**

- ☐ **N10** decide + enforce scorecard privacy on `GET /rounds/:id` (enumerable by sequential ID today).
- ☐ **N11** wrap remaining bare-assert tests as real suites over time (CI already runs them via `node --test`).
- ☐ **N13–N15** split `Home.jsx`/`LiveOuting.jsx` god-files; light client state pattern (`UserContext`); engineer-facing `README.md`.

### Pillar: ACCURACY (Eagle Eye — beat the leaders, don't match them)

Competitive finding: the market converged on a **map-first hole view with a draggable target**; F/C/B is table stakes; plays-like is now parity, not edge; the accuracy leader ships a **graded, always-visible GPS confidence state** (radius ring + green/amber/red + a "why + how to fix" banner), which is better than our current binary suppress-and-"acquiring". The loudest accuracy complaints across all apps: distances that lag / don't update while walking, confidently-wrong numbers (often bad course maps, not GPS), and **battery dying before 18**.

- ☐ **Upgrade the accuracy gate from binary to graded** — keep the hard suppress as the floor for the primary number, but add a graded confidence chip + accuracy ring, and when gated show the **last-good number greyed with a live "±Xm, tightening…"** affordance instead of a blank. Transparency earns trust; it also stays within the marketing stance (a live observed state is not a product precision claim). → verify on-course: never a blank map mid-fairway; chip tracks reality.
- ☐ **Split "GPS noisy" (gate) from "course map looks off"** — outliers are usually mapping; conflating them makes the gate feel broken. Add a one-tap "this hole looks wrong" report loop.
- ☐ **Plays-like transparency** — always show raw AND adjusted together with the breakdown (+elev, +wind, +temp); never a black-box single number. (We mostly do this — audit the surface.)
- ☐ **Own-club arcs = distribution band, not mean.** Plot a carry band (e.g. 25th–75th pct, "7i: 150–162"), don't discard good shots. This both beats the known naive-mean bug in a top stats app AND fits our no-precision-margin stance (a band is honest about spread). → verify: arcs reflect spread, not a false-precise line.
- ☐ **Battery discipline (top-3 complaint, currently unowned in our plan).** Adaptive GPS sampling (high rate stationary near a shot, throttle while walking/cart) + screen-dim idle. Pairs with the gate (we already know GPS state). Goal: survive 36 holes. → verify: measured battery over a simulated round.
- ☐ **Instant-on + prefetch.** Show a number (even greyed last-good) immediately on hole-open, refine after; prefetch next hole's geometry while putting. Animate number transitions so live updates read as "alive." Latency is THE premium/clunky line.

### Pillar: USABILITY (own the white space)

Competitive finding: the loudest functional complaint category-wide is the **"wrong hole" bug** (misattributed distances/scores) — and it's unowned. Onboarding leaders reach a GPS distance in **under 5 minutes**; the cautionary tale stacks ~10 upsell screens before the first round. Mid-round modals/upsells make golfers uninstall. Multiplayer/side-games + the data→practice loop are repeatedly-requested **white space** — and both are already Match pillars.

- ☐ **Make "wrong hole" impossible by design** — confident GPS hole-detection + one-tap correction; never misattribute a score. Market it: "it just keeps score, every time."
- ☐ **Score entry ≤2 taps, zero mid-round modals/upsells** — extend the existing "no broken/empty states" rule to "no interruptions during a round."
- ☐ **First GPS distance in <5 min; defer account creation** — reach a yardage with minimal friction, then ask for email + 4-digit PIN to *save*. Contextual permission prompts (Location at "start round", not a cold-launch wall).
- ☐ **Multiplayer + side-games (Skins/Nassau/Wolf) done right** — our strongest wedge; the segment is underserved. Real-time shared cards + organizer tools.
- ☐ **Close the data→practice loop** — SG/weakness → personalized plan → track improvement (migration 034 already targets this); near-unique in the market.
- ☐ **Keep all stats in-app + editable on the phone** (beats the apps that strand stats on a website).

### Pillar: VISUAL FLOW (premium = restraint + zero latency)

Competitive finding: the most-praised app wins on "clean / minimalist / uncluttered"; the criticized one loses on "cluttered / overwhelming + pop-ups." The native-feel killer for a web-shell app is the **blank-then-jump tap transition**; ad-jank and memory bloat over a long session also read as "not native" (a major app crashes ~400MB).

- ☐ **Phase 0 design foundation** (from the bulletproof plan): dark-elevation + layered-shadow tokens (0.1), type system + mono "instrument" numerals on every live number (0.2), motion discipline — transform/opacity only, 200ms ease-out (0.3). Highest perceived-quality-per-hour.
- ☐ **Optimistic / instant transitions** — never blank-then-jump; pre-render, optimistic UI. Highest-leverage native-feel investment for a WKWebView app.
- ☐ **Memory guard over a full 18** — release off-screen canvases, cap in-memory history, one map instance (the ~400MB crash threshold is the warning).
- ☐ **Anchor to restraint** — fewer elements, crisp imagery, generous whitespace; the Augusta-night dark palette already fits.

### Monetization (fair free tier as the brand wedge)

Competitive finding: the loudest review sentiment category-wide is **paywall resentment and clawbacks** (features that were free going behind a sub). Free-GPS-with-no-paywall earns respect; intrusive ads literally degrade app stability in one app. Native iOS digital subs **must** use Apple IAP.

- ☐ **Generous, never-claw-back free tier** — GPS rangefinder, live multiplayer + leagues, WHS handicap, basic stats, achievements, referrals stay free permanently. (Multiplayer-free is the acquisition engine.)
- ☐ **No intrusive ads in free** — monetize via Elite conversion, not ad jank.
- ☐ **Elite via Apple IAP / StoreKit** (#18) — mandatory for native; honest restore-purchases + cancellation. *Pricing note:* the ~$90/yr target sits at the top of the category; since fair pricing is the wedge, consider anchoring nearer ~$60/yr or clearly under the premium incumbents. Strategic call — worth A/B testing.

---

## 3. Cross-cutting failure-mode register

| Risk | Mitigation (built in) |
|---|---|
| Score loss in concurrent multiplayer (the category's #1 rage trigger) | F.5 version guard + per-player row ownership + non-destructive conflict + durable idempotent offline queue → the "never lose your round" promise |
| Large league close times out (flagship Elite feature) | F.6 batch inserts + off-request fan-out; verify under the 60s function limit |
| Connection exhaustion at launch traffic | F.2 pool max=2 + transaction-mode pooler |
| Breaking installed native apps with a server change | F.1 `/api/v1` shipped — evolve under versioning |
| Confidently-wrong yardage destroys trust on hole 1 | hard accuracy gate (shipped) + graded confidence upgrade + GPS-vs-map split |
| Phone dies before 18 | battery discipline (adaptive sampling) |
| App Store rejection | #25 usage strings, #26 sentinel (web side shipped), #18 IAP, #24 safe-area — all tracked, verify in TestFlight |
| A clean build that ReferenceErrors on device | CI lint hard gate (shipped) |
| Regression during all this work | CI test job (shipped) + audit-before-claim discipline |

---

## 4. Recommended sequence (from here)

1. **F.5 stages 1–3 + F.6** (additive, behind verification) — the "never lose your round" foundation, plus the league-close fix. Land additive parts to beta; **cutover step F.5.4 + F.6 with Matt's real-match device test.** 🔒
2. **F.7/F.8 security** — server-side, shippable with tests.
3. **Native-shell pass** (#25/#26-native/#24) — TestFlight, together.
4. **Accuracy upgrades** (graded confidence, distribution-band arcs, battery, instant-on) — the on-course "better than the leaders" layer.
5. **Phase 0 visual foundation + usability white-space** (wrong-hole-proof, ≤2-tap, side-games, practice loop) — what wins the market.
6. **Monetization** (IAP + fair free tier) before submission.

Operational (Matt, parallel, no code): apply migration 035; confirm transaction-mode pooler; migrate to org Vercel/Supabase Pro; set the Anthropic spend cap (#13).

*Competitive research compiled this session from public docs, store reviews, and forums across the most-used golf apps; all references kept generic per the no-competitor-names rule. Source URLs are in the session record.*
