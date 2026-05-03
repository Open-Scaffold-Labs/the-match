---
type: todo
created: 2026-05-03
priority: critical
---

# 🚨 Rotate JWT_SECRET in Vercel — DO AFTER TOMORROW'S ROUND

The current `JWT_SECRET` in Vercel prod is the literal placeholder
`change-me-to-a-long-random-string`. This is a default value that
ships in `.env.example`-style files everywhere and is publicly known.
Anyone who reads the codebase or guesses can mint a JWT for any
`user_id` and impersonate that user — read their data, send messages
on their behalf, accept friend requests, etc.

We deferred rotation tonight (2026-05-03) so Matt and his playing
group are not at risk of getting logged out mid-round tomorrow
(2026-05-04). Rotate as soon as the round is done.

## How to rotate (5 minutes)

```bash
# 1. Generate a fresh 64-char random secret
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"

# 2. In Vercel project settings → Environment Variables → JWT_SECRET
#    Edit the value, paste the new secret, save (Production env)
#    OR via CLI:
echo -n "<new-secret-here>" | vercel env rm JWT_SECRET production --yes
echo -n "<new-secret-here>" | vercel env add JWT_SECRET production

# 3. Force-deploy so the lambda picks up the new env var
vercel --prod --yes --force

# 4. Run the smoke test to confirm /me + signup + login still work
node scripts/smoke-test-auth.js

# 5. Tell users (you, Sean, Daniel, Matt Gillen) they need to log back in.
#    Their existing JWTs will fail with 401 until they re-login.
```

## Why we caught this

The 2026-05-03 audit (after the User-shape-drift bug) hit the smoke
test failing because the smoke-test minted a token locally that the
server couldn't verify. Investigation revealed the local `.env` and
prod env both had the literal `change-me-...` placeholder. See
`server/src/lib/user.js` and `scripts/smoke-test-auth.js` for the
infrastructure that surfaced this.

## Related

- The same `JWT_SECRET` is in your local `.env` file. Update that
  too (after rotation), or your local `npm run dev` will fail to
  validate tokens issued against the new prod secret.
- Consider also rotating `VAPID_PRIVATE_KEY` since the same paste
  habits introduced the trailing-`\n` bug 2026-05-02. New keys
  should be stripped of whitespace before being put in Vercel.
