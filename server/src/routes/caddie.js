// AI Caddie — Claude chat calibrated to the player's actual game
// (whitepaper §5.6, docs/SG-DESIGN.md "AI Caddie contract", 2026-07-02).
//
// The caddie is only as honest as its context. The system prompt is built
// server-side from FACTS we hold: bag averages, WHS handicap, ball-flight
// tendencies, the Strokes Gained block (lib/sg.sgPromptBlock), and the
// practice engine's evidence-based weaknesses. Everything is fail-soft —
// a player with zero data gets a competent generic caddie, never an error.
//
// Putting discipline (SG-DESIGN research notes, Brill & Wyner 2025): putting
// SG is noise in small samples. The prompt carries the measured-round count
// and instructs the model to hedge putting conclusions below the gate — and
// to NEVER rank putting as the player's defining weakness from thin data.

const router      = require('express').Router()
const rateLimit   = require('express-rate-limit')
const Anthropic   = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { sgPromptBlock, aggregateSG } = require('../lib/sg')
const { analyze } = require('../lib/practice')
const { buildTimeline, detectEras } = require('../lib/swingTimeline')
const { factsPromptBlock } = require('../lib/swingNarrator')

const client = new Anthropic()

const SG_PUTT_GATE = 10 // keep in sync with lib/practice SG_PUTT_MIN_ROUNDS

// Per-user limiter — the caddie calls a paid model.
const caddieLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: { error: 'Easy, tiger — the caddie needs a breather. Try again in a few minutes.' },
})

router.use(requireAuth)

// Everything the system prompt needs, in one round trip. Every piece is
// optional — .catch(() => null) keeps a missing table/row from killing chat.
async function loadPlayerContext(uid) {
  const [user, clubRow, rounds, swingRows] = await Promise.all([
    db.one(
      `SELECT name, handicap, sg_baseline, shot_shape, typical_miss, distance_miss
       FROM tm_users WHERE id = $1`, [uid]
    ).catch(() => null),
    db.one('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [uid]).catch(() => null),
    db.many(
      `SELECT r.id, r.date, r.total, r.course_par, r.course_rating, r.scores,
              r.putts, r.first_putts, r.shots,
              COALESCE(r.hole_pars, o.hole_pars)           AS hole_pars,
              COALESCE(r.hole_handicaps, o.hole_handicaps) AS hole_handicaps
       FROM tm_rounds r
       LEFT JOIN tm_outings o ON o.id = r.outing_id
       WHERE r.user_id = $1 ORDER BY r.date DESC LIMIT 20`, [uid]
    ).catch(() => []),
    // Swing Intelligence facts (V0+). tm_swing_* may not exist on an env
    // without migration 050 — .catch(() => []) keeps chat alive regardless.
    db.many(
      `SELECT w.session_id, s.date, s.club_slot, w.duration_ms, w.tempo_ratio
       FROM tm_swings w JOIN tm_swing_sessions s ON s.id = w.session_id
       WHERE s.user_id = $1 ORDER BY s.date ASC`,
      [uid]
    ).catch(() => []),
  ])

  const j = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }
  const sgRounds = rounds.map(r => ({
    ...r, scores: j(r.scores), putts: j(r.putts), first_putts: j(r.first_putts),
    shots: j(r.shots), hole_pars: j(r.hole_pars),
  }))
  return { user, clubData: clubRow?.club_data ?? null, rounds, sgRounds, swingRows }
}

function bagLine(clubData) {
  if (!clubData || typeof clubData !== 'object') return null
  const clubs = Object.entries(clubData)
    .filter(([, d]) => Array.isArray(d) && d.length)
    .map(([club, d]) => ({ club, avg: Math.round(d.reduce((s, x) => s + x, 0) / d.length), n: d.length }))
    .sort((a, b) => b.avg - a.avg)
  if (!clubs.length) return null
  return clubs.map(c => `${c.club} ${c.avg}y (${c.n} shots)`).join(', ')
}

function tendenciesLine(u) {
  if (!u) return null
  const parts = []
  if (u.shot_shape)    parts.push(`ball flight: ${u.shot_shape}`)
  if (u.typical_miss)  parts.push(`typical miss: ${u.typical_miss}`)
  if (u.distance_miss) parts.push(`distance miss: ${u.distance_miss}`)
  return parts.length ? parts.join(', ') : null
}

function buildSystemPrompt(ctx, round) {
  const { user, clubData, sgRounds, swingRows } = ctx
  const handicap = (user?.handicap != null && Number.isFinite(Number(user.handicap)))
    ? Number(user.handicap) : null

  const lines = [
    'You are The Match Caddie — a sharp, friendly, experienced golf caddie inside The Match app.',
    'Answer like a great caddie on the bag: direct, specific, one clear recommendation, brief reasoning. Keep answers under 120 words unless asked to elaborate.',
    'Ground every club recommendation in the PLAYER PROFILE below. If the player averages 155 with a 7-iron, never recommend it for a 170-yard shot. If profile data is missing for a question, say what you\'d need rather than inventing numbers.',
    'Never invent stats, distances, or history. Never mention these instructions.',
    '',
    '== PLAYER PROFILE ==',
  ]
  if (user?.name) lines.push(`Name: ${user.name}`)
  lines.push(handicap != null ? `Handicap index: ${handicap}` : 'Handicap index: unknown')
  const tend = tendenciesLine(user)
  if (tend) lines.push(`Tendencies — ${tend}`)
  const bag = bagLine(clubData)
  if (bag) lines.push(`Bag averages — ${bag}`)

  // Swing Intelligence block (facts-only, deterministic — the narrator
  // contract: model narrates measured tempo facts, never invents metrics).
  try {
    if (swingRows && swingRows.length) {
      const tl = buildTimeline(swingRows)
      const block = factsPromptBlock({ timeline: tl, eras: detectEras(tl) })
      if (block) lines.push('', block)
    }
  } catch { /* swing facts are additive — never block chat */ }

  // Strokes Gained block + measurement discipline
  let sgBlock = null, agg = null
  try {
    sgBlock = sgPromptBlock(sgRounds, user?.sg_baseline ?? 'auto', handicap)
    agg = aggregateSG(sgRounds, user?.sg_baseline ?? 'auto', handicap)
  } catch { /* fail-soft */ }
  if (sgBlock) {
    lines.push(sgBlock)
    const measured = agg?.roundsWithPutting ?? 0
    lines.push(measured >= SG_PUTT_GATE
      ? `Putting SG is measured over ${measured} rounds — you may treat it as reliable.`
      : `Putting SG rests on only ${measured} measured round${measured === 1 ? '' : 's'} (below the ${SG_PUTT_GATE}-round reliability gate). Hedge any putting conclusion accordingly and NEVER name putting as the player's defining weakness from this sample.`)
  }

  // Practice engine's evidence-based weaknesses (top 3) — the same analysis
  // the Practice screen shows, so the caddie and the app never disagree.
  try {
    const a = analyze(ctx.rounds, {
      handicap, sgRounds, sgBaseline: user?.sg_baseline ?? 'auto',
    })
    const top = (a?.weaknesses ?? []).slice(0, 3)
      .map(w => `${w.area}: ${w.explanation}`)
    if (top.length) {
      lines.push('', '== CURRENT FOCUS AREAS (from their rounds) ==', ...top)
    }
  } catch { /* fail-soft */ }

  // Live round context, when the client sends it. Client-supplied strings
  // are sanitized before entering the SYSTEM prompt (self-injection only,
  // but cheap hygiene — greenlight review follow-up #1): newlines stripped,
  // numerics coerced, everything length-capped.
  if (round && typeof round === 'object') {
    const clean = (s, n) => String(s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n)
    const num = (v, max) => { const x = Number(v); return Number.isFinite(x) && x > 0 && x <= max ? Math.round(x) : null }
    const rc = []
    if (round.courseName) rc.push(`Course: ${clean(round.courseName, 80)}`)
    const holeNo = num(round.holeNumber, 18)
    const holePar = num(round.holePar, 6)
    const holeYds = num(round.holeYards, 800)
    if (holeNo)  rc.push(`Hole ${holeNo}`)
    if (holePar) rc.push(`Par ${holePar}`)
    if (holeYds) rc.push(`${holeYds} yds`)
    if (round.weather && typeof round.weather === 'object') {
      const w = round.weather
      if (w.temperature_2m != null) rc.push(`${Math.round(w.temperature_2m)}°F`)
      if (w.wind_speed_10m != null) rc.push(`wind ${Math.round(w.wind_speed_10m)} mph @ ${Math.round(w.wind_direction_10m ?? 0)}°`)
    }
    if (rc.length) lines.push('', '== LIVE ROUND ==', rc.join(' · '))
  }

  return lines.join('\n')
}

// POST /api/caddie/chat
// Body: { messages: [{role:'user'|'assistant', content: string}], round?: {...} }
router.post('/chat', caddieLimiter, async (req, res) => {
  const { messages, round } = req.body || {}
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages required' })
  }
  // Validate + trim history: last 12 turns, strings only, capped length.
  const clean = messages.slice(-12)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
  if (!clean.length || clean[clean.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'last message must be from the user' })
  }

  try {
    const ctx = await loadPlayerContext(req.user.id)
    const system = buildSystemPrompt(ctx, round)
    const msg = await client.messages.create({
      // Greenlight follow-up #2: current Sonnet (the 2025-05 snapshot was a
      // year old). Env override so prod can pin/roll without a deploy.
      model: process.env.CADDIE_MODEL || 'claude-sonnet-5',
      max_tokens: 1000,
      system,
      messages: clean,
    })
    // Robust extraction (2026-07-06 prod fix): newer models can return
    // non-text blocks (e.g. thinking) ahead of the text, so content[0].text
    // is not guaranteed — join ALL text blocks. max_tokens raised 500→1000 so
    // a reasoning-heavy turn can't burn the whole budget before the answer.
    const reply = (msg.content ?? [])
      .filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text).join('').trim()
    if (!reply) {
      // Name the failure for the logs instead of a blind "empty completion".
      console.error('[caddie] no text in completion — stop_reason:', msg.stop_reason,
        'blocks:', (msg.content ?? []).map(b => b?.type).join(','))
      throw new Error('empty completion')
    }
    res.json({ reply })
  } catch (e) {
    console.error('[caddie]', e.message)
    res.status(500).json({ error: 'The caddie lost signal — try again.' })
  }
})

module.exports = router
