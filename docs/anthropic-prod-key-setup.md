# SG v2 / AI Caddie — greenlight + Anthropic prod key setup

*From Matt (drafted with Claude), 2026-07-02. For Dale.*

## The greenlight

PR #1 (`feat/sg-v2`) is **approved**. The review ran your branch in an isolated
worktree off current `main`: client lint/build clean, client tests 10/10, server
vitest **70/70** — all confirmed first-hand. Migrations 039/040 verified applied to
prod (all six columns present). F.5 non-interference confirmed: no outing-scoring
files touched, putt facts join via the owner-scoped `PATCH /rounds/:id/putts`
exactly as you described. The read-time-SG / facts-only architecture and the
10-round putting honesty gate are exactly the standard this project is built to.
Your keyless-ANALYZE diagnosis also checked out — all 16 prod env vars listed,
no `ANTHROPIC_API_KEY`, and the SDK defers the key error to request time, which
is why every other eagle-eye route kept working. Nice catch.

The **only merge prerequisite** is the key below. Minor non-blocking follow-ups
from the review (fine as post-merge commits):

1. Strip newlines from the client-supplied `round` context before it enters the
   Caddie *system* prompt (self-injection only, but cheap hygiene).
2. `claude-sonnet-4-20250514` is a year-old snapshot — a current Sonnet gives a
   sharper caddie at the same price class. One-line bump + a quick answer-quality
   spot check.
3. The `COALESCE` pattern means tendencies can't be cleared back to "unknown"
   once set (same known limitation as gender — noting, not asking).
4. `FriendProfile.jsx:169` hardcodes `#F5D78A` on an app-theme surface — goes on
   the Phase-4.3 sweep pile, not on you.

## The key — set it up as a company account, not a personal one

Prod AI spend shouldn't ride on either of our personal keys. Since we're both
Vercel team owners, either of us can install it — the decision that matters is
**whose Anthropic account backs prod**. Proposal: a company one, today, like this:

**1. Create the company org in the Anthropic Console** (console.anthropic.com).
Sign up / sign in, then create an **Organization** for Open Scaffold Labs and
invite the other of us as admin — that way neither of us is a bus factor and
billing visibility is shared.

**2. Add the company card + set a hard spend cap** (Console → billing/limits).
Start the monthly limit at **$25–50** — beta usage math says a few dollars/month
(Caddie ≈ 1–2¢ per message at Sonnet's $3/$15 per M tokens, ANALYZE similar, and
your 20-per-5-min rate limiter caps the worst case), so a $25 cap is generous
headroom AND a hard ceiling no bug or abuser can blow through.

**3. Mint TWO keys, named for what they do:**
- `the-match-prod` — goes to Vercel only
- `the-match-dev` — local `.env` files

Separate keys = rotate one without killing the other, and per-key usage shows up
attributed in the console.

**4. Install the prod key on Vercel:**
```
vercel env add ANTHROPIC_API_KEY production --scope open-scaffold-labs
```
(paste `the-match-prod` when prompted — never commit it, never paste it in
chat/Slack/PR comments), then **redeploy** so the serverless env picks it up.

**5. Verify end-to-end:** after redeploy, send one Caddie message on the beta and
confirm a real reply (not the "lost signal" 500). That also un-blocks ANALYZE —
which was never broken code, just keyless — so re-surfacing the camera button
becomes a real option once the flow gets an end-to-end device pass.

**6. Tell Matt which account it landed on** so the wiki/trust anchors record where
prod billing lives.

## Sequencing

Key installed + redeploy verified → merge PR #1 (migrations already on prod, so
merge order vs. deploy doesn't matter beyond the key) → beta test pass: putt
chips + ShotSheet on a real round (Matt's next round), Caddie answer quality
spot-check against the profile facts.
