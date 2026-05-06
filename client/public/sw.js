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

self.addEventListener('install', () => {
  // Activate the new SW immediately rather than waiting for all
  // controlled tabs to close. Push-event-handler updates need to be
  // active right away.
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Sweep stale caches. We don't pre-cache anything ourselves;
    // Vercel handles edge caching of static assets.
    const keys = await caches.keys()
    await Promise.all(keys.map(k => caches.delete(k)))
    // Take control of pages that were already open when this SW
    // activated (otherwise they'd keep using the old SW until reload).
    await self.clients.claim()
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
