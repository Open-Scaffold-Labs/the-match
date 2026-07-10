// course-recents.js — recently played/picked courses (Phase 1 / S3a of the
// Play-funnel plan, 2026-07-10).
//
// The Play tab's start funnel needs a "GPS-detected nearest course" default,
// but there is NO nearby API: /api/courses/search requires a text query
// (GolfCourseAPI is proxied by name only). This capped localStorage list is
// the beta-grade source — golfers overwhelmingly replay the same handful of
// courses, so "nearest recent within 5 miles" IS the right default for every
// round after the first at a course. A true server-side /nearby endpoint is
// a logged fast-follow, not silently skipped.
//
// Written on every course+tee pick (both CoursePicker variants) and by
// LiveOuting's course seed. Entries keep the last-used tee name so the
// funnel can pre-fill the tee (per-course tee memory — none of the market
// leaders do this well).

const KEY = 'tm-recent-courses'
const CAP = 10

export function readRecents() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter(r => r && r.id != null) : []
  } catch {
    return []
  }
}

// Upsert by course id, newest first, capped. lat/lon/lastTee fall back to
// the existing entry's values so a source that lacks them (e.g. LiveOuting's
// course detail has no lat/lon) never erases better data.
export function addRecent({ id, club_name, lat = null, lon = null, lastTee = null }) {
  if (id == null) return
  try {
    const all = readRecents()
    const prev = all.find(r => String(r.id) === String(id))
    const rest = all.filter(r => String(r.id) !== String(id))
    const entry = {
      id,
      club_name: club_name || prev?.club_name || 'Course',
      lat: lat ?? prev?.lat ?? null,
      lon: lon ?? prev?.lon ?? null,
      lastTee: lastTee ?? prev?.lastTee ?? null,
      ts: Date.now(),
    }
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, CAP)))
  } catch { /* quota / disabled — best-effort */ }
}

// Haversine, miles. gps = { lat, lon }.
export function recentDistMiles(r, gps) {
  if (!gps || r?.lat == null || r?.lon == null) return Infinity
  const R = 3958.8
  const dLat = (r.lat - gps.lat) * Math.PI / 180
  const dLon = (r.lon - gps.lon) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(gps.lat * Math.PI / 180) * Math.cos(r.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// The recent course closest to the fix, if within maxMiles. Null otherwise.
export function nearestRecent(gps, maxMiles = 5) {
  if (!gps) return null
  let best = null, bestD = Infinity
  for (const r of readRecents()) {
    const d = recentDistMiles(r, gps)
    if (d < bestD) { best = r; bestD = d }
  }
  return bestD <= maxMiles ? best : null
}

// Most recently used course (any distance) — the at-home default.
export function lastUsed() {
  return readRecents()[0] || null
}
