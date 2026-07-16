// Community courses (migration 047) — pure helpers, unit-tested.
//
// A community course id is the string 'u<row id>' everywhere outside the DB —
// string-prefixed so it can NEVER collide with vendor integer ids. Downstream
// (tm_rounds.course_id etc.) stays vendor-only; community picks flow through
// the same courseName/hole_pars path typed-own courses use.

const isUserCourseId = (id) => typeof id === 'string' && /^u\d+$/.test(id)
const userCourseRowId = (id) => (isUserCourseId(id) ? Number(id.slice(1)) : null)

// POST body → clean row values, or a client-worthy error. Never trusts input.
function sanitizeCustomCourse(body = {}) {
  const str = (v, n) => (typeof v === 'string' && v.trim())
    ? v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n)
    : null
  const club_name = str(body.clubName ?? body.club_name, 80)
  if (!club_name) return { ok: false, error: 'Course name required' }

  const intArr = (v, min, max) => {
    if (!Array.isArray(v)) return null
    const out = v.map(x => {
      const n = Number(x)
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
    })
    return out.every(x => x != null) ? out : null
  }
  const pars = intArr(body.holePars ?? body.hole_pars, 3, 6)
  if (!pars || (pars.length !== 9 && pars.length !== 18)) {
    return { ok: false, error: 'Pars required for all 9 or 18 holes (each 3–6)' }
  }
  // Optional parallel arrays — kept only when complete and the same length.
  const yards = intArr(body.holeYards ?? body.hole_yards, 60, 800)
  const sis = intArr(body.holeSis ?? body.hole_sis, 1, 18)
  const num = (v, min, max) => {
    const x = Number(v)
    return v != null && Number.isFinite(x) && x >= min && x <= max ? x : null
  }
  return {
    ok: true,
    course: {
      club_name,
      course_name: str(body.courseName ?? body.course_name, 80),
      city: str(body.city, 60),
      state: str(body.state, 40),
      country: str(body.country, 40),
      latitude: num(body.latitude, -90, 90),
      longitude: num(body.longitude, -180, 180),
      tee_name: str(body.teeName ?? body.tee_name, 40) ?? 'Standard',
      course_rating: num(body.courseRating ?? body.course_rating, 50, 90),
      slope_rating: num(body.slopeRating ?? body.slope_rating, 55, 155),
      hole_pars: pars,
      hole_yards: yards && yards.length === pars.length ? yards : null,
      hole_sis: sis && sis.length === pars.length ? sis : null,
    },
  }
}

const j = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }

// DB row → /search result shape (rides beside vendor results).
function userCourseSearchResult(row) {
  return {
    id: `u${row.id}`,
    club_name: row.club_name,
    course_name: row.course_name ?? row.club_name,
    city: row.city, state: row.state, country: row.country,
    latitude: row.latitude, longitude: row.longitude,
    source: 'community',
  }
}

// DB row → GET /:id detail shape. One tee, mirrored under both genders so
// every existing tee picker works unchanged. Ratings stay null when the
// creator didn't know them — never fabricate.
function userCourseDetail(row) {
  const pars = j(row.hole_pars) ?? []
  const yards = j(row.hole_yards)
  const sis = j(row.hole_sis)
  const tee = {
    tee_name: row.tee_name ?? 'Standard',
    course_rating: row.course_rating != null ? Number(row.course_rating) : null,
    slope_rating: row.slope_rating != null ? Number(row.slope_rating) : null,
    total_yards: Array.isArray(yards) ? yards.reduce((a, b) => a + b, 0) : null,
    par_total: pars.reduce((a, b) => a + b, 0),
    holes: pars.map((p, i) => ({
      hole: i + 1,
      par: p,
      yardage: Array.isArray(yards) ? yards[i] : null,
      handicap: Array.isArray(sis) ? sis[i] : null,
    })),
  }
  return {
    id: `u${row.id}`,
    club_name: row.club_name,
    course_name: row.course_name ?? row.club_name,
    latitude: row.latitude,
    longitude: row.longitude,
    source: 'community',
    tees: { male: [tee], female: [tee] },
  }
}

module.exports = { isUserCourseId, userCourseRowId, sanitizeCustomCourse, userCourseSearchResult, userCourseDetail }
