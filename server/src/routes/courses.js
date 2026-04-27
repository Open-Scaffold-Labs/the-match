const router = require('express').Router()
const requireAuth = require('../middleware/auth')

const GC_API = 'https://api.golfcourseapi.com/v1'
const GC_KEY = process.env.GOLF_COURSE_API_KEY

function gcHeaders() {
  return { 'Authorization': `Key ${GC_KEY}`, 'Content-Type': 'application/json' }
}

// GET /api/courses/search?q=Pebble+Beach
router.get('/search', requireAuth, async (req, res) => {
  const q = req.query.q?.trim()
  if (!q) return res.status(400).json({ error: 'q required' })
  try {
    const r = await fetch(`${GC_API}/search?search_query=${encodeURIComponent(q)}`, { headers: gcHeaders() })
    const d = await r.json()
    // Return just what the client needs: id, club_name, course_name, city, state
    const courses = (d.courses || []).map(c => ({
      id: c.id,
      club_name: c.club_name,
      course_name: c.course_name,
      city: c.location?.city,
      state: c.location?.state,
      country: c.location?.country,
      latitude: c.location?.latitude,
      longitude: c.location?.longitude,
    }))
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
