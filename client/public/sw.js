// Service worker for The Match. Two jobs:
//   1. Keep the cache layer clean — old SWs sometimes pinned stale
//      assets. We delete every cache on activate so users always
//      load the latest deploy.
//   2. Receive web-push events and surface them as native
//      notifications. Tapping a notification focuses an existing tab
//      or opens a new one at the deep link in the payload.
//
// Versioned filename suffix (date) so changes ship cleanly.
// (2026-05-01 — Matt: web push for friend requests + invites.)

// Per-deploy build id. `__SW_BUILD__` is replaced at build time by
// scripts/stamp-sw.js with the commit SHA (or a timestamp locally) so this
// file's BYTES change every deploy. Without it, sw.js is byte-identical
// across deploys → the browser never sees a "new" SW → activate (which
// sweeps caches + broadcasts the reload) never fires → installed PWAs keep
// running a stale cached bundle. (2026-06-23 — Matt's iPhone stuck pre-fix.)
self.SW_BUILD = '__SW_BUILD__'

// ─── Offline tile cache (NAIP satellite imagery) ─────────────────────
// Golf courses are notorious for terrible cell coverage. We cache NAIP map
// tiles as they're viewed so a hole you've already loaded keeps working with
// NO signal mid-round. Tiles are immutable per (z,y,x) → safe to serve
// cache-first. This is scoped ONLY to the NAIP host: every other request
// (app bundle, index.html, /api, sw.js itself) is left completely untouched,
// so the PWA-update mechanism below is unaffected. (2026-06-24)
const TILE_CACHE = 'naip-tiles-v1'
const TILE_HOST = 'gis.apfo.usda.gov'
const TILE_CACHE_MAX = 2000   // FIFO-trim beyond this so it can't grow unbounded

self.addEventListener('install', () => {
  // Activate the new SW immediately rather than waiting for all
  // controlled tabs to close. Push-event-handler updates need to be
  // active right away.
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Sweep stale caches — but PRESERVE the NAIP tile cache. App bundles must
    // refresh each deploy; satellite tiles are version-independent imagery and
    // should survive (that's what makes a previously-loaded course work offline
    // after an update). Vercel handles edge caching of static assets.
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== TILE_CACHE).map(k => caches.delete(k)))
    // Take control of pages that were already open when this SW
    // activated (otherwise they'd keep using the old SW until reload).
    await self.clients.claim()

    // 2026-05-07 PM — broadcast a "new version" message to every
    // foregrounded client so App.jsx can trigger a reload (or show a
    // toast). Without this, a freshly-activated SW would just sit
    // there holding new code while open tabs keep running the old
    // bundle they loaded before the deploy. Real bug Matt hit today:
    // his iPhone PWA was running an index-DOrG4P8T.js bundle from
    // before the SoloScoreboard rewrite while production had moved on
    // through 7+ commits — celebration modal, rarity tiers, even the
    // SoloScoreModal itself were missing client-side. Now: SW update
    // → claim → broadcast → client refreshes within seconds.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clients.forEach(c => {
      try { c.postMessage({ kind: 'sw-activated' }) } catch { /* ignore */ }
    })
  })())
})

// ─── Fetch: cache-first for NAIP tiles ONLY ──────────────────────────
// Everything that isn't a NAIP tile returns early (no respondWith) → the
// browser handles it exactly as before. So app assets / index.html / API /
// sw.js are untouched and the update mechanism above is unaffected.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.hostname !== TILE_HOST) return   // not a satellite tile — leave it alone

  event.respondWith((async () => {
    const cache = await caches.open(TILE_CACHE)
    const cached = await cache.match(req)
    if (cached) return cached                 // already have this tile → instant, works offline
    try {
      const res = await fetch(req)
      if (res && res.ok) {
        cache.put(req, res.clone())
        // FIFO trim so many rounds can't grow the cache without bound. keys()
        // returns in insertion order, so the front entries are the oldest.
        cache.keys().then(keys => {
          const excess = keys.length - TILE_CACHE_MAX
          for (let i = 0; i < excess; i++) cache.delete(keys[i])
        })
      }
      return res
    } catch {
      // Offline and not cached → let MapLibre render the hole without this
      // tile (the vector overlays + already-cached tiles still draw).
      return Response.error()
    }
  })())
})

// ─── Push events ─────────────────────────────────────────────────────
// Server's payload shape (see server/src/lib/push.js):
//   { title, body, url?, tag? }
// `tag` collapses duplicates so a flurry of friend requests shows as
// one notification rather than a stack.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }

  const title = data.title || 'The Match'
  const options = {
    body: data.body || '',
    icon:  '/icon-192.png',   // PWA icon — already in /public for the manifest
    badge: '/icon-192.png',   // small badge shown in status bar on some platforms
    tag:   data.tag || undefined,
    data:  { url: data.url || '/' },
    // Vibration pattern (Android only — iOS ignores).
    vibrate: [80, 40, 80],
  }

  // 2026-05-06 hardening — also broadcast to all foregrounded clients
  // so achievement toasts (and other in-app surfaces) can pop without
  // the user needing to open the system notification. The system
  // banner still shows; this just adds an in-app channel for tabs
  // that are currently focused.
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      clients.forEach(c => {
        try { c.postMessage({ kind: 'push', payload: data }) } catch { /* ignore */ }
      })
    }),
  ]))
})

// ─── Notification click — open or focus the app ──────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer focusing an existing tab to opening a new one.
    for (const client of allClients) {
      if ('focus' in client) {
        // Navigate the existing tab to the deep link if needed, then focus.
        try {
          if (client.url && !client.url.endsWith(targetUrl)) {
            await client.navigate(targetUrl).catch(() => {})
          }
        } catch { /* navigate not supported on all browsers */ }
        return client.focus()
      }
    }
    // No existing tab — open a new one.
    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl)
    }
  })())
})
