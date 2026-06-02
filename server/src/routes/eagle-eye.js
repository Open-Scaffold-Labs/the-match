const router     = require('express').Router()
const Anthropic  = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')

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

// Server-side in-memory cache — Overpass responses cached for 60 min.
// Within a warm Vercel instance this makes repeat fetches (same course, same session)
// instant without hitting the Overpass mirrors again.
const overpassCache = new Map()
const OVERPASS_CACHE_TTL = 60 * 60 * 1000

// Mirror order matters: a hung mirror at the front of the list delays
// every fallback behind it. lz4 (CDN-fronted main instance) has been the
// most reliable in testing; overpass.kumi.systems was repeatedly the
// slow/timing-out one, so it's demoted to last. (Reordered 2026-06-01
// after reproducing East Orange GC fetches — kumi-first timed out
// repeatedly while lz4 answered.)
const OVERPASS_MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
// Per-mirror client timeout. The Overpass [timeout:N] directive only
// bounds query *execution* server-side — it does nothing for a mirror
// that's slow to accept the connection or stream a response. Without a
// client abort, one stalled mirror could hold the request open until the
// 60s function limit, blocking the fallback to a healthy mirror. (2026-06-01)
const MIRROR_TIMEOUT_MS = 10000
router.get('/osm', async (req, res) => {
  try {
    const { bbox, type } = req.query
    if (!bbox) return res.status(400).json({ error: 'bbox required' })

    const cacheKey = `${type}|${bbox}`
    const hit = overpassCache.get(cacheKey)
    if (hit && Date.now() - hit.ts < OVERPASS_CACHE_TTL) {
      return res.json(hit.data)
    }

    // 'holes' = fast path: only golf=hole ways (primary, authoritative)
    // 'teegreen' = gap-fill: individual tee/green nodes
    const query = type === 'teegreen'
      ? `[out:json][timeout:25];(node["golf"="tee"](${bbox});way["golf"="tee"](${bbox});node["golf"="green"](${bbox});way["golf"="green"](${bbox}););out center;`
      : `[out:json][timeout:15];(way["golf"="hole"](${bbox}););out geom;`
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
        return res.json(data)
      } catch (e) {
        lastErr = `${mirror} → ${e.name === 'AbortError' ? `timeout after ${MIRROR_TIMEOUT_MS}ms` : e.message}`
        continue
      } finally {
        clearTimeout(timer)
      }
    }
    console.error('[eagle-eye/osm] all mirrors failed:', lastErr)
    res.status(502).json({ error: 'OSM unavailable: ' + lastErr })
  } catch (err) {
    console.error('[eagle-eye/osm]', err.message)
    res.status(500).json({ error: 'OSM fetch failed: ' + err.message })
  }
})

module.exports = router
