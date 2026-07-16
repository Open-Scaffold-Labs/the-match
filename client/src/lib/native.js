// Native shell bootstrap (Capacitor). Everything here is a NO-OP on the web
// build: initNativeShell() bails immediately unless running inside the native
// container, and the native plugins are lazy-imported so the web bundle never
// executes them. See wiki/synthesis/app-store-readiness-gameplan-2026-07-16.md.
import { Capacitor } from '@capacitor/core'

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

  // Dismiss the launch splash once the web app has taken over the screen.
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch (e) {
    console.warn('[native] splash hide skipped:', e?.message)
  }

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
}
