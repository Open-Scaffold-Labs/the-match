// ─── lib/achievements.js ────────────────────────────────────────────────────
// Server-side detection + awarding of the v1 achievement set:
//   • first_eagle  — first hole scored at par-2 or better, OR a 1 on any
//                    par (a HIO is recognized as an eagle-or-better moment)
//   • sub_80       — first 18-hole round with total < 80 strokes
//   • streak_week  — first time the user has logged ≥3 rounds in any
//                    rolling 7-day window
//
// Each achievement is enforced first-time-only at the DB layer via the
// (user_id, type) unique index in migrations/020_tm_achievements.sql, so
// detection here can be aggressively eager — we only INSERT, the index
// silently no-ops repeats. RETURNING tells us whether the row landed.
//
// Two public entry points:
//   • checkAfterHoleScore({ user_id, outing_id, hole, par, score, scores,
//                          course_par })
//       Called after a hole score is written in /api/outings/:code/scores.
//       Detects first_eagle (hole-level) and sub_80 (when the 18 fills),
//       plus streak_week (cheap; counts last-7-day distinct dates).
//   • checkAfterSoloRound({ user_id, total, scores, course_par })
//       Called after a solo round is saved in /api/rounds POST. Detects
//       sub_80 + streak_week. (no first_eagle here — solo rounds don't
//       store per-hole pars, so eagle is ambiguous; matches do.)
//   • getUserAchievements(userId)  →  array, most-recent first.
//
// All inserts are awaited (Vercel lambda freeze pattern — same lesson the
// score-audit + handicap helpers learned 2026-05-05). Failures are logged
// and swallowed; a missed achievement shouldn't block a score write.
// (2026-05-06 — polish task #5)

const db = require('../db')
const { sendPushToUser } = require('./push')

// Map of internal type → display payload. Used by both server (the unlock
// response payload, so the client can render the toast without an extra
// fetch) and the GET /api/me/achievements endpoint.
const META = {
  first_eagle: {
    title: 'Eagle eye',
    subtitle: 'First eagle on the card',
    icon: 'eagle',
  },
  sub_80: {
    title: 'Sub-80',
    subtitle: 'First 18-hole round under 80',
    icon: 'flame',
  },
  streak_week: {
    title: 'Three-round week',
    subtitle: 'Three rounds inside seven days',
    icon: 'streak',
  },
}

function withMeta(row) {
  if (!row) return null
  const meta = META[row.type] || {}
  return {
    id:                row.id,
    type:              row.type,
    title:             meta.title || row.type,
    subtitle:          meta.subtitle || '',
    icon:              meta.icon || 'badge',
    context_outing_id: row.context_outing_id || null,
    metadata:          row.metadata || null,
    earned_at:         row.earned_at,
  }
}

async function maybeAwardAchievement(userId, type, ctx = {}) {
  if (!userId || String(userId).startsWith('guest_')) return null
  if (!META[type]) return null   // unknown type — quietly drop
  try {
    const r = await db.query(
      `INSERT INTO tm_achievements (user_id, type, context_outing_id, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, type) DO NOTHING
       RETURNING id, type, context_outing_id, metadata, earned_at`,
      [
        Number(userId),
        type,
        ctx.outing_id != null ? Number(ctx.outing_id) : null,
        ctx.metadata ? JSON.stringify(ctx.metadata) : null,
      ]
    )
    const awarded = withMeta(r.rows?.[0])
    // 2026-05-06 hardening — push notify the player when an achievement
    // is earned. Closes the gap where a host scoring a player's eagle
    // would credit the badge to the player but the player's phone
    // never knew (player wasn't the writer, so no client response to
    // listen to). Push is fire-and-forget intentionally — sendPushToUser
    // already swallows failures and removes stale subscriptions.
    if (awarded) {
      sendPushToUser(Number(userId), {
        title: `🏆 ${awarded.title}`,
        body:  awarded.subtitle,
        tag:   `achievement-${awarded.type}`,
        // Open at root — if the user is mid-match, they keep their
        // context. The in-app toast (App.jsx → AchievementToast) is
        // what pops as soon as the page foregrounds, so we don't need
        // the URL itself to deep-link to Profile.
        url:   '/',
      }).catch(err => console.warn('[achievements] push failed', err?.message))
    }
    return awarded
  } catch (e) {
    console.warn('[achievements] insert failed', type, e.message)
    return null
  }
}

// Streak-week check — counts distinct calendar dates the user has
// committed a round on in the last 7 days. We pull from BOTH tm_rounds
// (solo) and tm_outing_participants (matches with at least one hole
// scored), since the user perception of a "round" includes both.
async function _streakWeekCount(userId) {
  try {
    const r = await db.query(
      `WITH days AS (
         SELECT DATE(date) AS d
           FROM tm_rounds
           WHERE user_id = $1 AND date >= NOW() - INTERVAL '7 days'
         UNION
         SELECT DATE(o.created_at) AS d
           FROM tm_outing_participants p
           JOIN tm_outings o ON o.id = p.outing_id
           WHERE p.user_id = $1
             AND o.created_at >= NOW() - INTERVAL '7 days'
             AND COALESCE(p.total, 0) > 0
       )
       SELECT COUNT(*)::int AS c FROM (SELECT DISTINCT d FROM days) x`,
      [Number(userId)]
    )
    return Number(r.rows?.[0]?.c || 0)
  } catch (e) {
    console.warn('[achievements] streak-week count failed', e.message)
    return 0
  }
}

// Called after a per-hole score lands in an outing.
async function checkAfterHoleScore({ user_id, outing_id, hole, par, score, scores, course_par }) {
  const newly = []
  if (!user_id || String(user_id).startsWith('guest_')) return newly

  // first_eagle — score is 1 (HIO), or score ≤ par - 2 (eagle/albatross)
  // on a par ≥ 3.
  const isEagleOrBetter =
    Number.isFinite(score) && Number.isFinite(par) && score >= 1 &&
    (score === 1 || score - par <= -2)
  if (isEagleOrBetter) {
    const a = await maybeAwardAchievement(user_id, 'first_eagle', {
      outing_id,
      metadata: { hole: Number(hole) + 1, par, score },
    })
    if (a) newly.push(a)
  }

  // sub_80 — 18-hole round, all 18 filled, total < 80. We only check on
  // the write that completes the 18th hole. (Earlier writes wouldn't
  // satisfy `filled === 18`; later writes are no-ops via the unique
  // index.)
  if (Array.isArray(scores) && scores.length === 18 && Number.isFinite(course_par)) {
    const filled = scores.filter(s => Number(s) > 0).length
    if (filled === 18) {
      const total = scores.reduce((s, x) => s + Number(x || 0), 0)
      if (total > 0 && total < 80) {
        const a = await maybeAwardAchievement(user_id, 'sub_80', {
          outing_id,
          metadata: { total, course_par },
        })
        if (a) newly.push(a)
      }
    }
  }

  // streak_week — cheap count, only run if we wrote something nontrivial.
  // No early bail; the cost is one query per score write. If that
  // becomes a hot-path issue later, gate on "user does not yet have
  // streak_week" first.
  const days = await _streakWeekCount(user_id)
  if (days >= 3) {
    const a = await maybeAwardAchievement(user_id, 'streak_week', {
      outing_id,
      metadata: { days_in_window: days },
    })
    if (a) newly.push(a)
  }

  return newly
}

// Called after a solo round is saved.
async function checkAfterSoloRound({ user_id, total, scores, course_par }) {
  const newly = []
  if (!user_id || String(user_id).startsWith('guest_')) return newly

  // sub_80 — solo round equivalent.
  if (Array.isArray(scores) && scores.length === 18 && Number.isFinite(course_par)) {
    const filled = scores.filter(s => Number(s) > 0).length
    if (filled === 18 && Number(total) > 0 && Number(total) < 80) {
      const a = await maybeAwardAchievement(user_id, 'sub_80', {
        metadata: { total: Number(total), course_par },
      })
      if (a) newly.push(a)
    }
  }

  // streak_week — same query as the outing path.
  const days = await _streakWeekCount(user_id)
  if (days >= 3) {
    const a = await maybeAwardAchievement(user_id, 'streak_week', {
      metadata: { days_in_window: days },
    })
    if (a) newly.push(a)
  }

  return newly
}

async function getUserAchievements(userId) {
  if (!userId) return []
  try {
    const r = await db.query(
      `SELECT id, type, context_outing_id, metadata, earned_at
       FROM tm_achievements
       WHERE user_id = $1
       ORDER BY earned_at DESC`,
      [Number(userId)]
    )
    return (r.rows || []).map(withMeta).filter(Boolean)
  } catch (e) {
    console.warn('[achievements] list failed', e.message)
    return []
  }
}

module.exports = {
  META,
  maybeAwardAchievement,
  checkAfterHoleScore,
  checkAfterSoloRound,
  getUserAchievements,
}
