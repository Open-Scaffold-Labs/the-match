// Native shell bootstrap (Capacitor). Everything here is a NO-OP on the web
// build: initNativeShell() bails immediately unless running inside the native
// container, and the native plugins are lazy-imported so the web bundle never
// executes them. See wiki/synthesis/app-store-readiness-gameplan-2026-07-16.md.
import { Capacitor } from '@capacitor/core'

// Dismiss the native launch splash. Called from React once the first screen has
// painted (App.jsx mount effect), so the splash covers the entire cold-load
// instead of vanishing after a fixed timer. No-op on web.
export async function hideSplash() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch (e) {
    console.warn('[native] splash hide skipped:', e?.message)
  }
}

let started = false

export async function initNativeShell() {
  if (started || !Capacitor.isNativePlatform()) return
  started = true

  const platform = Capacitor.getPlatform() // 'ios' | 'android'

  // Status bar: the app UI is Augusta-at-night dark, so we want light content
  // (Style.Dark = light text/icons, meant for dark backgrounds).
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    if (platform === 'android') {
      // Android tints the bar itself; iOS ignores this (webview draws under it).
      await StatusBar.setBackgroundColor({ color: '#070C09' })
      await StatusBar.setOverlaysWebView({ overlay: true })
    }
  } catch (e) {
    // Non-fatal: a status-bar hiccup must never block app start.
    console.warn('[native] status bar init skipped:', e?.message)
  }

  // NOTE: the splash is configured launchAutoHide:false, so it stays up until
  // hideSplash() is called from React's first paint (see App.jsx). This avoids
  // the ~10s blank-dark-screen gap where the splash used to auto-hide at 600ms
  // long before the heavy web bundle finished loading.

  // Hardware back button (Android has one; iOS does not). Without this, back at
  // the root can leave a blank webview instead of backgrounding the app.
  try {
    const { App } = await import('@capacitor/app')
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back()
      else App.exitApp()
    })
  } catch (e) {
    console.warn('[native] back-button listener skipped:', e?.message)
  }

  // OTA (Capgo): mark the shipped bundle as good so the updater never
  // false-rolls-back to a previous bundle. Required by the plugin contract;
  // harmless while autoUpdate is off (no pending bundle to confirm).
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
    await applyPendingBundleIfSafe(CapacitorUpdater)
  } catch (e) {
    console.warn('[native] updater notifyAppReady skipped:', e?.message)
  }
}

// ── Apply a downloaded update NOW, not on the next launch (2026-08-08) ──────
//
// WHY THIS EXISTS — it is the bug that actually cost a round of golf.
//
// Capgo downloads a bundle on one launch and swaps to it on the NEXT one. So
// every fix is invisible for one full app start. On 2026-08-08:
//     05:14:59  1.0.10 published
//     05:15-16  device downloads 1.0.10
//     05:31:10  1.0.11 published — the fix — AFTER the device's last check-in
//     11:14     device downloads 1.0.11 ... and keeps running 1.0.10
// Matt then played 18 holes on 1.0.10 with a broken map, while the fix sat on
// the phone, downloaded and inert. No individual bundle was at fault; the
// DELIVERY MODEL was. Telling a user to "force-quit and reopen twice" on the
// first tee is not a fix, it is a wish.
//
// The plugin's own API solves this: getNextBundle() reports a bundle queued for
// next launch, and reload() applies a queued bundle immediately. The clean
// alternative — the `directUpdate` config flag — lives in the NATIVE
// capacitor.config.json, so it cannot ship over the air and would need a new
// TestFlight build. This can, which is the whole point.
//
// SAFETY. A self-reloading app can bootloop, which would be far worse than a
// stale bundle, so every one of these must hold:
//   1. a bundle is actually queued AND its version differs from the running one
//   2. no round is in progress — never yank the webview out from under scoring
//   3. we have not already tried this exact version recently (the real
//      bootloop guard: if a bundle fails to boot, Capgo rolls back and would
//      re-queue it forever)
// If any check fails we simply do nothing and the old behaviour applies on the
// next launch — i.e. the worst case here is exactly today's behaviour.
const APPLY_MARK_KEY = 'tm-ota-apply-attempt'
const APPLY_RETRY_COOLDOWN_MS = 30 * 60 * 1000

function roundInProgress() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      // Active match/solo session (active-round-session.js) or a saved solo round.
      if (k.startsWith('tm-active-session-v1-') || k.startsWith('tm-active-round-v1-')) {
        const v = localStorage.getItem(k)
        if (v && v !== 'null' && v !== '{}') return true
      }
    }
  } catch { /* private mode — assume a round could be running, stay safe */ return true }
  return false
}

async function applyPendingBundleIfSafe(CapacitorUpdater) {
  try {
    const next = await CapacitorUpdater.getNextBundle().catch(() => null)
    if (!next || !next.version) return                      // nothing queued

    const cur = await CapacitorUpdater.current().catch(() => null)
    const curVersion = cur?.bundle?.version
    if (curVersion && curVersion === next.version) return   // already running it

    if (roundInProgress()) {
      console.warn('[native] update', next.version, 'held — round in progress')
      return
    }

    // Bootloop guard: never attempt the same version twice inside the cooldown.
    let mark = null
    try { mark = JSON.parse(localStorage.getItem(APPLY_MARK_KEY) || 'null') } catch { /* ignore */ }
    if (mark && mark.version === next.version && Date.now() - mark.at < APPLY_RETRY_COOLDOWN_MS) {
      console.warn('[native] update', next.version, 'already attempted recently — not retrying')
      return
    }
    try { localStorage.setItem(APPLY_MARK_KEY, JSON.stringify({ version: next.version, at: Date.now() })) } catch { /* ignore */ }

    console.warn('[native] applying pending bundle', next.version, 'now (was', curVersion, ')')
    await CapacitorUpdater.reload()
  } catch (e) {
    // Never let this path break app start — a stale bundle beats no app.
    console.warn('[native] immediate update apply skipped:', e?.message)
  }
}

// The running JS bundle version, for display. Null on web.
export async function currentBundleVersion() {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    const cur = await CapacitorUpdater.current()
    return cur?.bundle?.version || null
  } catch { return null }
}
