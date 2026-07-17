# OTA Runbook — self-hosted live updates for The Match

> How to ship, verify, and roll back over-the-air web-bundle updates for the native
> app, without App Store review. Architecture decision + scoping:
> `wiki/synthesis/self-hosted-ota-scoping-2026-07-16.md`. Wire contract:
> Capgo self-hosted auto-update docs (fetched + implemented 2026-07-16).

## How it works (30 seconds)

The `@capgo/capacitor-updater` plugin inside the native binary POSTs device info to
**our** server on every app open (`updateUrl` → `POST /api/v1/ota/updates`). The
server (`server/src/routes/ota.js`) answers from `tm_ota_bundles` (migration 049):
either `{version, url, checksum}` — the plugin downloads the zip from Supabase
Storage, verifies the checksum, swaps to it on next launch — or `{message}` (do
nothing). `notifyAppReady()` (already wired in `client/src/lib/native.js`) confirms
a new bundle booted; if it doesn't fire, the plugin auto-rolls-back on device.

**What OTA can ship:** anything in the web build — JS, CSS, assets, copy.
**What it can NOT ship:** native changes (new plugins, Info.plist, entitlements,
capacitor.config). Those need a store release. See "The discipline" below.

## Publish an update

```bash
# from repo root, on Matt's Mac (.env needs DATABASE_URL, SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY)
node scripts/ota-publish.mjs --version 1.0.1 --min-native 1.0.0 --notes "fix X"
```

The script: builds the client (prod API origin) → zips via `@capgo/cli` (the
plugin requires Capgo's zip layout — never hand-zip) → verifies sha256 locally →
uploads to the public `ota-bundles` bucket → **verifies the public URL actually
serves** → transactionally deactivates the old bundle and activates the new one.
`--dry-run` stops before upload/activation.

Version rules:
- Strict semver `X.Y.Z`, strictly greater than what devices run, unique per channel.
- `--min-native`: the OLDEST native binary version this bundle is safe on. If the
  bundle uses a native plugin added in binary 1.1.0, set `--min-native 1.1.0` —
  older binaries then simply never see it (endpoint gate, test-covered).

## Roll back

```bash
node scripts/ota-rollback.mjs --list          # see recent bundles
node scripts/ota-rollback.mjs --to 1.0.0      # stop serving the bad version
node scripts/ota-rollback.mjs --off           # panic switch: serve nothing
```

Rollback semantics (understand this): the endpoint **never serves a downgrade**
(devices on a newer bundle get "up to date" — test-covered). So rollback stops the
bleeding for devices that haven't updated yet; devices already on the bad bundle
recover when you `ota-publish` a FIXED, HIGHER version. If the bad bundle fails to
boot at all, the plugin's `notifyAppReady` watchdog already rolled those devices
back on-device. Standard incident: `--to` previous (stop spread) → fix → publish
vNext (heal everyone).

## The discipline (how OTA goes wrong, and our guards)

| Failure mode | Guard |
|---|---|
| Bundle calls native code the binary lacks → crash loop | `min_native_version` gate in the endpoint (tested); set it honestly on every publish |
| Broken JS that won't boot | plugin `notifyAppReady` auto-rollback on device |
| Corrupt/tampered download | sha256 checksum in the update payload; plugin verifies before install |
| Bad zip layout bricks install | zips produced ONLY by `@capgo/cli` (pinned root devDependency) |
| Server down / DB error at check time | endpoint fails SAFE: 200 `{message}` → device keeps running (tested) |
| Bundle uploaded but URL unreadable | publish verifies public URL BEFORE the DB flip |
| Two bundles active at once | partial unique index (`one active per app+channel`) + transactional flip |
| Downgrade loops | endpoint never serves version <= device's (tested) |
| Wrong app asks us for updates | `app_id` allowlist (tested) |
| Stats pipeline breaks devices | stats endpoint always 200s; insert failures swallowed (tested) |

## Go-live checklist (ONE-TIME, before first real OTA)

1. **Apply migration 049** to prod (Matt, by hand): `psql "$DATABASE_URL" -f migrations/049_tm_ota_bundles.sql`
2. Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to the repo `.env` (Matt's Mac only — the service key must never reach the client or Vercel client env).
3. Deploy the server (`main` → Vercel) so `/api/v1/ota/updates` is live; smoke it:
   `curl -X POST https://the-match-roan.vercel.app/api/v1/ota/updates -H 'Content-Type: application/json' -d '{"app_id":"com.openscaffoldlabs.thematch","version_name":"builtin","version_build":"1.0.0"}'`
   → expect `{"message":"no active bundle"}`.
4. **E2E in the simulator** (before flipping autoUpdate):
   a. `ota-publish --version 1.0.1` with a visible change;
   b. temporarily set `"autoUpdate": true` in capacitor.config.json, `cap sync`, build, run;
   c. open app twice (check → install-on-relaunch); verify the change shows;
   d. verify a stats row landed in `tm_ota_stats`.
5. Flip `"autoUpdate": true` permanently in capacitor.config.json — **this must be
   in the binary submitted to the App Store** (OTA can't enable itself).
6. Add a wiki log entry per publish (version, what shipped, min-native).

## Current state (2026-07-16)

- Endpoint + tests (14, in `server/test/ota.test.js`) + migration 049 + scripts: ON
  BRANCH `feat/ios-native-capabilities`, not merged; migration NOT applied to prod.
- capacitor.config.json points updateUrl/statsUrl at prod; `autoUpdate:false`
  until the e2e above passes.
- Storage bucket is created automatically by the first publish.
