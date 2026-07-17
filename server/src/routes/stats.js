const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { aggregateSG, BASELINE_IDS } = require('../lib/sg')

router.use(requireAuth)

// ── Strokes Gained (migration 039, docs/SG-DESIGN.md) ────────────────────────
// SG is NEVER stored — computed at read time from putt/shot facts on tm_rounds
// against the user's chosen baseline. Every UI surface must display the
// concrete baseline next to the numbers.

// Tour-baseline Elite gate: wired but OFF during friends-testing — flip when
// billing goes live so testers aren't locked out of the toggle.
const GATE_TOUR_BASELINE_BEHIND_ELITE = false

// Effective Elite = tier === 'elite' OR a live elite_until (referral bonus) —
// same definition lib/user.js documents.
async function isEffectiveElite(userId) {
  const row = await db.one(
    `SELECT tier, elite_until FROM tm_users WHERE id = $1`, [userId]
  ).catch(() => null)
  if (!row) return false
  return row.tier === 'elite' || (row.elite_until && new Date(row.elite_until) > new Date())
}

function safeParse(s) { try { return JSON.parse(s) } catch { return null } }

const SG_ROUNDS_SQL = `
  SELECT id, date, total, course_par, course_rating, putts, first_putts,
         scores, shots, hole_pars
  FROM tm_rounds WHERE user_id = $1 ORDER BY date DESC LIMIT 20`

// JSONB columns may arrive as strings depending on the pg type parser.
function parseSgRounds(rounds) {
  const j = v => (typeof v === 'string' ? safeParse(v) : v)
  return rounds.map(r => ({
    ...r, putts: j(r.putts), first_putts: j(r.first_putts),
    scores: j(r.scores), shots: j(r.shots), hole_pars: j(r.hole_pars),
  }))
}

// GET /api/stats/sg?baseline=auto|tour|scratch|hcp-5|hcp-10|hcp-15|hcp-20
router.get('/sg', async (req, res) => {
  const uid = req.user.id
  const [rounds, user] = await Promise.all([
    db.many(SG_ROUNDS_SQL, [uid]).catch(() => []),
    db.one('SELECT handicap, sg_baseline FROM tm_users WHERE id = $1', [uid]),
  ])
  if (!rounds.length) return res.json(null)

  const q = req.query.baseline
  let setting = (q && (q === 'auto' || BASELINE_IDS.includes(q)))
    ? q
    : (user?.sg_baseline ?? 'auto')

  if (GATE_TOUR_BASELINE_BEHIND_ELITE && setting === 'tour' && !(await isEffectiveElite(uid))) {
    return res.status(402).json({
      error: 'tier_required', required: 'elite',
      message: 'The PGA Tour baseline is part of The Match Elite.',
    })
  }

  res.json({
    setting, // what the user chose ('auto' included); .baseline is the concrete table
    ...aggregateSG(parseSgRounds(rounds), setting, user?.handicap),
  })
})

// GET /api/stats/sg/rival/:userId — SG head-to-head (Elite).
//
// Both players are compared against the SAME concrete baseline (the viewer's
// resolved setting) — per SG-DESIGN.md the rival comparison is a difference
// of SG values against a shared baseline, never raw expected-strokes
// head-to-head. Allowed only when a relationship exists (friendship or an
// H2H record) so SG isn't an open scraping surface.
router.get('/sg/rival/:userId', async (req, res) => {
  const uid = req.user.id
  const rivalId = parseInt(req.params.userId, 10)
  if (!Number.isFinite(rivalId) || rivalId === uid) {
    return res.status(400).json({ error: 'Invalid rival' })
  }

  if (!(await isEffectiveElite(uid))) {
    return res.status(402).json({
      error: 'tier_required', required: 'elite',
      message: 'Strokes Gained head-to-head is part of The Match Elite.',
    })
  }

  const rel = await db.one(
    `SELECT (EXISTS (
       SELECT 1 FROM tm_friends
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND requestee_id = $2)
           OR (requester_id = $2 AND requestee_id = $1))
     ) OR EXISTS (
       SELECT 1 FROM tm_h2h_records
       WHERE (player_a_id = $1 AND player_b_id = $2)
          OR (player_a_id = $2 AND player_b_id = $1)
     )) AS ok`, [uid, rivalId]
  ).catch(() => null)
  if (!rel?.ok) return res.status(403).json({ error: 'No rivalry with this player' })

  const [me, myRounds, theirRounds, rival] = await Promise.all([
    db.one('SELECT handicap, sg_baseline FROM tm_users WHERE id = $1', [uid]),
    db.many(SG_ROUNDS_SQL, [uid]).catch(() => []),
    db.many(SG_ROUNDS_SQL, [rivalId]).catch(() => []),
    db.one('SELECT id, name, handle FROM tm_users WHERE id = $1', [rivalId]),
  ])
  if (!rival) return res.status(404).json({ error: 'Player not found' })

  // Resolve the viewer's setting to a CONCRETE baseline, then apply that
  // same baseline to both sides (resolving 'auto' per-player would compare
  // apples to oranges).
  const setting = me?.sg_baseline ?? 'auto'
  const probe = aggregateSG(parseSgRounds(myRounds), setting, me?.handicap)
  const baseline = probe.baseline

  res.json({
    baseline,
    mine: aggregateSG(parseSgRounds(myRounds), baseline, me?.handicap),
    theirs: aggregateSG(parseSgRounds(theirRounds), baseline, null),
    rival: { id: rival.id, name: rival.name, handle: rival.handle },
  })
})

// GET /api/stats/summary — handicap + recent averages + top clubs
router.get('/summary', async (req, res) => {
  const uid = req.user.id

  const [roundData, clubData, userRow] = await Promise.all([
    db.many(
      `SELECT total, course_par, course_rating, slope_rating, date, scores, hole_pars
       FROM tm_rounds WHERE user_id = $1 AND total > 0 ORDER BY date DESC LIMIT 20`,
      [uid]
    ),
    db.one('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [uid]),
    db.one('SELECT handicap FROM tm_users WHERE id = $1', [uid]),
  ])

  if (!roundData.length) return res.json(null)

  // Handicap Index — read the persisted, WHS-correct value (computed by
  // lib/handicap.maybeUpdateUserHandicap on every round/match completion:
  // net-double-bogey AGS, sliding table, no 0.96, soft/hard caps). Single source
  // of truth, so the DISPLAYED index always matches the official calc — no
  // divergent recompute here. (audit 2026-06-25)
  const handicap = (userRow && userRow.handicap != null && Number.isFinite(Number(userRow.handicap))) ? Number(userRow.handicap) : null

  // Partial-rounds spec (2026-07-16 §4 D4) — Avg Score is the mean 18-hole-
  // EQUIVALENT over QUALIFYING rounds (≥9 holes played), via the shared
  // roundMath lib. For full 18-hole rounds equiv18 === total exactly, so a
  // full-rounds-only history produces the identical number as before. Partials
  // normalize to holes played; sub-9 rounds are display-only and never enter.
  const { equiv18, isQualifying, isFullRound } = require('../lib/roundMath')
  const avgVals = roundData.filter(isQualifying).map(equiv18).filter(v => v != null)
  const avgScore = avgVals.length
    ? parseFloat((avgVals.reduce((s, v) => s + v, 0) / avgVals.length).toFixed(1))
    : null

  // Top 5 clubs by average distance
  const clubObj = clubData?.club_data ?? {}
  const topClubs = Object.entries(clubObj)
    .map(([club, dists]) => ({
      club,
      avg: Math.round(dists.reduce((s, d) => s + d, 0) / dists.length),
      shots: dists.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)

  // Best Round — REAL totals over FULL rounds only (records are never
  // extrapolations; a partial can't set one). bestScoreHoles lets the client
  // label a 9-hole-course best "(9)".
  const fullRounds = roundData.filter(isFullRound)
  const bestRound = fullRounds.length
    ? fullRounds.reduce((min, r) => (Number(r.total) < Number(min.total) ? r : min))
    : null
  const bestScore = bestRound ? Number(bestRound.total) : null
  const bestScoreHoles = bestRound
    ? (Array.isArray(bestRound.scores) ? bestRound.scores.length : (() => { try { return JSON.parse(bestRound.scores).length } catch { return null } })())
    : null

  res.json({
    handicap,
    handicapTrend: null,
    roundCount: roundData.length,
    avgScore,
    bestScore,
    bestScoreHoles,
    topClubs,
  })
})

module.exports = router
