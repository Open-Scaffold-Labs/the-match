const router     = require('express').Router()
const Anthropic  = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')

const client = new Anthropic()

// POST /api/eagle-eye/analyze
router.post('/analyze', requireAuth, async (req, res) => {
  const { image, gps, weather } = req.body
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

  const system = `You are Eagle Eye, an expert AI golf caddie and rangefinder.
Analyze the image and return ONLY valid JSON with this exact shape — no markdown, no prose:
{
  "gpsYards": <number — GPS distance if provided, else estimate from image>,
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
Adjustments: wind ~1yd/mph per 100yds; temp -1yd per 10F below 70F per 100yds; altitude -2% per 1000ft (ball flies farther, so subtract from plays-like).`

  const userText = [
    gps ? `GPS coords: ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}` : 'GPS unavailable',
    `Altitude: ~${altFt} ft`,
    weatherCtx,
    'Analyze the image and return the JSON.',
  ].join('\n')

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

module.exports = router
