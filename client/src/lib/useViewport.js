import { useState, useEffect } from 'react'

// Shared desktop-viewport detection for the leagues/commissioner breakout.
//
// The Match ships to the App Store as a phone-only WKWebView, which is always
// well under 1024px — so on the actual iOS app `useIsDesktop()` is always false
// and the 430px phone frame is never touched. Desktop only ever applies on the
// Vercel/beta surface, where a league commissioner runs their league from a
// laptop on the course. (2026-06-26 — Matt: leagues have commissioners who use
// desktops.) Every non-leagues surface stays mobile-only; this is purely
// additive for the one place a wide layout is wanted.
//
// One source of truth so App.jsx (frame width) and Leagues.jsx (inner layout)
// can never disagree about what "desktop" means.
export const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    try { return window.matchMedia(DESKTOP_QUERY).matches } catch { return false }
  })
  useEffect(() => {
    let mq
    try { mq = window.matchMedia(DESKTOP_QUERY) } catch { return undefined }
    const handler = e => setIsDesktop(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else if (mq.addListener) mq.addListener(handler) // Safari < 14 fallback
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else if (mq.removeListener) mq.removeListener(handler)
    }
  }, [])
  return isDesktop
}
