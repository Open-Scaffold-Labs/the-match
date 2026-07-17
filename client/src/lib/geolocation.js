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
import { Capacitor } from '@capacitor/core'

const isNative = Capacitor.isNativePlatform()
const DEFAULTS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

let _pluginPromise = null
function loadPlugin() {
  if (!_pluginPromise) _pluginPromise = import('@capacitor/geolocation').then(m => m.Geolocation)
  return _pluginPromise
}

export function geoAvailable() {
  if (isNative) return true
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

export function getCurrentPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }
  if (!isNative) {
    if (!navigator?.geolocation) { onError?.({ code: 2, message: 'unavailable' }); return }
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options)
    return
  }
  loadPlugin()
    .then(g => g.getCurrentPosition(options))
    .then(pos => onSuccess?.(pos))
    .catch(err => onError?.(err))
}

// Returns an opaque handle synchronously (native id is resolved async inside).
// Pass the handle to clearWatch().
export function watchPosition(onSuccess, onError, opts = {}) {
  const options = { ...DEFAULTS, ...opts }
  if (!isNative) {
    if (!navigator?.geolocation) { onError?.({ code: 2, message: 'unavailable' }); return null }
    const id = navigator.geolocation.watchPosition(onSuccess, onError, options)
    return { web: true, id }
  }
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
    .catch(err => onError?.(err))
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
