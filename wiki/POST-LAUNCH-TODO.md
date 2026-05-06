---
type: todo
created: 2026-05-06
priority: high
---

# Post-launch TODO — items deferred from polish-pass

Tracking work that came out of the 2026-05-06 polish session but was
explicitly deferred. Each item has a one-line context plus the next
concrete step. When picked up, move into `wiki/log.md` as a separate
session entry and remove from here.

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

## 11. Privacy policy + delete-my-account flow

App Store / Google Play submission gate. Required components:

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
