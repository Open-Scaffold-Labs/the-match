// Native-aware geolocation shim.
//
// WHY: In the Capacitor iOS shell, the browser's `navigator.geolocation` already
// routes to iOS Core Location (with the Info.plist usage strings), so FOREGROUND
// accuracy is already native-grade. This shim exists so the app can additionally
// use the native @capacitor/geolocation plugin on device — an explicit high-
// accuracy request + the native permission flow — while keeping the EXACT web
// behavior on web/PWA.
//
// CONTRACT: mirrors the web Geolocation API 1:1 —
//   getCurrentPosition(onSuccess, onError, opts)
//   const handle = watchPosition(onSuccess, onError, opts)   // returns a handle
//   clearWatch(handle)
// Position objects are the standard shape ({ coords:{ latitude, longitude,
// accuracy, altitude, altitudeAccuracy, heading, speed }, timestamp }) on BOTH
// paths — the Capacitor plugin already returns that shape — so callers are
// unchanged.
//
// IMPORTANT: on WEB this delegates straight to navigator.geolocation with the
// same args, so web/PWA behavior is byte-for-byte what it was before. Only the
// native shell takes the plugin path. (2026-07-16 — native GPS pass.)
//
// ── 2026-08-07: THE NATIVE PATH IS OPT-IN AND CAN NEVER HANG ────────────────
// Matt's on-course round had NO GPS at all, and the green "Enable Location for
// the nearest-course default" button on PlayStart looked dead — tap it, nothing
// happens, no iOS dialog, no error banner. TWO independent native failure modes
// produced that, and this file now defends against both. Both defenses fail OPEN
// to `navigator.geolocation` — the path that actually worked on course before
// the native shell existed.
//
// FAILURE MODE 1 — the plugin isn't in the binary.
//   `@capacitor/geolocation` is a NATIVE plugin, added 2026-07-16 (9c6fe4b).
//   OTA bundles 1.0.1–1.0.3 were all published with `min_native_version=1.0.0`,
//   so this JS was served to binaries compiled before the plugin existed
//   (docs/OTA-RUNBOOK.md: "What OTA can NOT ship: native changes (new
//   plugins…)"). Every call then rejects with `"Geolocation" plugin is not
//   implemented on ios` — a rejection with no `.code`, so EagleEye's
//   code===1/===2/else handler fell through to setGpsError('timeout').
//   → Guard: gate on Capacitor.isPluginAvailable('Geolocation') — what this
//     BINARY actually has — not isNativePlatform().
//
// FAILURE MODE 2 — the plugin IS there and silently hangs (the dead button).
//   GeolocationPlugin.handleLocationRequest does `addLocationCallback` (which
//   calls `bridge.saveCall`, leaving the JS promise pending) and THEN:
//       switch locationService?.authorisationStatus {
//       case .authorisedAlways, .authorisedWhenInUse: onLocationPermissionGranted()
//       case .denied:     sendError(.permissionDenied)
//       case .restricted: sendError(.permissionRestricted)
//       default: break        // ← .notDetermined, and nil
//       }
//   On `.notDetermined` — i.e. permission not yet answered, which is EVERY
//   first run — it takes `default: break`. The call is saved and never
//   resolved, never rejected. No fix, no error, no permission dialog from this
//   path. The promise stays pending forever, so the button appears inert.
//   → Guard A: only take the native path when checkPermissions() already says
//     `granted`. Anything else (prompt / denied / unknown) goes to the WebView
//     API, which does reliably raise the iOS dialog — that is how permission
//     got granted for months before the shim.
//   → Guard B: every native call is raced against a deadline. A native call
//     that doesn't settle is treated exactly like a missing plugin: latch
//     native off for the session and redo the request on the WebView path.
//   Guard B is the backstop for Guard A — it catches any OTHER wedge inside
//   the plugin (a stalled publisher, a dead locationService), not just the
//   `.notDetermined` hole we can point at today.
//
// A binary whose plugin works normally is UNAFFECTED by all of this: permission
// reads `granted`, calls settle well inside the deadline, native is used.
import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()
const DEFAULTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

// A permission/plugin probe should be instant — it's a bridge round-trip, not
// a GPS acquisition. If it isn't back in this long, the bridge is wedged.
const PROBE_DEADLINE_MS = 3000
// Slack added to the caller's own timeout before we give up on a native fix.
// The plugin honours `timeout` for acquisition; this only catches a plugin
// that never settles AT ALL.
const NATIVE_SLACK_MS = 5000

// ── native availability ────────────────────────────────────────────────────
// Does THIS binary carry the plugin? False on web, and false on a native binary
// built before the plugin was added.
function pluginRegistered() {
  if (!isNative) return false
  try { return Capacitor.isPluginAvailable('Geolocation') } catch { return false }
}

// Latched off after any native failure so a wedged bridge isn't re-tried on
// every tick of the watchdog.
let nativeDisabled = false

function disableNative(err) {
  if (nativeDisabled) return
  nativeDisabled = true
  // console.warn, not error — this is a handled degradation, not a crash.
  console.warn('[geo] native Geolocation unusable, using WebView geolocation:', err?.message || err)
}

function webAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

export function geoAvailable() {
  return webAvailable() || pluginRegistered()
}

let _pluginPromise = null
function loadPlugin() {
  if (!_pluginPromise) _pluginPromise = import('@capacitor/geolocation').then(m => m.Geolocation)
  return _pluginPromise
}

// Reject if `p` hasn't settled within `ms`. The marker lets callers tell a
// stall apart from a genuine geolocation error.
function deadline(p, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    const t = setTimeout(() => {
      if (settled) return
      settled = true
      const e = new Error(`native Geolocation.${label} did not settle in ${ms}ms`)
      e.geoNativeStall = true
      reject(e)
    }, ms)
    p.then(
      v => { if (settled) return; settled = true; clearTimeout(t); resolve(v) },
      e => { if (settled) return; settled = true; clearTimeout(t); reject(e) },
    )
  })
}

// Resolves the plugin ONLY if it is present AND permission is already granted.
// Rejects (→ caller falls back to the WebView path) in every other case,
// including `prompt` — see FAILURE MODE 2 above: asking the plugin for a
// position while permission is `.notDetermined` is the hang.
let _nativeReady = null
function nativeGeo() {
  if (nativeDisabled || !pluginRegistered()) return Promise.reject(new Error('native geolocation unavailable'))
  if (!_nativeReady) {
    _nativeReady = loadPlugin()
      .then(g => deadline(g.checkPermissions(), PROBE_DEADLINE_MS, 'checkPermissions').then(status => {
        if (status?.location !== 'granted') {
          const e = new Error(`native location permission is "${status?.location}" — deferring to the WebView prompt`)
          e.geoNeedsPrompt = true
          throw e
        }
        return g
      }))
      .catch(err => { disableNative(err); throw err })
  }
  return _nativeReady
}

// ── public API ─────────────────────────────────────────────────────────────
export function getCurrentPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }

  const web = () => {
    if (!webAvailable()) { onError?.({ code: 2, message: 'unavailable' }); return }
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options)
  }

  if (!isNative || nativeDisabled) { web(); return }

  nativeGeo()
    .then(g => deadline(g.getCurrentPosition(options), options.timeout + NATIVE_SLACK_MS, 'getCurrentPosition'))
    .then(pos => onSuccess?.(pos))
    .catch(err => {
      if (err?.geoNativeStall) disableNative(err)
      web()
    })
}

// Returns an opaque handle synchronously (native id is resolved async inside).
// Pass the handle to clearWatch().
export function watchPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }

  // Point `handle` (if given) at a WebView watch, so a caller that already
  // stored the handle can still clearWatch() it after we fall back.
  const startWeb = (handle) => {
    if (!webAvailable()) { onError?.({ code: 2, message: 'unavailable' }); return handle || null }
    const id = navigator.geolocation.watchPosition(onSuccess, onError, options)
    if (!handle) return { web: true, id }
    handle.web = true
    handle.id = id
    if (handle.cleared) clearWatch(handle)
    return handle
  }

  if (!isNative || nativeDisabled) return startWeb(null)

  const handle = { web: false, id: null, cleared: false }
  let firstFix = false

  nativeGeo()
    .then(g => deadline(
      g.watchPosition(options, (pos, err) => {
        if (err) { onError?.(err); return }
        if (pos) { firstFix = true; onSuccess?.(pos) }
      }),
      PROBE_DEADLINE_MS,
      'watchPosition',
    ).then(id => ({ g, id })))
    .then(({ g, id }) => {
      handle.id = id
      if (handle.cleared) { g.clearWatch({ id }); return }
      // The registration resolved, but a wedged plugin can still never deliver
      // a fix. If nothing has arrived by the caller's timeout, drop to the
      // WebView watch rather than sit dark.
      setTimeout(() => {
        if (firstFix || handle.cleared || handle.web) return
        disableNative(new Error('native watch registered but delivered no fix'))
        try { g.clearWatch({ id }) } catch { /* already gone */ }
        handle.id = null
        startWeb(handle)
      }, options.timeout + NATIVE_SLACK_MS)
    })
    .catch(err => {
      if (err?.geoNativeStall) disableNative(err)
      startWeb(handle)
    })

  return handle
}

export function clearWatch(handle) {
  if (!handle) return
  handle.cleared = true
  if (handle.web) {
    try { navigator.geolocation.clearWatch(handle.id) } catch { /* already gone */ }
    return
  }
  if (handle.id != null) {
    loadPlugin().then(g => g.clearWatch({ id: handle.id })).catch(() => { /* already gone */ })
  }
}
