---
type: todo
created: 2026-05-06
updated: 2026-05-07
priority: high
---

# Post-launch TODO — items deferred from polish-pass

Tracking work that came out of polish-pass sessions but was explicitly
deferred. Each item has a one-line context plus the next concrete step.
When picked up, move into `wiki/log.md` as a separate session entry and
remove from here.

**Status snapshot (2026-05-07 PM):** #11 (privacy + delete-account) closed.
New items added: #14 (Forgot PIN email activation), #15 (NotebookLM
unverified entries), #16 (achievement expansion ideas), #17 (preflight
main-bucket verified_at check). Plus 7 audit-2026-05-07 polish items
remain in `synthesis/audit-2026-05-07.md` (MEDIUM #4, #6 + LOW #7-#11).

## 14. Activate Forgot PIN email delivery

The full Forgot PIN reset flow shipped 2026-05-07 PM (migration 025, server endpoints, Login.jsx modes) — but `sendResetEmail()` in `server/src/routes/auth.js` currently `console.log`s the reset URL instead of actually emailing it. The token IS created in the DB, the link IS valid, the reset endpoint works end-to-end. What's missing is the email step.

**Why it's stubbed:** the-match has no email provider wired up yet. Adding one requires Matt to sign up for an external account (Resend, SendGrid, Postmark, SES) — Claude shouldn't create accounts on Matt's behalf.

**Activation steps (~30 min including signup):**

1. Sign up for **Resend** (https://resend.com) — free tier 100 emails/day, simple API. Or any other provider; Resend is the path of least resistance.
2. Verify `thematch.app` (or whatever sender domain) — add the SPF + DKIM records to DNS.
3. Generate an API key in the Resend dashboard.
4. Add `RESEND_API_KEY` to Vercel env vars (`vercel env add RESEND_API_KEY production`).
5. In `server/src/routes/auth.js` `sendResetEmail()`, uncomment the marked block (already written + commented out). The block uses `require('resend')` so also add `resend` to `server/package.json` dependencies.
6. Force-redeploy.
7. Smoke-test: forgot-pin → check inbox → reset-pin → confirm sign-in works with the new PIN.

**Next step:** Matt to sign up for Resend.

## 15. Re-add 3 NotebookLM main-bucket entries lacking verified_at

Background: when the new wiki pages were added 2026-05-07 (`POST-LAUNCH-TODO`, `HIGH-PRIORITY-TODO`, `concepts/notebooklm-workflow`, `sources/claude-code-karpathy-obsidian-video-2026-04-14`, `synthesis/eagle-eye-tile-grid-handoff-2026-05-01`, `synthesis/match-page-completion-plan`), the `notebooklm-wiki-refresh.py` script uploaded them to the-match's main bucket (`41e645a3...`) — but 3 of them never received a `verified_at` timestamp:
- `wiki/log.md`
- `wiki/concepts/notebooklm-workflow.md`
- `wiki/sources/claude-code-karpathy-obsidian-video-2026-04-14.md`

The current preflight only verifies the *reminder* bucket's content (covered by check #5), not the main bucket's. So this gap isn't currently flagged.

Two natural follow-ups:

1. **Fix the 3 entries** — anti-pattern #12 protocol (delete + re-add) since `cmd_refresh` is a no-op for file sources. ~5 min:
   ```
   notebooklm use 41e645a3-044d-452b-8e68-a21939e18799
   notebooklm source delete-by-title "log.md" → confirm y
   notebooklm source add "/Users/matthewlavin/the-match/wiki/log.md"
   notebooklm source wait <new_source_id>
   # repeat for notebooklm-workflow.md and the karpathy-obsidian-video source
   ```
2. **Extend the preflight check** — see #17.

Lower priority than #14 — these missing verifications aren't breaking anything, just incomplete bookkeeping.

## 16. Achievement expansion (natural follow-on to first_birdie)

The 2026-05-07 PM session shipped `first_birdie` and proved the pattern:
add a META entry, add detection in `checkAfterHoleScore` or
`checkAfterSoloRound`, the rest is automatic (DB unique-index handles
first-time-only, `AchievementsRow` renders, push + toast fire on unlock).
New runtime detections are 5-10 min each + a 10-line backfill script per
achievement.

Easy candidates (sorted roughly by leverage):

- **`first_par`** — first par on the card. Lowers the floor for new golfers; meaningful first achievement. `score === par && par >= 3`. Backfill: scan all (outing × participant) pars.
- **`breaking_90` / `breaking_85`** — first 18-hole round under 90 / 85. Same pattern as `sub_80`. Useful intermediate goals between sub-100 and sub-80.
- **`front_nine_under_40` / `back_nine_under_40`** — sub-40 nine. Half-round achievements meet players where they are.
- **`streak_three_pars`** — three consecutive pars in a single round. Detects rhythm, not just one-off heroics.
- **`course_collector`** — first time playing 5 / 10 / 25 distinct courses (tier this — three separate badges from one detection).
- **`birdie_hat_trick`** — three birdies in one round. Repeatable would need the unique-index relaxed (or per-round metadata key).
- **`bunker_save`** — bonus if score-entry adds a "sand save" toggle. Half a feature, half an achievement.

**Lower priority but high delight:**

- **`hole_in_one`** — already covered by `first_eagle`'s HIO branch but worth its own dedicated badge. Would need either renaming or splitting (HIO and eagle are not the same thing emotionally).
- **`under_par_hole`** — generalized version of birdie+, repeatable per round. Same unique-index relaxation problem.

**Empty-state copy update:** the home profile says "Drop a birdie, post a sub-80 round, or play three rounds in a week — they unlock as you go." With more achievements, this string should grow or become dynamic ("X achievements unlocked, Y more available").

## 19. Branded short URL for referral links

The referral program (shipped 2026-05-07 PM3) currently generates links like `https://the-match-roan.vercel.app/?ref=AV4Z2Y`. Functional but ugly to copy/paste. A custom short domain — `thematch.app/r/AV4Z2Y` — would be much more shareable.

Pieces to wire:
- Buy or confirm `thematch.app` (or whatever domain) is registered + pointed at Vercel.
- Add a Vercel rewrite: `{ "source": "/r/:code", "destination": "/?ref=:code" }`.
- Update `server/src/routes/referrals.js` `/me` endpoint to build the URL from the new short form.
- Update SettingsModal copy to match.

~30 min once DNS is set up.

## 20. Tighten referral qualifying gate with email verification

`tm_referrals.qualifying_round_at` is currently set when a referred user logs their first round (solo or matched). For v2, we should also require the referred user to verify their email before counting — same gate as the Forgot PIN reset link will use. Depends on POST-LAUNCH-TODO #14 (Resend wiring) shipping first.

Once #14 ships:
- Add `tm_users.email_verified_at TIMESTAMPTZ`.
- Email a 6-digit verify code at signup; user enters it in the app.
- `markReferralQualified()` checks `email_verified_at IS NOT NULL` in addition to having a logged round.

## 21. Anti-fraud hardening for referral program

Current safeguards: `UNIQUE(referee_id)` (a user can only be referred once), self-referral CHECK at the DB layer, and the activity gate (referee must log a round). For v1 launch this is enough. If the program scales and we see gaming, add:
- IP fingerprinting at signup; cluster suspiciously similar IPs.
- Device fingerprint via canvas/WebGL signature.
- Time-window heuristics: 10 signups from one referrer within 60 seconds = likely scripted.
- Manual-review queue for flagged referrals.
- Hard cap per IP per N days.

## 22. Annual reset for referral rewards (if needed)

Currently the model is lifetime — once a user hits 50 qualifying signups, they've earned the max (1 year of Elite) and additional referrals don't earn more. Simple, prevents unlimited free service.

If power referrers hit the cap and we want to keep them motivated, layer a yearly reset: thresholds reset on the user's signup-anniversary, max 1 year of Elite earnable per calendar year.

Don't ship this preemptively — wait for someone to actually max out and complain.

## 18. Hook up "Upgrade to Elite" billing

The Settings page now ships an "★ Upgrade to Elite" button (visible only when `user.tier !== 'elite'`) — currently a visual stub that fires an alert "Coming soon — Elite billing is on the post-launch roadmap." Added 2026-05-07 PM3 alongside the rest of the Settings redesign so the surface is in place when billing is wired up.

Pieces to wire when ready:

- **Provider choice.** Stripe is the path of least resistance for web + iOS-PWA (App Store rules don't apply since The Match is a PWA today; if/when we ship a native iOS shell, IAP will be required and Stripe-on-web becomes "manage subscription" only).
- **Pricing.** The Leagues empty-state copy already advertises "$7.50/mo annual" — that's the v1 price target. Confirm and lock it.
- **Server-side webhook.** `POST /api/billing/webhook` — verifies Stripe signature, on `customer.subscription.created/updated` flips `tm_users.tier` to `elite` (and back to `free` on cancellation). Idempotent, logs + retries.
- **Subscription portal.** Replace the alert in `SettingsModal.jsx` MainView with a call to `Stripe.checkout.sessions.create` (or the Stripe Customer Portal for existing subscribers — manage payment method, cancel, see invoices).
- **Billing-related settings rows.** Once a user has a subscription, the "Upgrade to Elite" button becomes "Manage subscription" with a different action.
- **Test cards + smoke test.** `scripts/smoke-test-billing.js` — assert that subscribing flips tier to elite and cancelling reverts it.

**Next step:** create a Stripe account, generate test keys, decide annual vs monthly pricing model.

## 17. Add main-bucket verified_at check to preflight

See #15 — currently only the reminder bucket has content-verification audit in the preflight. The main wiki bucket can have unverified entries silently. Extend the check in `tools/limitless-preflight.sh` to walk `tools/.notebooklm-wiki-state.json` and warn on any entry without a `verified_at` timestamp. Apply to all 3 deployed copies (the-match, canonical, Hub vault) per the sync contract.

~30 min + back-port. Self-improvement-rule territory (see Roll Call skill — add a check before closing the session that catches a drift mode, this fits exactly).

## 9. Eagle Eye automatic shot tracking

Currently the Eagle Eye AI rangefinder reads a single GPS hit per shot.
The vision was for the round to **auto-log shot distance and club
selection** as you move between shots — no manual taps. The pieces:

- Background GPS subscription while a Solo Round (or matched outing) is
  active. Throttle to 5–10 second cadence; respect Battery Saver / "Low
  Power Mode" (iOS) by backing off to 30s.
- Heuristic shot detection: a stationary period (≥ 8s) followed by a
  movement of ≥ 30 yards = end of shot N, start of shot N+1.
- On detected shot end, fire the existing club-prediction logic against
  the next-distance and surface "Did you hit a 7-iron?" confirmation.
- iOS PWA gotcha: background GPS is not granted to web apps. We'd need
  either a wake-the-page foreground polling loop while the app is open
  OR ship a native iOS shell.

**Next step:** spike the cadence + battery question. Goal: log a 9-hole
round where the app is open the whole time and confirm GPS readings
land with acceptable battery cost.

## 11. Privacy policy + delete-my-account flow ✅ CLOSED 2026-05-07 PM

Closed via commit `56f9d15`. Hosted privacy policy at `/privacy` (HTTP 200, ~6.8KB), `DELETE /api/auth/me` with typed-confirm guard (`req.body.confirm === 'DELETE'`), Settings → "Delete my account" with typed-DELETE confirmation modal. Migration 024 relaxed the two FK constraints that previously refused user deletion. App Store submission unblocked.

Original requirements (preserved for historical context):

- A hosted, linkable privacy policy at `https://the-match.app/privacy`.
  Apple and Google both require the URL be in the app metadata before
  submission. Cover: what data we collect (email, name, avatar,
  scorecards, GPS while round is active), how we use it (rendering the
  app, computing handicaps, analytics), retention (ongoing + delete on
  request), third parties (Anthropic for Eagle Eye, Vercel for hosting,
  Supabase for storage).
- `DELETE /api/me` endpoint that hard-deletes the user row and cascades
  via existing `ON DELETE CASCADE` foreign keys. Verify the FK chain
  hits everything: tm_rounds, tm_outing_participants, tm_friends,
  tm_follows, tm_achievements, tm_outing_messages, tm_outing_side_bets
  (already cascade via outing_id but not user_id directly), tm_clubs,
  tm_push_subscriptions, tm_user_seasons.
- Settings → Account → "Delete my account" with a typed-confirmation
  modal ("type DELETE to confirm").
- Email confirmation step before destruction is recommended but not
  required.

**Next step:** draft the privacy policy text and host it (markdown
served via Vercel route or a simple static page).

## 12. Sentry / error telemetry

Currently we have `console.error` traces and Vercel runtime logs but no
structured error reporting. With users on the course we need to know
when something dies without them having to tell us.

- `@sentry/react` on the client — capture render errors + uncaught
  promise rejections. Strip PII from breadcrumbs (no email, no scores,
  but keep route + user_id).
- `@sentry/node` on the server — wrap routes, capture handled errors
  with context (route, req.user.id, req.body shape).
- Free tier is 5k events/month — fine for our user base.

**Next step:** create a Sentry project (https://sentry.io), get DSN,
add `@sentry/react` import + init in `client/src/main.jsx`.

## 13. Anthropic spend cap

The Eagle Eye feature calls Anthropic's API once per shot. With friends
testing and Eagle Eye getting hammered, there's no upper bound on a
runaway scenario.

- Set a hard monthly budget cap on the Anthropic Console
  (https://console.anthropic.com → Settings → Limits) — recommended
  $50/month for now, raise as user count grows.
- Server-side rate limit per user (e.g., 200 Eagle Eye calls per
  rolling 24-hour window) to prevent a single user accidentally
  blowing the budget.

**Next step:** Matt to set the cap in the Anthropic console (no code
change). Then we add a `tm_user_rate_limits` table or in-memory limiter
on the Node side as a defense in depth.

## 23. Eagle Eye — OSM attribution + geocoder hardening (from 2026-06-01 regression)

Surfaced while fixing the Overpass-mirror regression (see log 2026-06-01). Both are App-Store-scale hygiene, not launch blockers:

- **Confirm OSM attribution.** Eagle Eye renders OpenStreetMap-derived hole geometry and ESRI satellite tiles. ODbL requires an "© OpenStreetMap contributors" credit visible somewhere on the map view. Verify it's shown; add a small attribution line in the HoleMap legend if missing.
- **Replace public Nominatim for geocoding.** The client geocodes course-by-name against `nominatim.openstreetmap.org` directly from the browser with a default UA. Nominatim's usage policy caps ~1 req/sec and discourages production use on their public server. At scale this risks rate-limiting/blocking (a plausible future "geocode suddenly fails" incident). Options: self-host Nominatim, use a paid geocoder, or lean on the Golf Course API lat/long we already have (Fix 1 this session made that a fallback — could promote it to the primary and skip Nominatim entirely, since `/api/courses/:id` returns coords).

## 24. Eagle Eye — make the Overpass holes fetch even more robust (optional follow-on)

The 2026-06-01 fix (per-mirror 10s timeout + lz4-first + retry-once) resolved the ~34s stall. Further hardening if it recurs:
- Persist a successful per-course OSM payload server-side (not just the client localStorage 7-day cache) so a cold course that loaded once for anyone is fast for everyone.
- Consider fetching holes + teegreen with a shorter Overpass `[timeout:N]` and `out geom` only for the current hole's way (lazy-load the rest) to shrink the heaviest query.
- Add lightweight server-side telemetry (ties into TODO #12 Sentry) so OSM fetch latency/failures are observable without needing to be caught live — the runtime logs aged out before we could see this round.
