// Per-course Eagle Eye hole persistence — extracted from EagleEye.jsx
// (Phase 1 / S2 of the Play-funnel plan, 2026-07-10) so round-START flows
// outside Eagle Eye (solo SetupSheet, later the Play funnel) can reset the
// hole to 1 before seeding sharedCourse. Without the reset, Eagle Eye's
// sharedCourse sync effect resumes the course's last-viewed hole
// (readEyeHole) — correct after a reload mid-round, wrong when a NEW round
// starts at a previously-played course (would open on e.g. hole 14).
//
// Keyed by course id so switching courses doesn't carry a stale hole.
// Hole values are 1-indexed (Eagle Eye's currentHole convention).
// (Original: EagleEye.jsx, 2026-06-06.)

const EYE_HOLE_KEY = 'tm-eye-hole'

export function readEyeHole(courseId) {
  if (!courseId) return null
  try {
    const v = JSON.parse(localStorage.getItem(EYE_HOLE_KEY) || 'null')
    if (v && String(v.courseId) === String(courseId) && v.hole >= 1) return v.hole
  } catch { /* ignore */ }
  return null
}

export function saveEyeHole(courseId, hole) {
  if (!courseId) return
  try { localStorage.setItem(EYE_HOLE_KEY, JSON.stringify({ courseId, hole })) } catch { /* ignore */ }
}
