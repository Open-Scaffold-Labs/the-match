const router = require('express').Router()
const requireAuth = require('../middleware/auth')
const db = require('../db')

const GC_API = 'https://api.golfcourseapi.com/v1'
const GC_KEY = process.env.GOLF_COURSE_API_KEY

// Course detail is cached in tm_courses (migration 028) because the vendor
// free tier is only 50 req/day shared across all users. Course data is
// effectively static, so a long TTL is fine — refresh only if the cached
// row is older than this. (2026-06-01 — wiki/POST-LAUNCH-TODO.md #25.)
const COURSE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000 // 180 days

function gcHeaders() {
  return { 'Authorization': `Key ${GC_KEY}`, 'Content-Type': 'application/json' }
}

// The golfcourseapi.com vendor data abbreviates common golf-club suffixes
// ("Pebble Beach Gl" instead of "Pebble Beach Golf Links"). Their data,
// not our truncation. Expand on the way out so display strings read
// naturally everywhere (autocomplete + profile + match cards). Ordered
// longer-first so multi-token suffixes win against single-token ones.
// Found 2026-05-07 during the E2E audit (audit-2026-05-07.md bug #3).
const COURSE_NAME_ABBREVS = [
  [/\bG&Cc\b/g, 'Golf & Country Club'],
  [/\bGn&Cc\b/g, 'Golf & Country Club'],
  [/\bGolf\s+Cl\b/g, 'Golf Club'],
  [/\bCountry\s+Cl\b/g, 'Country Club'],
  [/\bGl\b/g, 'Golf Links'],
  [/\bGc\b/g, 'Golf Club'],
  [/\bCc\b/g, 'Country Club'],
  [/\bRc\b/g, 'Resort Club'],
]
function expandCourseName(name) {
  if (!name || typeof name !== 'string') return name
  let out = name
  for (const [pat, sub] of COURSE_NAME_ABBREVS) out = out.replace(pat, sub)
  return out
}

// Haversine — great-circle distance in km between two lat/lng pairs
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// GET /api/courses/search?q=Pebble+Beach[&lat=Y&lng=Z]
// When lat+lng provided, results are sorted by distance ascending — used by
// the Match-create course picker to surface nearby courses first. (2026-04-30)
router.get('/search', requireAuth, async (req, res) => {
  const q = req.query.q?.trim()
  if (!q) return res.status(400).json({ error: 'q required' })
  const lat = parseFloat(req.query.lat)
  const lng = parseFloat(req.query.lng)
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng)
  try {
    const r = await fetch(`${GC_API}/search?search_query=${encodeURIComponent(q)}`, { headers: gcHeaders() })
    const d = await r.json()
    let courses = (d.courses || []).map(c => {
      const cLat = c.location?.latitude
      const cLng = c.location?.longitude
      const distKm = (hasLoc && Number.isFinite(cLat) && Number.isFinite(cLng))
        ? haversineKm(lat, lng, cLat, cLng)
        : null
      return {
        id: c.id,
        club_name: expandCourseName(c.club_name),
        course_name: expandCourseName(c.course_name),
        city: c.location?.city,
        state: c.location?.state,
        country: c.location?.country,
        latitude: cLat,
        longitude: cLng,
        distance_km: distKm,
      }
    })
    if (hasLoc) {
      // Sort: courses with known distance ascending, unknowns last
      courses.sort((a, b) => {
        if (a.distance_km == null && b.distance_km == null) return 0
        if (a.distance_km == null) return 1
        if (b.distance_km == null) return -1
        return a.distance_km - b.distance_km
      })
    }
    res.json({ courses })
  } catch (err) {
    console.error('[courses/search]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// GET /api/courses/:id — full hole data
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    let c = null
    let cacheHit = false

    // 1️⃣ Read-through cache (tm_courses). Wrapped in try/catch so a missing
    // table (migration not yet applied) or a DB hiccup degrades gracefully
    // to a live vendor fetch rather than 500ing.
    if (Number.isFinite(id)) {
      try {
        const row = await db.one('SELECT raw, fetched_at FROM tm_courses WHERE id = $1', [id])
        if (row && (Date.now() - new Date(row.fetched_at).getTime()) < COURSE_CACHE_TTL_MS) {
          c = row.raw
          cacheHit = true
        }
      } catch { /* table missing / db unavailable → fall through to vendor */ }
    }

    // 2️⃣ Vendor fetch on miss, then best-effort cache write.
    if (!c) {
      const r = await fetch(`${GC_API}/courses/${req.params.id}`, { headers: gcHeaders() })
      const d = await r.json()
      if (!d.course) return res.status(404).json({ error: 'Course not found' })
      c = d.course
      if (Number.isFinite(id)) {
        try {
          await db.query(
            `INSERT INTO tm_courses (id, raw, fetched_at) VALUES ($1, $2::jsonb, now())
             ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw, fetched_at = now()`,
            [id, JSON.stringify(c)]
          )
        } catch { /* cache write is best-effort — never block the response */ }
      }
    }

    res.set('X-Course-Cache', cacheHit ? 'hit' : 'miss')
    // Return course + tee list with per-hole par/yardage/handicap
    res.json({
      id: c.id,
      club_name: expandCourseName(c.club_name),
      course_name: expandCourseName(c.course_name),
      latitude: c.location?.latitude,
      longitude: c.location?.longitude,
      tees: {
        male: (c.tees?.male || []).map(t => ({
          tee_name: t.tee_name,
          course_rating: t.course_rating,
          slope_rating: t.slope_rating,
          total_yards: t.total_yards,
          par_total: t.par_total,
          holes: (t.holes || []).map((h, i) => ({
            hole: i + 1,
            par: h.par,
            yardage: h.yardage,
            handicap: h.handicap,  // stroke index
          })),
        })),
        female: (c.tees?.female || []).map(t => ({
          tee_name: t.tee_name,
          course_rating: t.course_rating,
          slope_rating: t.slope_rating,
          total_yards: t.total_yards,
          par_total: t.par_total,
          holes: (t.holes || []).map((h, i) => ({
            hole: i + 1,
            par: h.par,
            yardage: h.yardage,
            handicap: h.handicap,
          })),
        })),
      },
    })
  } catch (err) {
    console.error('[courses/get]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
