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
    `SELECT r.id, r.course_name, r.course_par, r.total, r.date, r.game_type, r.scores, r.hole_pars
     FROM tm_rounds r
     WHERE r.user_id = $1 AND r.total > 0
     ORDER BY r.date DESC LIMIT $2`,
    [req.user.id, limit]
  )
  const { playedCount, parPlayed, toParThrough, isFullRound, equiv18 } = require('../lib/roundMath')
  res.json({ rounds: rows.map(r => {
    const scoresArr = Array.isArray(r.scores) ? r.scores : (() => { try { return JSON.parse(r.scores) } catch { return [] } })()
    const holes     = Array.isArray(scoresArr) ? scoresArr.length : null
    const hp        = playedCount(scoresArr)
    return {
      id:          r.id,
      // snake_case (Profile view + future consumers)
      course_name: r.course_name,
      course_par:  r.course_par,
      score:       r.total,
      played_at:   r.date,
      holes,
      game_type:   r.game_type,
      // Partial-rounds spec §4 D8 — server-computed, clients never re-derive
      // par math on their own. equiv_18 is the trend-chart series (=== total
      // for full 18-hole rounds).
      holes_played:   hp,
      par_played:     parPlayed(r),
      to_par_through: toParThrough(r),
      is_partial:     hp > 0 && !isFullRound(r),
      equiv_18:       equiv18(r),
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
  const { courseName, coursePar, courseRating, slopeRating, gameType, scores, shots, holePars, holeHandicaps, putts, firstPutts, courseId } = req.body
  const total = scores?.reduce((s, x) => s + (x ?? 0), 0) ?? 0

  // 2026-07-16 — reject scoreless rounds at the source. Two all-zero rounds
  // (ids 163/164) reached the DB via the solo summary Save with no holes
  // scored, then rendered as "-71" and polluted avg3 / avgScore / bestScore.
  // The outing /end path has always guarded this (9+ holes, every hole > 0);
  // the solo POST never did. Guard here too so old cached clients can't
  // recreate the bug. Partial rounds (some holes scored) still save.
  const scoredHoles = Array.isArray(scores) ? scores.filter(s => Number(s) > 0).length : 0
  if (!scoredHoles || total <= 0) {
    return res.status(400).json({ error: 'No scores entered — nothing to save' })
  }

  // Phase 3 (2026-07-10, migration 044) — golfcourseapi course id so the
  // post-round shot editor can load hole geometry. Free-form courses → null.
  const cleanCourseId = Number.isFinite(Number(courseId)) && Number(courseId) > 0
    ? Math.trunc(Number(courseId))
    : null

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

  // 2026-07-02 — SG facts (migration 039, docs/SG-DESIGN.md). Putt facts
  // arrive as parallel arrays (matching the scores/hole_pars convention):
  // putts = putt count per hole (null entries OK = no data for that hole),
  // firstPutts = first-putt distance bucket per hole. Facts only — SG is
  // computed at read time in /api/stats/sg, never stored. Invalid shapes
  // are dropped, never 400s: putt capture is optional and must not be able
  // to break round save.
  const SG_BUCKETS = ['in3', '3-10', '10-25', '25plus']
  const cleanPutts = Array.isArray(putts) && putts.length > 0
    && putts.every(p => p == null || (Number.isFinite(Number(p)) && Number(p) >= 0 && Number(p) <= 6))
    ? putts.map(p => (p == null ? null : Number(p)))
    : null
  const cleanFirstPutts = cleanPutts && Array.isArray(firstPutts)
    && firstPutts.every(b => b == null || SG_BUCKETS.includes(b))
    ? firstPutts.map(b => b ?? null)
    : null

  // 2026-07-08 — clean solo shots server-side (the same hygiene the outing
  // PUT /:code/scores applies via cleanHoleShots) so the read-time SG engine
  // only ever walks valid {lie,toPin} chains. Invalid entries dropped, never 400.
  // Scores passed (2026-07-16) so unplayed holes (score 0) drop their shot
  // facts — partial-rounds spec §4 D5.
  const { cleanShotsForRound } = require('../lib/shotFacts')
  const cleanShots = cleanShotsForRound(shots, scores)

  const row = await db.one(
    `INSERT INTO tm_rounds
       (user_id, course_name, course_par, course_rating, slope_rating, game_type, scores, shots, total, hole_pars, hole_handicaps, putts, first_putts, course_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [req.user.id, courseName, coursePar ?? 72, courseRating, slopeRating,
     gameType ?? 'stroke', JSON.stringify(scores ?? []), JSON.stringify(cleanShots ?? []), total,
     cleanHolePars ? JSON.stringify(cleanHolePars) : null,
     cleanHoleHandicaps ? JSON.stringify(cleanHoleHandicaps) : null,
     cleanPutts ? JSON.stringify(cleanPutts) : null,
     cleanFirstPutts ? JSON.stringify(cleanFirstPutts) : null,
     cleanCourseId]
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

// PATCH /api/rounds/:id/putts — add or edit SG putt facts after the fact.
//
// This is how OUTING rounds get putt data (docs/SG-DESIGN.md): the F.5 live
// scoring path stays untouched — after match close fans the outing out into
// per-player tm_rounds, each player tags their own putts here (works for solo
// rounds too). Owner-only; same validation as POST /rounds (invalid shapes
// rejected, but a valid partial array — null entries for unknown holes — is
// always fine). Facts only; SG stays computed at read time.
router.patch('/:id/putts', async (req, res) => {
  const { putts, firstPutts } = req.body || {}
  const SG_BUCKETS = ['in3', '3-10', '10-25', '25plus']
  const cleanPutts = Array.isArray(putts) && putts.length > 0
    && putts.every(p => p == null || (Number.isFinite(Number(p)) && Number(p) >= 0 && Number(p) <= 6))
    ? putts.map(p => (p == null ? null : Number(p)))
    : null
  if (!cleanPutts) return res.status(400).json({ error: 'putts must be an array of per-hole counts (nulls allowed)' })
  const cleanFirstPutts = Array.isArray(firstPutts)
    && firstPutts.length === cleanPutts.length
    && firstPutts.every(b => b == null || SG_BUCKETS.includes(b))
    ? firstPutts.map(b => b ?? null)
    : cleanPutts.map(() => null)

  const row = await db.one(
    `UPDATE tm_rounds
     SET putts = $1, first_putts = $2
     WHERE id = $3 AND user_id = $4
     RETURNING id, putts, first_putts`,
    [JSON.stringify(cleanPutts), JSON.stringify(cleanFirstPutts), req.params.id, req.user.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' }) // wrong id OR not your round
  res.json(row)
})

// PATCH /api/rounds/:id/shots — add or edit per-shot facts after the fact
// (Phase 3 post-round shot editor, 2026-07-10). Sibling of PATCH /:id/putts:
// owner-only (WHERE user_id), server-side re-clean via cleanShotsForRound
// (never trust editor output), facts only — SG stays computed at read time
// and handicap never reads shots, so this endpoint is provably analytics-only.
// The body may ALSO carry { putts, firstPutts } so a full post-hoc entry
// (shots + putts for a zero-capture round) lands in one atomic write; putts
// validation is the /:id/putts logic verbatim. Shots that clean to nothing
// store as SQL null (clearing a log is a legitimate edit).
router.patch('/:id/shots', async (req, res) => {
  const { shots, putts, firstPutts } = req.body || {}
  if (!Array.isArray(shots)) {
    return res.status(400).json({ error: 'shots must be an array of per-hole shot arrays (nulls allowed)' })
  }
  const { cleanShotsForRound } = require('../lib/shotFacts')
  const cleanShots = cleanShotsForRound(shots)

  const sets = ['shots = $1']
  const vals = [cleanShots ? JSON.stringify(cleanShots) : null]
  if (putts !== undefined) {
    const SG_BUCKETS = ['in3', '3-10', '10-25', '25plus']
    const cleanPutts = Array.isArray(putts) && putts.length > 0
      && putts.every(p => p == null || (Number.isFinite(Number(p)) && Number(p) >= 0 && Number(p) <= 6))
      ? putts.map(p => (p == null ? null : Number(p)))
      : null
    if (!cleanPutts) return res.status(400).json({ error: 'putts must be an array of per-hole counts (nulls allowed)' })
    const cleanFirstPutts = Array.isArray(firstPutts)
      && firstPutts.length === cleanPutts.length
      && firstPutts.every(b => b == null || SG_BUCKETS.includes(b))
      ? firstPutts.map(b => b ?? null)
      : cleanPutts.map(() => null)
    sets.push(`putts = $${vals.length + 1}`)
    vals.push(JSON.stringify(cleanPutts))
    sets.push(`first_putts = $${vals.length + 1}`)
    vals.push(JSON.stringify(cleanFirstPutts))
  }
  vals.push(req.params.id, req.user.id)
  const row = await db.one(
    `UPDATE tm_rounds SET ${sets.join(', ')}
     WHERE id = $${vals.length - 1} AND user_id = $${vals.length}
     RETURNING id, shots, putts, first_putts`,
    vals
  )
  if (!row) return res.status(404).json({ error: 'Not found' }) // wrong id OR not your round
  res.json(row)
})

module.exports = router
