// Pure aggregator for the year-end recap card. Pulled out of
// pages/Outing/YearRecap.jsx so it can be tested with plain node
// (no JSX in the parse path). The Canvas rendering + share modal
// stay in the .jsx file; this is just the math.
//
// (2026-05-06 — polish task #10 hardening.)

export function aggregateYear(rounds, year) {
  const inYear = (rounds || []).filter(r => {
    const d = new Date(r.played_at || r.date)
    return !Number.isNaN(d.getTime()) && d.getFullYear() === year
  })
  if (!inYear.length) return null

  const totalRounds = inYear.length
  let best = null
  let bestDiff = Infinity
  let sub80 = 0
  let totalSum = 0
  let totalCount = 0
  const courseCount = {}
  const dateSet = new Set()

  for (const r of inYear) {
    const total = Number(r.score ?? r.total)
    const par   = Number(r.course_par)
    if (Number.isFinite(total) && total > 0) {
      if (total < 80) sub80++
      totalSum += total
      totalCount++
      const diff = Number.isFinite(par) ? total - par : Infinity
      if (diff < bestDiff) {
        bestDiff = diff
        best = { total, par: Number.isFinite(par) ? par : null, played_at: r.played_at || r.date }
      }
    }
    const cn = r.course_name || r.courseName
    if (cn) courseCount[cn] = (courseCount[cn] || 0) + 1
    const d = new Date(r.played_at || r.date)
    if (!Number.isNaN(d.getTime())) {
      dateSet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    }
  }

  const topCourse = Object.entries(courseCount).sort((a, b) => b[1] - a[1])[0]
  const avgScore  = totalCount > 0 ? totalSum / totalCount : null

  return {
    year, totalRounds, sub80, best,
    daysOnCourse: dateSet.size,
    avgScore,
    topCourse: topCourse ? { name: topCourse[0], count: topCourse[1] } : null,
  }
}
