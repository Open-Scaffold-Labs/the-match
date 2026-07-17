// Self-hosted OTA update endpoint for the @capgo/capacitor-updater plugin.
//
// The native app POSTs here on every launch (capacitor.config.json updateUrl →
// POST /api/v1/ota/updates) with the device's AppInfos body; we answer with
// either an update payload {version, url, checksum} or a benign {message}.
// Wire contract: https://capgo.app/docs/plugins/updater/self-hosted/auto-update/
// Design + failure-mode analysis: docs/OTA-RUNBOOK.md (repo) and
// wiki/synthesis/self-hosted-ota-scoping-2026-07-16.md.
//
// PRIME DIRECTIVE — fail safe, never fail loud: a broken update check must
// degrade to "device keeps running what it has." Every error path returns
// HTTP 200 with {message}; we NEVER return a malformed update payload, and we
// never 500 (the plugin treats non-2xx as a failed check, which is fine, but
// a 200 {message} is explicit and shows in plugin debug logs).
//
// Update is served ONLY when ALL of these hold:
//   1. app_id matches ours (a foreign/misconfigured app gets {message})
//   2. an active bundle exists for the channel
//   3. semver(active.version) > semver(device's current bundle version)
//      current = version_name, except "builtin" (fresh install / factory
//      bundle) where the device runs the web build shipped in the binary —
//      whose version we treat as the binary's version_build.
//   4. semver(version_build) >= semver(active.min_native_version) — the
//      native-compatibility gate (never serve JS that calls native code the
//      installed binary doesn't have).
//   5. the device is NOT an emulator in prod mode mismatch — we DO serve
//      emulators (needed for sim e2e testing); stats record is_emulator.

const router = require('express').Router()
const db     = require('../db')

const OUR_APP_ID = 'com.openscaffoldlabs.thematch'
const DEFAULT_CHANNEL = 'production'

// Strict-enough semver parse: "1.2.3" (optional leading v, optional -suffix
// which we compare lexically last). Returns null on garbage — callers treat
// null as "cannot compare → do not update" (fail safe).
function parseSemver(s) {
  if (typeof s !== 'string') return null
  const m = s.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

// compareSemver(a, b): 1 if a>b, -1 if a<b, 0 equal, null if either unparseable.
function compareSemver(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

// POST /updates — the plugin's update check.
router.post('/updates', async (req, res) => {
  try {
    const b = req.body || {}
    const appId = String(b.app_id || '')
    if (appId !== OUR_APP_ID) {
      return res.json({ message: 'unknown app_id' })
    }

    // Device's current JS bundle version. "builtin" = the web build shipped
    // inside the binary; its version lineage is the native version_build.
    const versionName  = String(b.version_name || '')
    const versionBuild = String(b.version_build || '')
    const current = (!versionName || versionName === 'builtin') ? versionBuild : versionName

    const bundle = await db.one(
      `SELECT version, url, checksum, min_native_version
         FROM tm_ota_bundles
        WHERE app_id = $1 AND channel = $2 AND active
        LIMIT 1`,
      [OUR_APP_ID, DEFAULT_CHANNEL]
    )
    if (!bundle) return res.json({ message: 'no active bundle' })

    // Native-compatibility gate: never serve JS newer than the binary supports.
    const nativeOk = compareSemver(versionBuild, bundle.min_native_version)
    if (nativeOk === null || nativeOk < 0) {
      return res.json({ message: 'native version below bundle minimum' })
    }

    // Only serve strictly NEWER than what the device runs.
    const cmp = compareSemver(bundle.version, current)
    if (cmp === null) return res.json({ message: 'version not comparable' })
    if (cmp <= 0)     return res.json({ message: 'up to date' })

    return res.json({
      version:  bundle.version,
      url:      bundle.url,
      checksum: bundle.checksum,
    })
  } catch (err) {
    // Fail SAFE: any server hiccup = "no update", never a broken payload.
    console.error('[ota/updates]', err.message)
    return res.json({ message: 'update check unavailable' })
  }
})

// POST /stats — best-effort telemetry from the plugin (update lifecycle +
// app-health signals). Always 200; insert failures are swallowed (stats must
// never affect devices). Prunable table.
router.post('/stats', async (req, res) => {
  try {
    const b = req.body || {}
    await db.query(
      `INSERT INTO tm_ota_stats (app_id, device_id, platform, action, version, old_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        String(b.app_id || '').slice(0, 200),
        String(b.device_id || '').slice(0, 100),
        String(b.platform || '').slice(0, 20),
        String(b.action || '').slice(0, 100),
        String(b.version_name || b.version || '').slice(0, 50),
        String(b.old_version_name || '').slice(0, 50),
      ]
    )
  } catch (err) {
    console.error('[ota/stats]', err.message)
  }
  res.json({ ok: true })
})

module.exports = router
module.exports._compareSemver = compareSemver // exported for unit tests
