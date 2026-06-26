// Handicap calculation helpers shared by /api/rounds + /api/stats.
//
// Two-tier formula (graceful degradation):
//
//   • USGA-method (when course_rating + slope_rating present):
//       differential = (score − course_rating) × 113 / slope_rating
//
//   • Par-based fallback (free tier or course without ratings):
//       differential = score − course_par
//
// In both cases: the lowest N of the last 20 Score Differentials, selected per
// the WHS sliding table (Rule 5.2a), averaged → Handicap Index. NO 0.96
// multiplier (WHS removed the "bonus for excellence" in 2020). Net-double-bogey
// Adjusted Gross Score, soft/hard caps, and a 54.0 max are applied (see below).
//
// A round counts only when it's **fully completed**:
//   - scores array has at least 9 entries
//   - every entry is a non-null, non-zero number
//   - 9-hole rounds now COUNT via the WHS 2024 expected-score method (see
//     nineHoleDifferential / expectedNineDifferential) ONCE the player has an
//     established Handicap Index; before establishment they are held (excluded),
//     exactly as WHS holds 9-hole scores until 54 holes are posted. (H.6 —
//     2026-06-26; replaced the earlier do-no-harm exclusion.)
//
// Per Matt's 2026-05-01 requirement: a round in progress where some
// holes haven't been entered must NOT pollute the index. Ratings are
// captured at match-create time when the picked tee carries them
// (paid tier); when absent, the par-based fallback still produces
// a usable index from completed scores.
//
// At least 5 completed rounds in the most recent 20 are required
// before the calculated index displaces the manually-seeded base.

const db = require('../db')

function isRoundCompleted(r) {
  if (!r) return false
  let scores
  try {
    scores = Array.isArray(r.scores)
      ? r.scores
      : JSON.parse(r.scores ?? '[]')
  } catch {
    return false
  }
  if (!Array.isArray(scores) || scores.length < 9) return false
  return scores.every(s => s != null && Number(s) > 0)
}

// Per-round differential.
//   • USGA-method when the round carries a valid course_rating + slope_rating:
//       (score − rating) × 113 / slope
//   • Par-based fallback (free tier / unrated course): score − course_par
// Null when the round lacks the data for either path.
//
// USGA mode was previously gated OFF behind a flag while the captured ratings
// weren't gender-correct (a woman on a shared tee captured the men's rating).
// Now that tee selection is gender-aware (lib/tees.js dedupeTees), rated rounds
// use the proper WHS differential and gender flows through correctly. Unrated
// rounds are unaffected. (Enabled 2026-06-25.)
// Score Differential, rounded to the nearest 0.1 per WHS Rule 5.1a. PCC is set
// to 0 (a standalone app can't compute the field's same-day PCC; it's 0 on most
// days anyway — the consumer-app norm). AGS (net-double-bogey adjusted gross) is
// NOT yet applied — uses raw total; that's the Tier-2 follow-up. (audit 2026-06-25)
function differentialFor(r) {
  const total = Number(r.total)
  if (!Number.isFinite(total)) return null
  const rating = Number(r.course_rating)
  const slope  = Number(r.slope_rating)
  let d
  if (Number.isFinite(rating) && Number.isFinite(slope) && slope > 0) {
    d = ((total - rating) * 113) / slope
  } else {
    const par = Number(r.course_par)
    if (!Number.isFinite(par)) return null
    d = total - par // par-based fallback (unrated/free)
  }
  return Math.round(d * 10) / 10
}

// ── Adjusted Gross Score (net double bogey) — WHS Rule 3.1 ──────────────────
// Strokes a player receives on a hole given its Stroke Index (1..18) and their
// rounded Course Handicap. 1 stroke where SI ≤ CH; wraps (2nd stroke) for
// CH>18. Plus handicaps (CH<0) GIVE strokes back from the easiest holes (SI 18)
// downward (negative). (audit 2026-06-25)
function strokesOnHole(si, ch) {
  if (!Number.isFinite(si) || !Number.isFinite(ch) || ch === 0) return 0
  const H = 18
  if (ch > 0) return Math.floor(ch / H) + (si <= (ch % H) ? 1 : 0)
  const mag = -ch // plus handicap: strokes back from SI 18 down
  return -(Math.floor(mag / H) + ((H - si + 1) <= (mag % H) ? 1 : 0))
}

// Per-hole maximum for Adjusted Gross Score. Established index → net double
// bogey (par + 2 + strokes received). Before an established index → flat par+5.
function netDoubleBogey(par, si, ch, established) {
  if (!established) return par + 5
  return par + 2 + Math.max(0, strokesOnHole(si, ch))
}

// Adjusted Gross Score: each hole's score capped at its net double bogey, summed.
// strokeIndex defaults to 1..18 by hole order when not provided (the documented
// fallback for rounds with no stored Stroke Index). Returns null when the
// per-hole data isn't usable (caller then falls back to the raw total).
function adjustedGrossScore(scores, holePars, strokeIndex, courseHandicap, established = true) {
  if (!Array.isArray(scores) || !Array.isArray(holePars) || scores.length < 9) return null
  if (holePars.length < scores.length) return null
  const ch = Math.round(Number(courseHandicap))
  let ags = 0
  for (let i = 0; i < scores.length; i++) {
    const s = Number(scores[i]); if (!Number.isFinite(s) || s <= 0) return null
    const par = Number(holePars[i]); if (!Number.isFinite(par)) return null
    const si = (Array.isArray(strokeIndex) && Number.isFinite(Number(strokeIndex[i]))) ? Number(strokeIndex[i]) : (i + 1)
    ags += Math.min(s, netDoubleBogey(par, si, established ? ch : 0, established))
  }
  return ags
}

// WHS Rule 5.2a sliding table: given the number of acceptable Score
// Differentials in the record, how many of the LOWEST to average + the
// low-count adjustment. (No ×0.96 — that "bonus for excellence" was REMOVED in
// WHS 2020; the 8-of-20 selection replaced it.) (audit 2026-06-25)
function whsSelection(n) {
  if (n < 3) return null
  if (n === 3) return { count: 1, adj: -2.0 }
  if (n === 4) return { count: 1, adj: -1.0 }
  if (n === 5) return { count: 1, adj: 0 }
  if (n === 6) return { count: 2, adj: -1.0 }
  if (n <= 8) return { count: 2, adj: 0 }
  if (n <= 11) return { count: 3, adj: 0 }
  if (n <= 14) return { count: 4, adj: 0 }
  if (n <= 16) return { count: 5, adj: 0 }
  if (n <= 18) return { count: 6, adj: 0 }
  if (n === 19) return { count: 7, adj: 0 }
  return { count: 8, adj: 0 } // 20+
}

const asArr = (v) => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}

// Rounded Course Handicap for a round, from the player's current Index + the
// round's tee. Used to allocate net-double-bogey strokes. (audit Tier-2)
function courseHandicapFor(r, index) {
  if (!Number.isFinite(index)) return null
  const slope = Number(r.slope_rating), rating = Number(r.course_rating), par = Number(r.course_par)
  if (Number.isFinite(slope) && slope > 0 && Number.isFinite(rating) && Number.isFinite(par)) {
    return Math.round(index * (slope / 113) + (rating - par))
  }
  return Math.round(index) // unrated: Course Handicap ≈ Index
}

// ── WHS 2024 expected 9-hole Score Differential ─────────────────────────────
// Under WHS 2024 a 9-hole score produces a 9-hole Score Differential that is
// ADDED to an "expected" 9-hole differential — a neutral value keyed ONLY to
// the player's current Handicap Index — to form one 18-hole Score Differential
// (USGA Rule 5.1b). The official expected-score lookup is a proprietary,
// HI-keyed normal-distribution table held inside the WHS engine (GHIN) and is
// NOT published. We approximate it with a line fit to the one published USGA
// worked example (HI 14.0 → expected 8.5) plus two reported GHIN conversions
// (HI 10.1 → 6.5, HI 10.3 → 6.6):  expected9 ≈ 0.5214·HI + 1.2.
//   HI 14.0 → 8.50 (exact match to the USGA example)
//   HI 10.1 → 6.47 ≈ 6.5    HI 10.3 → 6.57 ≈ 6.6
// This is a deliberately-labelled ESTIMATE — like our index as a whole, it can
// never be GHIN-exact (the real value also folds in PCC + the proprietary
// table). The constant is isolated here so it is trivial to retune if USGA ever
// publishes the table. (H.6 — 2026-06-26; sources: USGA Rule 5.1b + 9-hole FAQ.)
const EXPECTED9_SLOPE = 0.5214
const EXPECTED9_CONST = 1.2
function expectedNineDifferential(index) {
  const hi = Number(index)
  if (!Number.isFinite(hi)) return null
  const clamped = Math.max(-10, Math.min(54, hi))
  return Math.max(0, EXPECTED9_SLOPE * clamped + EXPECTED9_CONST)
}

// 9-hole Score Differential → 18-hole equivalent via the expected-score method.
// Requires an ESTABLISHED index (`index` finite); before establishment WHS holds
// 9-hole scores until 54 holes are posted, so we return null (held) — a faithful
// v1 simplification (the pre-establishment retroactive backfill is a follow-up).
//
// The course feed (GolfCourseAPI) exposes only 18-hole Course/Slope ratings, so
// we ESTIMATE the 9-hole rating: 9-hole CR = ½·(18-hole CR); 9-hole Slope = the
// 18-hole Slope unchanged (Slope is a 113-centred ratio, NOT halved). `course_par`
// already carries the 9-hole par (~36) for these rounds. Net-double-bogey AGS is
// allocated with the 9-hole Course Handicap (HI/2 form). PCC = 0 (consumer-app
// norm). The 9-hole differential stays UNROUNDED until combined, then the 18-hole
// result is rounded to 0.1 (USGA Rule 5.1b). (H.6 — 2026-06-26)
function nineHoleDifferential(r, index, scores, holePars) {
  if (!Number.isFinite(index)) return null // held until an index is established
  const ratingRaw = Number(r.course_rating) // 18-hole CR from the feed
  const slopeRaw  = Number(r.slope_rating)  // 18-hole Slope (113-based)
  const par9      = Number(r.course_par)     // already the 9-hole par
  const hasRating = Number.isFinite(ratingRaw) && Number.isFinite(slopeRaw) && slopeRaw > 0
  const cr9   = hasRating ? ratingRaw / 2 : null
  const slope9 = hasRating ? slopeRaw : null

  // 9-hole Adjusted Gross Score (net double bogey) using the 9-hole Course
  // Handicap. CH9 = (HI/2)·(Slope9/113) + (CR9 − par9), rounded; unrated → HI/2.
  let gross9 = Number(r.total)
  if (scores && holePars) {
    const ch9 = (hasRating && Number.isFinite(par9))
      ? Math.round((index / 2) * (slope9 / 113) + (cr9 - par9))
      : Math.round(index / 2)
    const ags = adjustedGrossScore(scores, holePars, asArr(r.hole_handicaps), ch9, true)
    if (ags != null) gross9 = ags
  }
  if (!Number.isFinite(gross9)) return null

  // 9-hole Score Differential (unrounded), PCC = 0.
  let d9
  if (hasRating) d9 = ((gross9 - cr9) * 113) / slope9
  else { if (!Number.isFinite(par9)) return null; d9 = gross9 - par9 }

  // Combine with the expected-9 from the player's current Index → 18-hole diff.
  const exp9 = expectedNineDifferential(index)
  if (exp9 == null) return null
  return Math.round((d9 + exp9) * 10) / 10
}

// Per-round Score Differential applying net-double-bogey Adjusted Gross Score
// when the per-hole data is available (scores + pars; stroke index if present,
// else default 1..18), else the raw total. Rounded to 0.1. `index` = the
// player's current Handicap Index (for stroke allocation + established check;
// the standard consumer-app approximation — we don't reconstruct historical
// per-round indexes). 9-hole rounds branch to nineHoleDifferential (WHS 2024
// expected-score method). (audit Tier-2 2026-06-25 · H.6 2026-06-26)
function roundDifferential(r, index) {
  const established = Number.isFinite(index)
  const ch = courseHandicapFor(r, index)
  let gross = Number(r.total)
  const scores = asArr(r.scores), holePars = asArr(r.hole_pars)
  // Hole count: from the scores array when present, else inferred from a 9-hole
  // par (~36) when scores are absent.
  const holeCount = (Array.isArray(scores) && scores.length)
    ? scores.length
    : (Number.isFinite(Number(r.course_par)) && Number(r.course_par) > 0 && Number(r.course_par) < 55 ? 9 : 18)
  // 9-hole rounds → WHS 2024 expected-score method. WHS recognises only 9- or
  // 18-hole scores; any other partial count (10..17) is too ambiguous to post,
  // so it's excluded. (A blank-filled partial 18 never reaches here — it fails
  // isRoundCompleted upstream.)
  if (holeCount !== 18) {
    if (holeCount === 9) return nineHoleDifferential(r, index, scores, holePars)
    return null
  }
  if (scores && holePars) {
    const ags = adjustedGrossScore(scores, holePars, asArr(r.hole_handicaps), ch ?? 0, established)
    if (ags != null) gross = ags
  }
  if (!Number.isFinite(gross)) return null
  const rating = Number(r.course_rating), slope = Number(r.slope_rating)
  let d
  if (Number.isFinite(rating) && Number.isFinite(slope) && slope > 0) d = ((gross - rating) * 113) / slope
  else { const par = Number(r.course_par); if (!Number.isFinite(par)) return null; d = gross - par }
  return Math.round(d * 10) / 10
}

// Handicap Index (WHS Rule 5.2). `rounds` must be most-recent-first (callers
// pass ORDER BY date DESC). Applies net-double-bogey AGS per round (Tier-2) when
// `currentIndex` + per-hole data are present. Uses the most recent 20 acceptable
// differentials, averages the lowest N per the sliding table + low-count
// adjustment, rounds to 0.1, clamps to the WHS maximum 54.0. No 0.96 multiplier.
function computeHandicapFromRounds(rounds, currentIndex) {
  // Preserve "no established index" as null. Number(null) coerces to 0, which
  // would falsely mark a brand-new player as an established scratch — defeating
  // the pre-establishment par+5 AGS cap AND letting 9-hole rounds count before
  // establishment. null stays null (held / par+5); a genuine 0 (scratch) stays
  // 0 (established). (H.6 2026-06-26)
  const n = Number(currentIndex)
  const idx = (currentIndex == null || !Number.isFinite(n)) ? null : n
  const diffs = (rounds || [])
    .filter(isRoundCompleted)
    .map(r => roundDifferential(r, idx))
    .filter(d => d != null)
    .slice(0, 20) // most recent 20 (caller is date-DESC)
  const sel = whsSelection(diffs.length)
  if (!sel) return null // fewer than 3 acceptable scores → no index yet
  const lowest = [...diffs].sort((a, b) => a - b).slice(0, sel.count)
  const index = (lowest.reduce((s, d) => s + d, 0) / lowest.length) + sel.adj
  return Math.min(54.0, Math.max(-10.0, Math.round(index * 10) / 10))
}

// WHS soft + hard caps (Rule 5.8), measured against the Low Handicap Index
// (the lowest Index in the trailing 365 days). SOFT CAP: the portion of an
// increase beyond 3.0 over Low HI is reduced to 50%. HARD CAP: total increase
// limited to 5.0 over Low HI. No limit on downward movement. lowHI null (player
// has <20 scores / no established Low HI) → no caps. (audit Tier-3 2026-06-25)
function applyHandicapCaps(rawIndex, lowHI) {
  if (!Number.isFinite(rawIndex) || !Number.isFinite(lowHI)) return rawIndex
  const increase = rawIndex - lowHI
  if (increase <= 3.0) return rawIndex
  const soft = lowHI + 3.0 + (increase - 3.0) * 0.5 // soft cap (50% of excess >3.0)
  const capped = Math.min(soft, lowHI + 5.0)         // hard cap (max +5.0)
  return Math.round(capped * 10) / 10
}

// Recompute and (if 3+ completed rounds exist) persist the handicap
// to tm_users.handicap. WHS issues an index after 54 holes (≈3 18-hole
// rounds; the sliding table starts at 3 differentials). Below that, the
// manually-seeded base value stays in place untouched. (audit 2026-06-25 —
// was 5; WHS minimum is 3.)
async function maybeUpdateUserHandicap(userId) {
  try {
    // Current Index for net-double-bogey stroke allocation (the standard
    // approximation — we don't reconstruct historical per-round indexes).
    let currentIndex = null
    try {
      const u = await db.one('SELECT handicap FROM tm_users WHERE id = $1', [userId])
      if (u && u.handicap != null && Number.isFinite(Number(u.handicap))) currentIndex = Number(u.handicap)
    } catch { /* no current index → pre-establishment caps (par+5) */ }
    // Per-hole pars AND Stroke Index from the round (solo) or its outing. Solo
    // rounds now capture the picked tee's Stroke Index too (migration 033), so a
    // solo round handicaps identically to an outing round — the COALESCE falls
    // through to the outing's values only for legacy solo rounds saved before
    // 033. (2026-06-26 — Matt: solo rounds must work exactly the same.)
    const rounds = await db.many(
      `SELECT r.total, r.course_par, r.course_rating, r.slope_rating, r.scores,
              COALESCE(r.hole_pars, o.hole_pars) AS hole_pars,
              COALESCE(r.hole_handicaps, o.hole_handicaps) AS hole_handicaps
       FROM tm_rounds r
       LEFT JOIN tm_outings o ON o.id = r.outing_id
       WHERE r.user_id = $1
       ORDER BY r.date DESC
       LIMIT 20`,
      [userId]
    )
    const completedCount = rounds.filter(isRoundCompleted).length
    if (completedCount < 3) return null
    const rawHcp = computeHandicapFromRounds(rounds, currentIndex)
    if (rawHcp == null) return null

    // WHS soft/hard caps (Rule 5.8) — only once the player has 20 acceptable
    // scores (Low HI is established then). Low HI = lowest recorded index in
    // the trailing 365 days; null on the first calc / sparse history → no cap.
    let hcp = rawHcp
    if (completedCount >= 20) {
      let lowHI = null
      try {
        const row = await db.one(
          `SELECT MIN(handicap_index) AS low FROM tm_handicap_history
           WHERE user_id = $1 AND computed_at >= now() - interval '365 days'`,
          [userId]
        )
        if (row && row.low != null && Number.isFinite(Number(row.low))) lowHI = Number(row.low)
      } catch (e) { console.error('[handicap] low-HI read failed:', e.message) }
      hcp = applyHandicapCaps(rawHcp, lowHI)
    }

    await db.query('UPDATE tm_users SET handicap = $1 WHERE id = $2', [hcp, userId])
    // Record this revision so future Low-HI windows can see it (fire-and-forget).
    db.query('INSERT INTO tm_handicap_history (user_id, handicap_index) VALUES ($1, $2)', [userId, hcp])
      .catch(e => console.error('[handicap] history write failed:', e.message))
    return hcp
  } catch (e) {
    console.error('[handicap] maybeUpdateUserHandicap failed:', e.message)
    return null
  }
}

module.exports = {
  isRoundCompleted,
  // Backwards-compat alias — older imports referenced
  // isRoundCompletedAndRated. Now any completed round counts; a
  // missing rating just shifts the differential formula.
  isRoundCompletedAndRated: isRoundCompleted,
  differentialFor,
  strokesOnHole,
  netDoubleBogey,
  adjustedGrossScore,
  expectedNineDifferential,
  nineHoleDifferential,
  applyHandicapCaps,
  computeHandicapFromRounds,
  maybeUpdateUserHandicap,
}
