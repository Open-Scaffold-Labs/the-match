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
// ── 2026-08-07: NATIVE PATH IS NOW CONDITIONAL, NOT ASSUMED ─────────────────
// GPS was dead on Matt's on-course round. Root cause: `@capacitor/geolocation`
// is a NATIVE plugin, added 2026-07-16 (9c6fe4b). OTA bundles 1.0.1–1.0.3 were
// all published with `min_native_version = 1.0.0`, so this JS is served to
// binaries compiled BEFORE the plugin existed (docs/OTA-RUNBOOK.md: "What OTA
// can NOT ship: native changes (new plugins…)"). On such a binary every call
// rejects with `"Geolocation" plugin is not implemented on ios`; that rejection
// has no `.code`, so EagleEye's handler fell through to setGpsError('timeout')
// and the fix never arrived — permanent "acquiring", all round.
//
// Two guards, both fail-OPEN to the WebView path that was working on course
// before the native shell existed:
//   1. Gate on Capacitor.isPluginAvailable('Geolocation') — the bridge's own
//      registry of what this BINARY actually has — not isNativePlatform().
//   2. If the plugin path throws/rejects anyway, latch it off for the session
//      and retry through navigator.geolocation instead of surfacing a GPS
//      error. A missing native plugin must never look like "no GPS signal".
// A binary that DOES carry the plugin is unaffected; web/PWA is unaffected.
import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()
const DEFAULTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

// Does THIS binary carry the native plugin? False on web, and false on a native
// binary built before the plugin was added — which is the case this fixes.
function pluginRegistered() {
  if (!isNative) return false
  try { return Capacitor.isPluginAvailable('Geolocation') } catch { return false }
}

// Latched off after a native failure so we don't re-try a broken bridge on
// every tick of the watch.
let nativeDisabled = false
function useNative() { return !nativeDisabled && pluginRegistered() }

function disableNative(err) {
  if (!nativeDisabled) {
    nativeDisabled = true
    // Not console.error — this is a handled degradation, not a crash.
    console.warn('[geo] native Geolocation unavailable, falling back to WebView geolocation:', err?.message || err)
  }
}

function webAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

let _pluginPromise = null
function loadPlugin() {
  if (!_pluginPromise) _pluginPromise = import('@capacitor/geolocation').then(m => m.Geolocation)
  return _pluginPromise
}

export function geoAvailable() {
  return webAvailable() || pluginRegistered()
}

export function getCurrentPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }

  const web = () => {
    if (!webAvailable()) { onError?.({ code: 2, message: 'unavailable' }); return }
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options)
  }

  if (!useNative()) { web(); return }

  loadPlugin()
    .then(g => g.getCurrentPosition(options))
    .then(pos => onSuccess?.(pos))
    .catch(err => {
      // Plugin missing from this binary → fall back rather than report "no GPS".
      disableNative(err)
      web()
    })
}

// Returns an opaque handle synchronously (native id is resolved async inside).
// Pass the handle to clearWatch().
export function watchPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }

  const startWeb = (handle) => {
    if (!webAvailable()) { onError?.({ code: 2, message: 'unavailable' }); return null }
    const id = navigator.geolocation.watchPosition(onSuccess, onError, options)
    if (handle) { handle.web = true; handle.id = id; if (handle.cleared) clearWatch(handle) }
    return handle || { web: true, id }
  }

  if (!useNative()) return startWeb(null)

  const handle = { web: false, id: null, cleared: false }
  loadPlugin()
    .then(g => g.watchPosition(options, (pos, err) => {
      if (err) { onError?.(err); return }
      if (pos) onSuccess?.(pos)
    }))
    .then(id => {
      handle.id = id
      // If clearWatch was called before the id resolved, honor it now.
      if (handle.cleared) loadPlugin().then(g => g.clearWatch({ id }))
    })
    .catch(err => {
      disableNative(err)
      // Re-point the SAME handle at a web watch so the caller's stored
      // reference still clears correctly.
      startWeb(handle)
    })
  return handle
}

export function clearWatch(handle) {
  if (!handle) return
  if (handle.web) {
    try { navigator.geolocation.clearWatch(handle.id) } catch { /* already gone */ }
    return
  }
  handle.cleared = true
  if (handle.id != null) {
    loadPlugin().then(g => g.clearWatch({ id: handle.id })).catch(() => { /* already gone */ })
  }
}
