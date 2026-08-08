// Native-aware geolocation shim.
//
// CONTRACT: mirrors the web Geolocation API 1:1 —
//   getCurrentPosition(onSuccess, onError, opts)
//   const handle = watchPosition(onSuccess, onError, opts)   // returns a handle
//   clearWatch(handle)
// Position objects are the standard shape ({ coords:{ latitude, longitude,
// accuracy, altitude, altitudeAccuracy, heading, speed }, timestamp }) on BOTH
// paths — the Capacitor plugin already returns that shape — so callers are
// unchanged. On WEB this delegates straight to navigator.geolocation, so
// web/PWA behavior is byte-for-byte what it always was.
//
// ── 2026-08-08: THE PERMISSION FLOW, WRITTEN DOWN PROPERLY ──────────────────
// History, because two wrong fixes shipped before this one and the reasoning
// matters more than the diff:
//
//   1.0.4 — assumed the native plugin was missing from Matt's binary and gated
//           on `isPluginAvailable`. Probably wrong: the same stale synced
//           capacitor.config.json that "proved" Geolocation was absent ALSO
//           lacks CapacitorUpdater — yet OTA demonstrably works on that device.
//           So that file is not what shipped, and the gate fixed nothing. It is
//           kept only as a cheap correctness guard.
//   1.0.5 — found a real hang (below) and then fixed it BACKWARDS: it routed
//           the `prompt` case to navigator.geolocation, which removed the only
//           call that can raise the iOS permission dialog. The button stayed
//           dead.
//
// THE ACTUAL RULE, from the plugin's own Swift:
//
//   • `getCurrentPosition` / `watchPosition` → handleLocationRequest, which does
//     addLocationCallback (→ bridge.saveCall, parking the JS promise) and THEN:
//         switch locationService?.authorisationStatus {
//         case .authorisedAlways, .authorisedWhenInUse: onLocationPermissionGranted()
//         case .denied:     sendError(.permissionDenied)
//         case .restricted: sendError(.permissionRestricted)
//         default: break        // ← .notDetermined, and nil
//         }
//     `.notDetermined` — every first run — takes the empty branch. The call is
//     parked and never settled. No fix, no error, no dialog. A dead button.
//
//   • `requestPermissions` → the ONLY path that reaches
//     `requestLocationAuthorisation(type: .whenInUse)`, i.e. the ONLY thing in
//     this plugin that makes iOS show the dialog:
//         if authorisationStatus == .notDetermined {
//             shouldSetupBindings()
//             callbackManager?.addRequestPermissionsCallback(capacitorCall: call)
//         } else { checkPermissions(call) }
//
// So the correct native order is ALWAYS: checkPermissions → (if prompt)
// requestPermissions → only then ask for a position. Asking for a position
// first is the hang.
//
// Everything below is additionally deadlined. A native call that never settles
// is treated as a broken bridge: latch native off for the session and redo the
// request through navigator.geolocation. The WebView path is deadlined too —
// the one assumption nobody has ever verified on device is whether
// navigator.geolocation even fires inside a `capacitor://localhost` origin, and
// if it doesn't, this must surface as an ERROR rather than as silence.
//
// INVARIANT WORTH KEEPING: every public function here settles exactly once,
// with a success or an error, on every platform and every permission state.
// Silence is the bug we keep re-shipping; it is now structurally impossible.
// ── 2026-08-08, THE ACTUAL CAUSE: a dynamic import that never settles ───────
// The live trail on Matt's device stopped at `loading plugin` and never reached
// `checkPermissions…`. That is `import('@capacitor/geolocation')` HANGING — not
// rejecting. Every other step here was deadlined; the module load was the one
// thing that wasn't, so the whole promise chain never started. All three prior
// theories (plugin missing from the binary, `.notDetermined` hang, permission
// state) were downstream of a call that was never reached.
//
// Why a dynamic import hangs rather than 404s: assets are served through
// Capacitor's WKURLSchemeHandler at `capacitor://localhost`. A request the
// handler can't satisfy is not guaranteed to be failed — it can simply never
// call back, leaving the fetch pending forever. `import()` then never settles,
// in either direction. A missing/oddly-cached chunk is therefore SILENT.
//
// Fix: import the plugin STATICALLY. No lazy chunk, no second network fetch, no
// scheme-handler round trip — the plugin object exists the moment this module
// does. `@capacitor/geolocation`'s own entry is just a registerPlugin call whose
// web implementation stays lazy, so this costs a few hundred bytes on web and
// changes nothing there. The deadline below stays as a backstop.
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

const isNative = Capacitor.isNativePlatform()
const DEFAULTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

// A bridge round-trip (permission read) should be instant.
const PROBE_DEADLINE_MS = 3000
// Deliberately SHORT, and here is why it isn't "time for the user to tap Allow":
// requestPermissions resolves when iOS *presents and answers* the dialog. If the
// dialog appears, the plugin's publisher fires on the user's answer whenever that
// happens — this deadline only bounds the case where NOTHING is presented, which
// is the `.notDetermined` publisher hole. 1.0.6 set it to 60s and turned a fast
// failure into a minute of dead button with no visible progress. Fail fast, show
// the trail, fall through to the WebView path.
const PERMISSION_DEADLINE_MS = 8000
// Slack on top of the caller's own timeout before we call a fix-request stalled.
const NATIVE_SLACK_MS = 5000

// ── diagnostics ────────────────────────────────────────────────────────────
// Matt taps a button and "nothing happens" — with no way to see which of five
// paths ran. This records the last attempt so the UI can show it. Bounded.
const DIAG_MAX = 12
let diag = []
function note(msg) {
  diag.push(msg)
  if (diag.length > DIAG_MAX) diag = diag.slice(-DIAG_MAX)
}
function beginAttempt(what) { diag = [`${what}`] }
export function geoDiag() { return diag.join(' → ') }

// ── native availability ────────────────────────────────────────────────────
function pluginRegistered() {
  if (!isNative) return false
  try { return Capacitor.isPluginAvailable('Geolocation') } catch { return false }
}

let nativeDisabled = false
function disableNative(err) {
  if (nativeDisabled) return
  nativeDisabled = true
  console.warn('[geo] native Geolocation unusable, using WebView geolocation:', err?.message || err)
}

function webAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

export function geoAvailable() {
  return webAvailable() || pluginRegistered()
}

// Statically imported (see the header) — resolved, never a network fetch.
function loadPlugin() { return Promise.resolve(Geolocation) }

// Reject if `p` hasn't settled within `ms`. `geoNativeStall` marks a broken
// bridge (fall back) as opposed to a real geolocation error (report it).
function deadline(p, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    const t = setTimeout(() => {
      if (settled) return
      settled = true
      const e = new Error(`${label} did not settle in ${ms}ms`)
      e.geoNativeStall = true
      reject(e)
    }, ms)
    p.then(
      v => { if (settled) return; settled = true; clearTimeout(t); resolve(v) },
      e => { if (settled) return; settled = true; clearTimeout(t); reject(e) },
    )
  })
}

// Resolve the plugin with permission ALREADY settled to `granted`.
// Rejects with { code: 1 } when the user has denied — that's a real answer the
// UI must show (Settings instructions), not a reason to fall back.
function nativeGranted() {
  if (!isNative) return Promise.reject(new Error('not native'))
  if (nativeDisabled) return Promise.reject(new Error('native latched off'))
  if (!pluginRegistered()) {
    note('plugin not registered in binary')
    return Promise.reject(new Error('Geolocation plugin not in this binary'))
  }
  note('loading plugin')
  // Deadlined even though it is now a resolved promise — a hang here is exactly
  // what cost us four bundles, and the cost of the guard is zero.
  return deadline(loadPlugin(), PROBE_DEADLINE_MS, 'loadPlugin').then(g => {
    note('checkPermissions…')
    return deadline(g.checkPermissions(), PROBE_DEADLINE_MS, 'checkPermissions').then(status => {
      const state = status?.location
      note(`checkPermissions=${state}`)
      if (state === 'granted') return g
      if (state === 'denied') {
        const e = new Error('Location permission denied')
        e.code = 1
        throw e
      }
      // prompt / prompt-with-rationale / anything unknown → ASK. This is the
      // only call that raises the iOS dialog. 1.0.5's bug was skipping it.
      note('requestPermissions (iOS dialog)')
      return deadline(g.requestPermissions(), PERMISSION_DEADLINE_MS, 'requestPermissions').then(res => {
        note(`requestPermissions=${res?.location}`)
        if (res?.location === 'granted') return g
        const e = new Error(`Location permission ${res?.location || 'not granted'}`)
        e.code = 1
        throw e
      })
    })
  })
}

// navigator.geolocation, but it can never sit silent either.
function webGetCurrentPosition(onSuccess, onError, options) {
  if (!webAvailable()) { note('no navigator.geolocation'); onError?.({ code: 2, message: 'unavailable' }); return }
  note('navigator.geolocation.getCurrentPosition')
  let settled = false
  const t = setTimeout(() => {
    if (settled) return
    settled = true
    note('WebView geolocation never called back')
    onError?.({ code: 3, message: 'WebView geolocation never called back' })
  }, options.timeout + NATIVE_SLACK_MS)
  navigator.geolocation.getCurrentPosition(
    pos => { if (settled) return; settled = true; clearTimeout(t); note('fix via WebView'); onSuccess?.(pos) },
    err => { if (settled) return; settled = true; clearTimeout(t); note(`WebView error code=${err?.code}`); onError?.(err) },
    options,
  )
}

// ── public API ─────────────────────────────────────────────────────────────
export function getCurrentPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }
  beginAttempt(isNative ? 'native getCurrentPosition' : 'web getCurrentPosition')

  if (!isNative || nativeDisabled) { webGetCurrentPosition(onSuccess, onError, options); return }

  nativeGranted()
    .then(g => deadline(g.getCurrentPosition(options), options.timeout + NATIVE_SLACK_MS, 'getCurrentPosition'))
    .then(pos => { note('fix via native plugin'); onSuccess?.(pos) })
    .catch(err => {
      // A denied permission is an ANSWER — report it so the UI can tell the
      // user to open Settings. Anything else is a broken path → fall back.
      if (err?.code === 1) { note('denied — reporting'); onError?.(err); return }
      if (err?.geoNativeStall) disableNative(err)
      note(`native failed (${err?.message || err}) — falling back`)
      webGetCurrentPosition(onSuccess, onError, options)
    })
}

// Returns an opaque handle synchronously (native id resolves async inside).
export function watchPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }
  beginAttempt(isNative ? 'native watchPosition' : 'web watchPosition')

  // Point `handle` (if given) at a WebView watch, so a caller that already
  // stored the handle can still clearWatch() it after we fall back.
  const startWeb = (handle) => {
    if (!webAvailable()) { onError?.({ code: 2, message: 'unavailable' }); return handle || null }
    note('navigator.geolocation.watchPosition')
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

  nativeGranted()
    .then(g => deadline(
      g.watchPosition(options, (pos, err) => {
        if (err) { note(`native watch error ${err?.message || err}`); onError?.(err); return }
        if (pos) { firstFix = true; onSuccess?.(pos) }
      }),
      PROBE_DEADLINE_MS,
      'watchPosition',
    ).then(id => ({ g, id })))
    .then(({ g, id }) => {
      handle.id = id
      if (handle.cleared) { g.clearWatch({ id }); return }
      // Registered is not the same as delivering. If no fix arrives inside the
      // caller's timeout, drop to the WebView watch rather than sit dark.
      setTimeout(() => {
        if (firstFix || handle.cleared || handle.web) return
        disableNative(new Error('native watch registered but delivered no fix'))
        note('native watch silent — falling back')
        try { g.clearWatch({ id }) } catch { /* already gone */ }
        handle.id = null
        startWeb(handle)
      }, options.timeout + NATIVE_SLACK_MS)
    })
    .catch(err => {
      if (err?.code === 1) { note('denied — reporting'); onError?.(err); return }
      if (err?.geoNativeStall) disableNative(err)
      note(`native watch failed (${err?.message || err}) — falling back`)
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
