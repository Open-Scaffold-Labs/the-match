const router     = require('express').Router()
const Anthropic  = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')
const db         = require('../db')

const client = new Anthropic()

// POST /api/eagle-eye/analyze
router.post('/analyze', requireAuth, async (req, res) => {
  const { image, gps, weather, holeYardage, holePar, holeNumber, courseName } = req.body
  if (!image) return res.status(400).json({ error: 'image required' })

  const weatherCtx = weather ? [
    `Temperature: ${Math.round(weather.temperature_2m)}°F`,
    `Wind: ${Math.round(weather.wind_speed_10m)} mph at ${Math.round(weather.wind_direction_10m)}°`,
    `Humidity: ${weather.relative_humidity_2m}%`,
    `Pressure: ${Math.round(weather.surface_pressure)} hPa`,
  ].join(', ') : 'Weather unavailable'

  const altFt = gps?.alt != null
    ? Math.round(gps.alt * 3.281)
    : estimateAltFromPressure(weather?.surface_pressure)

  // When real hole yardage is available from the course database, use it as the
  // authoritative tee distance. Otherwise ask Claude to estimate from the image.
  const hasRealYardage = holeYardage != null && holeYardage > 0
  const gpsYardsInstruction = hasRealYardage
    ? `The tee distance for this hole is exactly ${holeYardage} yards (from the course database). Use ${holeYardage} as "gpsYards". Do NOT estimate distance from the image — the yardage is known. Focus on reading the slope from the image and applying wind/temp/altitude adjustments.`
    : `GPS distance is unavailable. Estimate the distance to the flag (or green center if flag not visible) from the image and use that as "gpsYards".`

  const holeCtx = hasRealYardage
    ? [
        courseName ? `Course: ${courseName}` : null,
        holeNumber ? `Hole: ${holeNumber}` : null,
        holePar ? `Par ${holePar}` : null,
        `Tee yardage: ${holeYardage} yards`,
      ].filter(Boolean).join(' · ')
    : null

  const system = `You are Eagle Eye, an expert AI golf caddie and rangefinder.
Analyze the image and return ONLY valid JSON with this exact shape — no markdown, no prose:
{
  "gpsYards": <number — authoritative tee distance if provided, else visual estimate>,
  "playsLikeYards": <adjusted distance>,
  "adjustments": {
    "slopeYards": <positive = uphill, negative = downhill>,
    "windYards": <positive = into wind, negative = downwind>,
    "tempYards": <negative yds per 10F below 70F per 100yds>,
    "altitudeYards": <negative = altitude bonus, ball flies farther>,
    "totalAdjust": <sum>
  },
  "confidence": "high" | "medium" | "low",
  "flagVisible": <boolean>,
  "terrainNote": "<one sentence>",
  "recommendedClub": "<e.g. 7i>",
  "alternateClub": "<e.g. 6i>",
  "shotShape": "<e.g. straight, slight draw, fade>",
  "caddieNote": "<1-2 sentences of caddie advice>"
}
${gpsYardsInstruction}
Adjustments: wind ~1yd/mph per 100yds; temp -1yd per 10F below 70F per 100yds; altitude -2% per 1000ft (ball flies farther, so subtract from plays-like).`

  const userText = [
    holeCtx,
    gps ? `GPS coords: ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}` : 'GPS unavailable',
    `Altitude: ~${altFt} ft`,
    weatherCtx,
    'Analyze the image and return the JSON.',
  ].filter(Boolean).join('\n')

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: userText },
        ],
      }],
    })

    const raw = msg.content[0]?.text?.trim()
    const json = JSON.parse(raw.replace(/^```json?\n?/, '').replace(/\n?```$/, ''))
    res.json(json)
  } catch (e) {
    console.error('[eagle-eye]', e.message)
    res.status(500).json({ error: 'Analysis failed: ' + e.message })
  }
})

function estimateAltFromPressure(hPa) {
  if (!hPa) return 0
  return Math.round(44330 * (1 - Math.pow(hPa / 1013.25, 1 / 5.255)) * 3.281)
}

// GET /api/eagle-eye/osm?bbox=south,west,north,east
// Proxy for Overpass API — browser can't call overpass-api.de directly (CORS/CSP)

// Two-tier cache so the public Overpass API is hit at most once per
// (course, bbox), per its usage policy:
//   L1 — in-memory Map, 60 min. Instant within a warm Vercel instance, but
//        wiped on every cold start (which is why L2 exists).
//   L2 — Supabase tm_osm_cache (migration 028). Durable across cold starts;
//        a (osm_type, bbox) row is written once after the first Overpass
//        fetch and reused for OSM_DB_TTL_MS. Course geometry is essentially
//        static, so the TTL is long; a stale row is still served if every
//        Overpass mirror is down (better stale geometry than none).
const overpassCache = new Map()
const OVERPASS_CACHE_TTL = 60 * 60 * 1000
const OSM_DB_TTL_MS = 90 * 24 * 60 * 60 * 1000

// Mirror order matters: a hung mirror at the front of the list delays
// every fallback behind it. lz4 (CDN-fronted main instance) has been the
// most reliable in testing; overpass.kumi.systems was repeatedly the
// slow/timing-out one, so it's demoted to last. (Reordered 2026-06-06
// after reproducing the dead kumi mirror live — kumi unreachable/timed out
// while lz4 + main both answered in ~0.6s.)
const OVERPASS_MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
// Per-mirror client timeout. The Overpass [timeout:N] directive only
// bounds query *execution* server-side — it does nothing for a mirror
// that's slow to accept the connection or stream a response. Without a
// client abort, one stalled mirror could hold the request open until the
// 60s function limit, blocking the fallback to a healthy mirror. (2026-06-06)
const MIRROR_TIMEOUT_MS = 10000
router.get('/osm', async (req, res) => {
  try {
    const { bbox, type } = req.query
    if (!bbox) return res.status(400).json({ error: 'bbox required' })

    // Allowlist the query kind up front — `osmType` is used only as a map key
    // (never interpolated into the Overpass QL), so it can't inject. Unknown
    // type → holes. Resolving it here keeps the cache key + DB key consistent
    // with the query actually run. (2026-06-06; hardened 2026-06-24)
    const osmType = ['holes', 'teegreen', 'greengeom'].includes(type) ? type : 'holes'
    const cacheKey = `${osmType}|${bbox}`

    // L1 — in-memory (instant within a warm Vercel instance)
    const hit = overpassCache.get(cacheKey)
    if (hit && Date.now() - hit.ts < OVERPASS_CACHE_TTL) {
      return res.json(hit.data)
    }

    // L2 — durable Supabase cache. Survives cold starts, so the public
    // Overpass API is hit at most once per (osm_type, bbox). Wrapped so a DB
    // hiccup degrades to a live Overpass fetch rather than failing the request.
    let staleRow = null
    try {
      const row = await db.one(
        'SELECT data, fetched_at FROM tm_osm_cache WHERE osm_type = $1 AND bbox = $2',
        [osmType, bbox]
      )
      if (row) {
        const age = Date.now() - new Date(row.fetched_at).getTime()
        if (age < OSM_DB_TTL_MS) {
          overpassCache.set(cacheKey, { data: row.data, ts: Date.now() })
          return res.json(row.data)
        }
        staleRow = row   // expired, but a usable last-resort if Overpass is down
      }
    } catch (e) {
      console.error('[eagle-eye/osm] L2 cache read failed:', e.message)
    }

    // L3 — live Overpass. On success we persist to L1 + L2 so this is the
    // only time this (osm_type, bbox) ever touches the public API.
    // 'holes'     = golf=hole ways (primary, authoritative) — out geom
    // 'teegreen'  = individual tee/green nodes/ways (gap-fill) — out center
    // 'greengeom' = golf=green polygons for Front/Center/Back distances — out geom
    const queries = {
      teegreen:  `[out:json][timeout:25];(node["golf"="tee"](${bbox});way["golf"="tee"](${bbox});node["golf"="green"](${bbox});way["golf"="green"](${bbox}););out center;`,
      greengeom: `[out:json][timeout:20];(way["golf"="green"](${bbox}););out geom;`,
      holes:     `[out:json][timeout:15];(way["golf"="hole"](${bbox}););out geom;`,
    }
    const query = queries[osmType]
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'TheMatchApp/1.0 (golf companion; contact@thegolfmatch.app)',
    }
    const body = 'data=' + encodeURIComponent(query)
    let lastErr = null
    for (const mirror of OVERPASS_MIRRORS) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), MIRROR_TIMEOUT_MS)
      try {
        const response = await fetch(mirror, { method: 'POST', headers, body, signal: ac.signal })
        if (!response.ok) { lastErr = `${mirror} → ${response.status}`; continue }
        const data = await response.json()
        overpassCache.set(cacheKey, { data, ts: Date.now() })
        // Persist durably (fire-and-forget — a write failure must never break
        // the response the client is waiting on).
        db.query(
          `INSERT INTO tm_osm_cache (osm_type, bbox, data, fetched_at)
             VALUES ($1, $2, $3, now())
           ON CONFLICT (osm_type, bbox)
             DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
          [osmType, bbox, data]
        ).catch(e => console.error('[eagle-eye/osm] L2 cache write failed:', e.message))
        return res.json(data)
      } catch (e) {
        lastErr = `${mirror} → ${e.name === 'AbortError' ? `timeout after ${MIRROR_TIMEOUT_MS}ms` : e.message}`
        continue
      } finally {
        clearTimeout(timer)
      }
    }
    // Every mirror failed. Serve stale geometry if we have any — course
    // geometry rarely changes, so an expired row beats a hard error.
    if (staleRow) {
      console.warn('[eagle-eye/osm] all mirrors failed; serving stale L2 cache for', cacheKey)
      overpassCache.set(cacheKey, { data: staleRow.data, ts: Date.now() })
      return res.json(staleRow.data)
    }
    console.error('[eagle-eye/osm] all mirrors failed:', lastErr)
    res.status(502).json({ error: 'OSM unavailable: ' + lastErr })
  } catch (err) {
    console.error('[eagle-eye/osm]', err.message)
    res.status(500).json({ error: 'OSM fetch failed: ' + err.message })
  }
})

module.exports = router
