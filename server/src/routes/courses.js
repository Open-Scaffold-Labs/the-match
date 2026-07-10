const router = require('express').Router()
const requireAuth = require('../middleware/auth')
const db = require('../db')

const GC_API = 'https://api.golfcourseapi.com/v1'
const GC_KEY = process.env.GOLF_COURSE_API_KEY

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

// ── Vendor cache (migration 045, 2026-07-10) ────────────────────────────────
// The GolfCourseAPI free tier rate-limits; when it 429'd, /search silently
// returned 200 {courses:[]} (`d.courses || []`) and course selection looked
// dead app-wide — Matt's report, with GPS off so no OSM nearby list masked
// it. Cache-through + STALE-IF-ERROR, same doctrine as tm_osm_cache: hit the
// vendor at most once per query/course per TTL, serve stale rows through
// vendor outages/rate limits, and be HONEST (502 + client-visible message)
// only when there's truly nothing. Cache ops are best-effort — a cache
// failure must never break the request.
const SEARCH_TTL_MS = 7 * 24 * 3600 * 1000   // vendor catalog changes rarely
const DETAIL_TTL_MS = 30 * 24 * 3600 * 1000  // tees/pars are near-static

const cacheFresh = (row, ttl) => !!row && (Date.now() - new Date(row.fetched_at).getTime() < ttl)

// GET /api/courses/search?q=Pebble+Beach[&lat=Y&lng=Z]
// When lat+lng provided, results are sorted by distance ascending — used by
// the Match-create course picker to surface nearby courses first. (2026-04-30)
// Distance is computed per request AFTER the cache — cached payloads are
// location-independent so every user shares one row per query.
router.get('/search', requireAuth, async (req, res) => {
  const q = req.query.q?.trim()
  if (!q) return res.status(400).json({ error: 'q required' })
  const lat = parseFloat(req.query.lat)
  const lng = parseFloat(req.query.lng)
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng)
  const qKey = q.toLowerCase().replace(/\s+/g, ' ')

  let cached = null
  try { cached = await db.one('SELECT payload, fetched_at FROM tm_course_search_cache WHERE q = $1', [qKey]) } catch { /* cache is best-effort */ }

  let base = null // mapped courses WITHOUT distance
  if (cacheFresh(cached, SEARCH_TTL_MS)) {
    base = cached.payload
  } else {
    try {
      const r = await fetch(`${GC_API}/search?search_query=${encodeURIComponent(q)}`, { headers: gcHeaders() })
      const d = await r.json().catch(() => null)
      // A vendor error (429 rate limit, 5xx, shape change) must NOT read as
      // "no results" — that silent-empty is the bug this rework fixes.
      if (!r.ok || !d || !Array.isArray(d.courses)) throw new Error(`vendor ${r.status}`)
      base = d.courses.map(c => ({
        id: c.id,
        club_name: expandCourseName(c.club_name),
        course_name: expandCourseName(c.course_name),
        city: c.location?.city,
        state: c.location?.state,
        country: c.location?.country,
        latitude: c.location?.latitude,
        longitude: c.location?.longitude,
      }))
      try {
        await db.query(
          `INSERT INTO tm_course_search_cache (q, payload, fetched_at) VALUES ($1, $2, now())
           ON CONFLICT (q) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
          [qKey, JSON.stringify(base)]
        )
      } catch { /* cache write is best-effort */ }
    } catch (err) {
      if (cached) {
        base = cached.payload // stale-if-error — old results beat no results
      } else {
        console.error('[courses/search] vendor unavailable, no cache:', err.message)
        // 502, not 503 — the client fetch helper auto-retries 503s, which
        // would hammer an already rate-limited vendor.
        return res.status(502).json({ error: 'Course search is briefly unavailable — try again in a minute.' })
      }
    }
  }

  const courses = base.map(c => ({
    ...c,
    distance_km: (hasLoc && Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
      ? haversineKm(lat, lng, c.latitude, c.longitude)
      : null,
  }))
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
})

// GET /api/courses/:id — full hole data. Cache-through (045): course detail
// is near-static and fetched constantly (course loads, Play funnel resolve,
// shot editor) — each course hits the vendor at most once per 30 days, and
// stale rows serve through vendor outages/rate limits.
router.get('/:id', requireAuth, async (req, res) => {
  const cid = Number(req.params.id)
  let cached = null
  if (Number.isFinite(cid)) {
    try { cached = await db.one('SELECT payload, fetched_at FROM tm_course_cache WHERE course_id = $1', [cid]) } catch { /* best-effort */ }
  }
  if (cacheFresh(cached, DETAIL_TTL_MS)) return res.json(cached.payload)
  try {
    const r = await fetch(`${GC_API}/courses/${req.params.id}`, { headers: gcHeaders() })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d) throw new Error(`vendor ${r?.status}`)
    if (!d.course) return res.status(404).json({ error: 'Course not found' })
    const c = d.course
    // Return course + tee list with per-hole par/yardage/handicap
    const body = {
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
    }
    if (Number.isFinite(cid)) {
      try {
        await db.query(
          `INSERT INTO tm_course_cache (course_id, payload, fetched_at) VALUES ($1, $2, now())
           ON CONFLICT (course_id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
          [cid, JSON.stringify(body)]
        )
      } catch { /* cache write is best-effort */ }
    }
    res.json(body)
  } catch (err) {
    if (cached) return res.json(cached.payload) // stale-if-error
    console.error('[courses/get] vendor unavailable, no cache:', err.message)
    res.status(502).json({ error: 'Course data briefly unavailable — try again in a minute.' })
  }
})

// ── Curated per-course hole overrides (tm_course_holes, migration 043) ──
// The AUTHORITATIVE layout Eagle Eye uses before any OSM reconstruction — the
// fix for courses OSM maps without golf=hole routing (e.g. Beacon Hill). Mapped
// once via the in-app editor, then exact forever. (2026-07-09)

// GET /api/courses/:id/holes — mapped holes for a course (client prefers these).
router.get('/:id/holes', requireAuth, async (req, res) => {
  const courseId = parseInt(req.params.id, 10)
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'bad course id' })
  try {
    const { rows } = await db.query(
      `SELECT hole, tee_lat, tee_lon, green_lat, green_lon, aim_lat, aim_lon
         FROM tm_course_holes WHERE course_id = $1 ORDER BY hole`,
      [courseId]
    )
    const pt = (a, b) => (a != null && b != null ? { lat: a, lon: b } : null)
    res.json({
      course_id: courseId,
      holes: rows.map(r => ({
        hole: r.hole,
        tee:   pt(r.tee_lat, r.tee_lon),
        green: pt(r.green_lat, r.green_lon),
        aim:   pt(r.aim_lat, r.aim_lon),
      })),
    })
  } catch (err) {
    console.error('[courses/holes GET]', err.message)
    res.status(500).json({ error: 'Failed to load hole overrides' })
  }
})

// PUT /api/courses/:id/holes — upsert the sent holes. Body:
// { holes: [{ hole, tee:{lat,lon}|null, green:{lat,lon}|null, aim:{lat,lon}|null }] }
router.put('/:id/holes', requireAuth, async (req, res) => {
  const courseId = parseInt(req.params.id, 10)
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'bad course id' })
  const holes = Array.isArray(req.body?.holes) ? req.body.holes : null
  if (!holes) return res.status(400).json({ error: 'holes array required' })
  const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null
  try {
    let saved = 0
    for (const h of holes) {
      const hole = parseInt(h.hole, 10)
      if (!(hole >= 1 && hole <= 18)) continue
      await db.query(
        `INSERT INTO tm_course_holes
           (course_id, hole, tee_lat, tee_lon, green_lat, green_lon, aim_lat, aim_lon, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (course_id, hole) DO UPDATE SET
           tee_lat=EXCLUDED.tee_lat, tee_lon=EXCLUDED.tee_lon,
           green_lat=EXCLUDED.green_lat, green_lon=EXCLUDED.green_lon,
           aim_lat=EXCLUDED.aim_lat, aim_lon=EXCLUDED.aim_lon,
           updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [courseId, hole,
         num(h.tee?.lat), num(h.tee?.lon),
         num(h.green?.lat), num(h.green?.lon),
         num(h.aim?.lat), num(h.aim?.lon),
         req.user?.id ?? null]
      )
      saved++
    }
    res.json({ ok: true, saved })
  } catch (err) {
    console.error('[courses/holes PUT]', err.message)
    res.status(500).json({ error: 'Failed to save hole overrides' })
  }
})

module.exports = router
