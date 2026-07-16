// Community courses (migration 047) — unit tests for the pure layer.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const {
  isUserCourseId, userCourseRowId, sanitizeCustomCourse,
  userCourseSearchResult, userCourseDetail,
} = require('../src/lib/customCourse')

describe('id scheme', () => {
  it('u-prefixed ids never collide with vendor ints', () => {
    expect(isUserCourseId('u12')).toBe(true)
    expect(userCourseRowId('u12')).toBe(12)
    expect(isUserCourseId('12')).toBe(false)
    expect(isUserCourseId(12)).toBe(false)
    expect(isUserCourseId('uabc')).toBe(false)
    expect(userCourseRowId('12')).toBeNull()
  })
})

describe('sanitizeCustomCourse', () => {
  const pars9 = [4, 3, 5, 4, 4, 4, 5, 3, 4]
  it('accepts a minimal 9-hole course', () => {
    const r = sanitizeCustomCourse({ clubName: '  Riverside  CC ', holePars: pars9 })
    expect(r.ok).toBe(true)
    expect(r.course.club_name).toBe('Riverside CC')
    expect(r.course.hole_pars).toEqual(pars9)
    expect(r.course.tee_name).toBe('Standard')
  })
  it('rejects missing name and bad par arrays', () => {
    expect(sanitizeCustomCourse({ holePars: pars9 }).ok).toBe(false)
    expect(sanitizeCustomCourse({ clubName: 'X', holePars: pars9.slice(0, 7) }).ok).toBe(false)
    expect(sanitizeCustomCourse({ clubName: 'X', holePars: [...pars9.slice(0, 8), 9] }).ok).toBe(false)
    expect(sanitizeCustomCourse({ clubName: 'X' }).ok).toBe(false)
  })
  it('keeps optional arrays only when complete and matching length', () => {
    const yards = [380, 165, 520, 410, 350, 190, 495, 400, 430]
    const good = sanitizeCustomCourse({ clubName: 'X', holePars: pars9, holeYards: yards })
    expect(good.course.hole_yards).toEqual(yards)
    const short = sanitizeCustomCourse({ clubName: 'X', holePars: pars9, holeYards: yards.slice(0, 5) })
    expect(short.course.hole_yards).toBeNull()
  })
  it('range-checks rating and slope; junk → null', () => {
    const r = sanitizeCustomCourse({ clubName: 'X', holePars: pars9, courseRating: 71.8, slopeRating: 130 })
    expect(r.course.course_rating).toBe(71.8)
    expect(r.course.slope_rating).toBe(130)
    const junk = sanitizeCustomCourse({ clubName: 'X', holePars: pars9, courseRating: 999, slopeRating: 10 })
    expect(junk.course.course_rating).toBeNull()
    expect(junk.course.slope_rating).toBeNull()
  })
})

describe('shapes', () => {
  const row = {
    id: 5, club_name: 'Riverside CC', course_name: null, city: 'Marin', state: 'CA',
    country: null, latitude: 38.0, longitude: -122.5, tee_name: 'Standard',
    course_rating: '71.8', slope_rating: 130,
    hole_pars: JSON.stringify([4, 3, 5, 4, 4, 4, 5, 3, 4]),
    hole_yards: null, hole_sis: null,
  }
  it('search result carries the u-id and community source', () => {
    const s = userCourseSearchResult(row)
    expect(s.id).toBe('u5')
    expect(s.source).toBe('community')
    expect(s.course_name).toBe('Riverside CC') // falls back to club name
  })
  it('detail mirrors the single tee under both genders (pickers unchanged)', () => {
    const d = userCourseDetail(row)
    expect(d.tees.male).toHaveLength(1)
    expect(d.tees.female).toHaveLength(1)
    expect(d.tees.male[0].par_total).toBe(36)
    expect(d.tees.male[0].course_rating).toBe(71.8)
    expect(d.tees.male[0].holes[2]).toEqual({ hole: 3, par: 5, yardage: null, handicap: null })
    expect(d.tees.male[0].total_yards).toBeNull() // no yards → never fabricated
  })
})
