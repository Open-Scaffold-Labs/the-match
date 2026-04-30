const router = require('express').Router()
const requireAuth = require('../middleware/auth')

const GC_API = 'https://api.golfcourseapi.com/v1'
const GC_KEY = process.env.GOLF_COURSE_API_KEY

function gcHeaders() {
  return { 'Authorization': `Key ${GC_KEY}`, 'Content-Type': 'application/json' }
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
        club_name: c.club_name,
        course_name: c.course_name,
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
    const r = await fetch(`${GC_API}/courses/${req.params.id}`, { headers: gcHeaders() })
    const d = await r.json()
    if (!d.course) return res.status(404).json({ error: 'Course not found' })
    const c = d.course
    // Return course + tee list with per-hole par/yardage/handicap
    res.json({
      id: c.id,
      club_name: c.club_name,
      course_name: c.course_name,
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
