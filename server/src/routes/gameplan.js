// Game Day Strategy (GamePlan) — Phase 0 route.
// (wiki/synthesis/gameday-strategy-build-spec-2026-07-15.md)
//
// POST /api/gameplan            — generate + store a plan for a course/tee/mode
// GET  /api/gameplan/latest     — newest stored plan (optionally per course)
//
// Deterministic facts (course handicap, net-stroke allocation, history
// digest) are computed in lib/gameplan and STORED with the plan; Claude
// only narrates. Forced tool use makes the completion structured — no
// text parsing, no JSON-in-prose fragility.

const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const Anthropic = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')
const db = require('../db')
const { sgPromptBlock, aggregateSG } = require('../lib/sg')
const { analyze } = require('../lib/practice')
const {
  sanitizeHoles, courseHandicap, allocateStrokes, courseHistoryDigest,
  buildFactBlocks, mergePlan, SYSTEM_PROMPT, GAMEPLAN_TOOL,
} = require('../lib/gameplan')

const client = new Anthropic()
const SG_PUTT_GATE = 10 // keep in sync with caddie.js / lib/practice

// Nightly-cadence feature; tighter than caddie chat.
const gameplanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: { error: 'The caddie is still marking up your yardage book — give it a few minutes.' },
})

router.use(requireAuth)

const j = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }

// Same fail-soft context load as the caddie — every piece optional.
async function loadContext(uid, courseId) {
  const [user, clubRow, rounds, courseRounds] = await Promise.all([
    db.one(
      `SELECT name, handicap, sg_baseline, shot_shape, typical_miss, distance_miss
       FROM tm_users WHERE id = $1`, [uid]
    ).catch(() => null),
    db.one('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [uid]).catch(() => null),
    db.many(
      `SELECT r.id, r.date, r.total, r.course_par, r.course_rating, r.scores,
              r.putts, r.first_putts, r.shots,
              COALESCE(r.hole_pars, o.hole_pars) AS hole_pars
       FROM tm_rounds r
       LEFT JOIN tm_outings o ON o.id = r.outing_id
       WHERE r.user_id = $1 ORDER BY r.date DESC LIMIT 20`, [uid]
    ).catch(() => []),
    courseId == null ? Promise.resolve([]) : db.many(
      `SELECT r.scores, COALESCE(r.hole_pars, o.hole_pars) AS hole_pars
       FROM tm_rounds r
       LEFT JOIN tm_outings o ON o.id = r.outing_id
       WHERE r.user_id = $1 AND r.course_id = $2
       ORDER BY r.date DESC LIMIT 20`, [uid, courseId]
    ).catch(() => []),
  ])
  const parse = rs => rs.map(r => ({
    ...r, scores: j(r.scores), putts: j(r.putts), first_putts: j(r.first_putts),
    shots: j(r.shots), hole_pars: j(r.hole_pars),
  }))
  return { user, clubData: clubRow?.club_data ?? null, rounds, sgRounds: parse(rounds), courseRounds: parse(courseRounds) }
}

function bagLine(clubData) {
  if (!clubData || typeof clubData !== 'object') return null
  const clubs = Object.entries(clubData)
    .filter(([, d]) => Array.isArray(d) && d.length)
    .map(([club, d]) => ({ club, avg: Math.round(d.reduce((s, x) => s + x, 0) / d.length), n: d.length }))
    .sort((a, b) => b.avg - a.avg)
  return clubs.length ? clubs.map(c => `${c.club} ${c.avg}y`).join(', ') : null
}

function tendenciesLine(u) {
  if (!u) return null
  const parts = []
  if (u.shot_shape) parts.push(`ball flight: ${u.shot_shape}`)
  if (u.typical_miss) parts.push(`typical miss: ${u.typical_miss}`)
  if (u.distance_miss) parts.push(`distance miss: ${u.distance_miss}`)
  return parts.length ? parts.join(', ') : null
}

// POST /api/gameplan
// Body: { courseId?, courseName, teeName?, gender?, mode?,
//         holes: [{hole, par, yardage, handicap}],
//         courseRating?, slopeRating?, coursePar? }
router.post('/', gameplanLimiter, async (req, res) => {
  const b = req.body || {}
  const clean = (s, n) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n)
  const courseName = clean(b.courseName, 80)
  if (!courseName) return res.status(400).json({ error: 'courseName required' })
  const holes = sanitizeHoles(b.holes)
  if (holes.length < 9) return res.status(400).json({ error: 'holes required (9 or 18 with pars)' })
  const mode = ['medal', 'net', 'money'].includes(b.mode) ? b.mode : 'medal'
  const courseId = Number.isFinite(Number(b.courseId)) ? Number(b.courseId) : null
  const teeName = clean(b.teeName, 40) || null
  const gender = b.gender === 'female' ? 'female' : b.gender === 'male' ? 'male' : null

  try {
    const ctx = await loadContext(req.user.id, courseId)
    const hcpIndex = (ctx.user?.handicap != null && Number.isFinite(Number(ctx.user.handicap)))
      ? Number(ctx.user.handicap) : null

    // Deterministic layer — ours, never the model's.
    const par = holes.reduce((s, h) => s + h.par, 0)
    const ch = courseHandicap(hcpIndex, b.slopeRating, b.courseRating, b.coursePar ?? par)
    const allocated = allocateStrokes(holes, ch)
    const history = courseHistoryDigest(ctx.courseRounds, holes.length)

    // Profile blocks — same fail-soft sources the caddie chat uses.
    let sgBlock = null, puttNote = null
    try {
      sgBlock = sgPromptBlock(ctx.sgRounds, ctx.user?.sg_baseline ?? 'auto', hcpIndex)
      const agg = aggregateSG(ctx.sgRounds, ctx.user?.sg_baseline ?? 'auto', hcpIndex)
      const measured = agg?.roundsWithPutting ?? 0
      puttNote = measured >= SG_PUTT_GATE
        ? `Putting SG is measured over ${measured} rounds — treat as reliable.`
        : `Putting SG rests on ${measured} measured round${measured === 1 ? '' : 's'} (below the ${SG_PUTT_GATE}-round gate) — hedge putting conclusions; never name putting the defining weakness.`
    } catch { /* fail-soft */ }
    let weaknesses = []
    try {
      const a = analyze(ctx.rounds, { handicap: hcpIndex, sgRounds: ctx.sgRounds, sgBaseline: ctx.user?.sg_baseline ?? 'auto' })
      weaknesses = (a?.weaknesses ?? []).slice(0, 3).map(w => `${w.area}: ${w.explanation}`)
    } catch { /* fail-soft */ }

    const factBlocks = buildFactBlocks({
      course: courseName, holes: allocated, ch, mode, history,
      sgBlock, puttNote, tendencies: tendenciesLine(ctx.user), bag: bagLine(ctx.clubData), weaknesses,
    })

    const msg = await client.messages.create({
      model: process.env.CADDIE_MODEL || 'claude-sonnet-5',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [GAMEPLAN_TOOL],
      tool_choice: { type: 'tool', name: GAMEPLAN_TOOL.name },
      messages: [{
        role: 'user',
        content: `Build my game plan for tomorrow.\n\n${factBlocks.join('\n\n')}`,
      }],
    })
    const toolBlock = (msg.content ?? []).find(bl => bl?.type === 'tool_use' && bl.name === GAMEPLAN_TOOL.name)
    if (!toolBlock?.input) {
      console.error('[gameplan] no tool_use in completion — stop_reason:', msg.stop_reason,
        'blocks:', (msg.content ?? []).map(bl => bl?.type).join(','))
      throw new Error('empty completion')
    }
    const plan = mergePlan(toolBlock.input, allocated)
    if (!plan.holes.length) throw new Error('plan had no valid hole cards')

    const facts = {
      courseHandicap: ch, mode, par,
      history: { roundsUsed: history.roundsUsed },
      degraded: {
        noBag: !bagLine(ctx.clubData),
        noHistory: !(history.roundsUsed > 0),
        noHandicap: hcpIndex == null,
      },
    }
    const row = await db.one(
      `INSERT INTO tm_gameplans (user_id, course_id, course_name, tee_name, gender, mode, plan, facts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
      [req.user.id, courseId, courseName, teeName, gender, mode, JSON.stringify(plan), JSON.stringify(facts)]
    )
    res.json({ id: row.id, createdAt: row.created_at, courseId, courseName, teeName, gender, mode, facts, plan })
  } catch (e) {
    console.error('[gameplan]', e.message)
    res.status(500).json({ error: 'The caddie couldn\'t finish the yardage book — try again.' })
  }
})

// GET /api/gameplan/latest[?courseId=]
router.get('/latest', async (req, res) => {
  const courseId = Number.isFinite(Number(req.query.courseId)) ? Number(req.query.courseId) : null
  try {
    const row = await db.one(
      `SELECT id, course_id, course_name, tee_name, gender, mode, plan, facts, created_at
       FROM tm_gameplans
       WHERE user_id = $1 ${courseId != null ? 'AND course_id = $2' : ''}
       ORDER BY created_at DESC LIMIT 1`,
      courseId != null ? [req.user.id, courseId] : [req.user.id]
    ).catch(() => null)
    if (!row) return res.json(null)
    res.json({
      id: row.id, courseId: row.course_id, courseName: row.course_name,
      teeName: row.tee_name, gender: row.gender, mode: row.mode,
      plan: j(row.plan) ?? row.plan, facts: j(row.facts) ?? row.facts, createdAt: row.created_at,
    })
  } catch (e) {
    console.error('[gameplan/latest]', e.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
