---
type: synthesis
created: 2026-07-16
updated: 2026-07-16
tags: [ota, capgo, self-host, infra, decision]
---

# Self-Hosted OTA for The Match — Scoping One-Pager (2026-07-16)

> **Decision doc for Matt + Dale.** Question: run our own OTA update backend instead of paying
> Capgo Cloud ($12/mo annual Solo; ~pennies/mo on credits at beta scale)? Verified facts below
> come from Capgo's plugin docs/README (MPL-2.0) and pricing page, fetched 2026-07-16.

## The key technical fact that makes this feasible

The `@capgo/capacitor-updater` plugin **already in The Match's binary** is open source (MPL-2.0)
and explicitly supports pointing at ANY backend via three config URLs:

| Config | Default (Capgo Cloud) | Self-host: point at |
|---|---|---|
| `updateUrl` | `https://plugin.capgo.app/updates` | our endpoint: "what's the latest bundle?" |
| `statsUrl` | `https://plugin.capgo.app/stats` | ours, or `""` to disable stats entirely |
| `channelUrl` | `https://plugin.capgo.app/channel_self` | ours (channels; optional for v1) |

So self-hosting = **keep the plugin exactly as shipped, change three URLs in
capacitor.config.json, and stand up the server side.** No native rebuild beyond a config sync.
Apple/Google compliance is unchanged (JS/asset updates in a webview are explicitly permitted;
the plugin README documents both stores' policies).

## Two ways to self-host (very different effort)

### Option A — Minimal DIY update server on our stack (recommended if we self-host)
Build only the `updateUrl` contract: device POSTs its app id/platform/current version → server
responds with `{version, url}` of the newest bundle (or "no update"). Components, all on infra
we already run:

1. **Storage**: Supabase Storage bucket for zipped web builds (`dist` zips, ~5–10 MB each).
2. **DB**: one table (`tm_ota_bundles`: version, channel, storage URL, checksum, active flag,
   rollback pointer). Optionally a stats table.
3. **Endpoint**: one Vercel serverless route (or Supabase Edge Function) implementing the
   update-check contract. (Step 0: pull the exact request/response JSON schema from Capgo's
   self-hosted docs — the shape is documented; verify before coding.)
4. **Upload script**: `npm run ota:publish` — builds the client with `VITE_API_ORIGIN`, zips
   `dist`, uploads to the bucket, inserts the DB row. ~50 lines of Node.
5. **Rollback**: flip the `active` flag to a previous row. Instant.

**Effort estimate (honest):** ~2–4 focused days to working v1 + a real end-to-end test
(publish → sim pulls update → verify → rollback test). Add 1–2 days for polish (checksums,
channel support for beta-vs-prod, a tiny admin page in the Hub — natural fit for a Hub page).
**Ongoing cost:** ~$0 (rides existing Supabase/Vercel). **Ongoing ops:** we own it — if updates
misbehave at 2am before a launch, that's us, not a vendor.

**What we give up vs Capgo Cloud:** delta updates (we ship full bundles — fine at our size),
E2E-encrypted bundles (HTTPS still protects transit), global CDN edge latency (Supabase storage
is plenty for US golfers), device-level health stats (their statsUrl telemetry is genuinely
nice: crashes, ANRs, WebView health), staged/percentage rollouts (v1 = all-or-nothing per
channel), and their dashboard.

### Option B — Run Capgo's full open-source backend
Their entire cloud (API, dashboard, channels, stats) is open source and **built on Supabase** —
literally our stack. But it's a large production system tuned for multi-tenant scale: many edge
functions, queues, their schema, their upgrade cadence. Running and upgrading a fork of someone
else's whole SaaS for one (later a few) app(s) is more ops than the value justifies at our size.
**Not recommended now.** (License check required before ever productizing anything from it —
plugin is MPL-2.0; verify the backend repo's license, unverified as of this doc.)

## Could this "compete with Capgo" as a product?
Technically buildable over months, strategically wrong now (full reasoning in chat 2026-07-16):
their moat is the periphery (delta updates, signed+encrypted bundles, 7-continent CDN, SOC 2,
dashboard, billing, years of edge cases), the market is small and price-capped ($12/mo), and
every month spent there is a month not spent making The Match the biggest golf app. The sane
path to that outcome, if ever: build Option A for ourselves → let it mature across OSL apps →
productize only if it becomes obviously excellent internal tooling. Evidence first.

## Recommendation matrix

| Path | $ | Time to working OTA | Ops burden | Fit |
|---|---|---|---|---|
| **Capgo credits → Solo** | ~pennies now, $12/mo at launch | ~30 min setup | none | **Fastest to launch — default** |
| **Option A DIY** | ~$0 | ~2–4 days build + e2e test | ours, small | Best if infra-ownership matters (Limitless Stack ethos) |
| Option B full fork | ~$0 cash | days–weeks + upgrade treadmill | heavy | Not now |
| Build a competitor | months | n/a | a second company | No (pre-launch) |

**Bottom line:** if the $12/mo is the only objection, Option A is a real, bounded, ~3-day
project on infra we already run — genuinely viable, not a trap. If speed-to-App-Store is the
priority, Capgo credits/Solo now and revisit Option A post-launch (the plugin's 3-URL design
means switching later is a config change, not a migration).

**Decision owner:** Matt (+ Dale). No deadline pressure — `autoUpdate` is off; the capability
ships either way. Decide before the first real OTA push (realistically: post-launch).
