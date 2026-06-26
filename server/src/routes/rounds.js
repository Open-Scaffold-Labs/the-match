const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { maybeUpdateUserHandicap } = require('../lib/handicap')

router.use(requireAuth)

// GET /api/rounds
// Returns the user's recent rounds. Field names are the snake_case the
// DB uses, matched by the Profile view's recent-rounds list (r.score,
// r.course_par, r.played_at, r.holes). Older callers receiving camelCase
// keep working via duplicated keys.
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? 10), 50)
  const rows  = await db.many(
    `SELECT r.id, r.course_name, r.course_par, r.total, r.date, r.game_type, r.scores
     FROM tm_rounds r
     WHERE r.user_id = $1
     ORDER BY r.date DESC LIMIT $2`,
    [req.user.id, limit]
  )
  res.json({ rounds: rows.map(r => {
    const scoresArr = Array.isArray(r.scores) ? r.scores : (() => { try { return JSON.parse(r.scores) } catch { return [] } })()
    const holes     = Array.isArray(scoresArr) ? scoresArr.length : null
    return {
      id:          r.id,
      // snake_case (Profile view + future consumers)
      course_name: r.course_name,
      course_par:  r.course_par,
      score:       r.total,
      played_at:   r.date,
      holes,
      game_type:   r.game_type,
      // camelCase legacy keys (kept so existing callers don't break)
      courseName:  r.course_name,
      coursePar:   r.course_par,
      total:       r.total,
      date:        r.date,
      gameType:    r.game_type,
    }
  }) })
})

// POST /api/rounds
router.post('/', async (req, res) => {
  const { courseName, coursePar, courseRating, slopeRating, gameType, scores, shots, holePars, holeHandicaps } = req.body
  const total = scores?.reduce((s, x) => s + (x ?? 0), 0) ?? 0

  // 2026-05-07 PM — holePars accepted from solo client so the
  // server can detect per-hole achievements (first_birdie, first_eagle,
  // first_par, hole_in_one) AND persist real pars on the row (so
  // RoundScorecard renders the actual pars on re-open instead of
  // estimateHolePars's synthetic spread). Validate it's an array of
  // numeric pars before storing — anything else is ignored. Stored
  // via migration 027.
  const cleanHolePars = Array.isArray(holePars)
    && holePars.length > 0
    && holePars.every(p => Number.isFinite(Number(p)) && Number(p) >= 3 && Number(p) <= 6)
    ? holePars.map(p => Number(p))
    : null

  // 2026-06-26 — holeHandicaps (per-hole Stroke Index, 1..18) accepted from the
  // solo client so a solo round gets net-double-bogey Adjusted Gross Score on
  // the REAL Stroke Index — exactly like an outing round (which reads SI from
  // its linked tm_outings row). Without it the handicap AGS fell back to a
  // synthetic 1..18 SI. Validate before storing. Persisted via migration 033.
  // (Matt: "solo rounds need to function exactly the same as any other round".)
  const cleanHoleHandicaps = Array.isArray(holeHandicaps)
    && holeHandicaps.length > 0
    && holeHandicaps.every(h => Number.isFinite(Number(h)) && Number(h) >= 1 && Number(h) <= 18)
    ? holeHandicaps.map(h => Number(h))
    : null

  const row = await db.one(
    `INSERT INTO tm_rounds
       (user_id, course_name, course_par, course_rating, slope_rating, game_type, scores, shots, total, hole_pars, hole_handicaps)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [req.user.id, courseName, coursePar ?? 72, courseRating, slopeRating,
     gameType ?? 'stroke', JSON.stringify(scores ?? []), JSON.stringify(shots ?? []), total,
     cleanHolePars ? JSON.stringify(cleanHolePars) : null,
     cleanHoleHandicaps ? JSON.stringify(cleanHoleHandicaps) : null]
  )

  // 2026-05-05 — AWAITED. Was fire-and-forget which silently failed
  // on Vercel (lambda freezes after res.json, killing the in-flight
  // SELECT/UPDATE in the handicap helper). User's handicap index
  // wouldn't update after a solo round. ~100-300ms latency cost on
  // round save; worth it for stats accuracy.
  await maybeUpdateUserHandicap(req.user.id).catch(err => {
    console.warn('[rounds] handicap recompute failed', err.message)
  })

  // Achievement detection (2026-05-06 — polish task #5). Same lambda
  // freeze contract — awaited, failures swallowed. Newly-awarded
  // achievements come back so the client can show the unlock card.
  let newly = []
  try {
    const { checkAfterSoloRound } = require('../lib/achievements')
    newly = await checkAfterSoloRound({
      user_id:    req.user.id,
      total,
      scores,
      course_par: Number(coursePar) || 72,
      // 2026-05-07 PM — pass the cleaned hole pars so the per-hole
      // achievements (first_birdie, first_eagle, first_par, hole_in_one)
      // can detect on solo rounds. Falls back to null when the client
      // didn't send pars or they failed validation.
      holePars:   cleanHolePars,
    })
  } catch (e) {
    console.warn('[achievements] check after solo round failed', e.message)
  }

  // Referral qualification (2026-05-07 PM3). If this user was referred
  // and this is their first qualifying round, mark the referral and
  // trigger milestone-award checks for the referrer. No-op if the user
  // wasn't referred or has already qualified. Awaited so the lambda
  // doesn't freeze the in-flight UPDATE.
  try {
    const { markReferralQualified } = require('../lib/referrals')
    await markReferralQualified(req.user.id)
  } catch (e) {
    console.warn('[referrals] mark-qualified after solo round failed', e.message)
  }

  res.status(201).json({ id: row.id, achievements: newly })
})

// GET /api/rounds/:id
// Returns the round + per-hole par data from the linked outing (when
// outing_id is set). Any authenticated user can fetch any round —
// scorecards aren't private (they show up on friend profiles via the
// Recent Rounds list, and matches are inherently shared between
// participants). Tighten this if/when round privacy becomes a thing.
// (2026-05-01 — was r.user_id = req.user.id; loosened so the
// FriendProfile's Recent Rounds list can open the same scorecards
// the My Profile view opens.)
router.get('/:id', async (req, res) => {
  const row = await db.one(
    // 2026-05-07 PM — COALESCE the round's own hole_pars (set on solo
    // rounds via migration 027) with the outing's hole_pars (set on
    // matches). For solo rounds tm_outings JOIN returns null, so we
    // fall through to r.hole_pars; for outing-linked rounds r.hole_pars
    // is null and we use the outing's. Either way the response field
    // stays "hole_pars" so the client doesn't change.
    `SELECT r.*,
            COALESCE(r.hole_pars, o.hole_pars) AS hole_pars,
            o.course_name AS outing_course_name,
            o.state AS outing_state,
            u.name   AS owner_name,
            u.handle AS owner_handle,
            u.avatar AS owner_avatar
     FROM tm_rounds r
     LEFT JOIN tm_outings o ON o.id = r.outing_id
     LEFT JOIN tm_users   u ON u.id = r.user_id
     WHERE r.id = $1`,
    [req.params.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })

  // Co-participants for the scorecard: every other player in the same
  // outing as this round, so the popup can show the full party's
  // scorecards (Matt 2026-05-07: "in my most recent round I played with
  // Dan, James Ashe, and James Ryan who was a manually non-account
  // entry... both Dan and James Ashe have accounts, so their scores
  // should be viewable in that round scorecard pop up as well").
  //
  // Account users come from tm_outing_participants. Guest users (no
  // user_id) live in tm_outings.state.participants JSON only — pull
  // them from there so the round popup also surfaces guest scores.
  // The focal user (the round's owner) is excluded from co_participants
  // so the client doesn't render them twice.
  let co_participants = []
  if (row.outing_id) {
    const accountRows = await db.many(
      `SELECT op.user_id, op.scores, op.total, u.name, u.handle, u.avatar
         FROM tm_outing_participants op
         LEFT JOIN tm_users u ON u.id = op.user_id
        WHERE op.outing_id = $1
          AND op.user_id IS NOT NULL
          AND op.user_id <> $2
        ORDER BY op.total ASC NULLS LAST`,
      [row.outing_id, row.user_id]
    )
    co_participants = accountRows.map(r => ({
      user_id:  r.user_id,
      name:     r.name,
      handle:   r.handle,
      avatar:   r.avatar,
      scores:   r.scores || [],
      total:    r.total,
      is_guest: false,
    }))

    // Guest participants from the outing state JSON. Detect them by
    // is_guest flag OR by user_id starting with 'guest_' (the legacy
    // marker pattern used pre-flag).
    const stateParticipants = (row.outing_state && row.outing_state.participants) || []
    for (const p of stateParticipants) {
      const isGuest = p.is_guest === true || (typeof p.user_id === 'string' && p.user_id.startsWith('guest_'))
      if (!isGuest) continue
      co_participants.push({
        user_id:  null,
        name:     p.name || 'Guest',
        handle:   null,
        avatar:   null,
        scores:   Array.isArray(p.scores) ? p.scores : [],
        total:    p.total ?? null,
        is_guest: true,
      })
    }
  }

  // Don't leak the entire outing state — only return the parsed
  // co-participants list. The round row itself is unchanged shape so
  // existing clients that don't read co_participants stay backwards
  // compatible.
  delete row.outing_state
  res.json({ ...row, co_participants })
})

module.exports = router
