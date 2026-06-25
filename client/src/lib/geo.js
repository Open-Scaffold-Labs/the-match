// Pure geometry/distance helpers for Eagle Eye — extracted so they can be
// unit-tested in Node without a browser, GPS, or Leaflet. No DOM, no I/O.
//
// haversineYards / calcBearing / computePlaysLike mirror the implementations
// inside EagleEye.jsx exactly (kept in sync intentionally); greenFCB,
// polygonCentroid, and matchPolygonToHole are new, for Front/Center/Back
// green distances built on OSM green polygons. (2026-06-06)

// Great-circle distance in yards. Returns null on bad input.
export function haversineYards(a, b) {
  if (!a || !b) return null
  const R = 6371000 // metres
  const f1 = a.lat * Math.PI / 180, f2 = b.lat * Math.PI / 180
  const df = (b.lat - a.lat) * Math.PI / 180
  const dl = (b.lon - a.lon) * Math.PI / 180
  const x = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2
  return Math.round(2 * Math.asin(Math.sqrt(x)) * R * 1.09361)
}

// Bearing in degrees from `from` to `to` (0 = N, 90 = E, 180 = S, 270 = W).
export function calcBearing(from, to) {
  if (!from || !to) return null
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const dLon = (to.lon - from.lon) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// Yards of plays-like adjustment per foot of shot elevation change (target vs
// ball). ~1 yd per 3 ft is the common conservative caddie rule; deliberately
// modest and TUNABLE against on-course truth. We never advertise a precision
// figure (see the build plan's marketing stance). (3.1, 2026-06-25)
export const PLAYSLIKE_K_ELEV = 1 / 3

// Wind/temp/altitude/elevation "plays like" model. Headwind + cold + low
// altitude-above-sea-level + uphill all play LONGER. Two distinct altitude
// effects, NOT double-counted: `altFt` = absolute height ASL (air density);
// `elevDeltaFt` = target-minus-ball elevation delta (uphill/downhill ball
// flight). Returns { plays, adj } (rounded, unchanged for existing callers)
// plus { base, factors:{wind,temp,alt,elevation} } as PRECISE floats so the
// transparency UI can apportion/round them itself without drift. Mirrors the
// copy in EagleEye.jsx exactly — edit BOTH. (elevation term added 3.1 2026-06-25)
export function computePlaysLike(baseYds, { windSpeed = 0, windFromDeg = null, shotBearing = null, tempF = null, altFt = 0, elevDeltaFt = null } = {}) {
  if (!baseYds || baseYds <= 0) return { plays: baseYds, adj: 0, base: baseYds || 0, factors: { wind: 0, temp: 0, alt: 0, elevation: 0 } }
  const per100 = baseYds / 100
  let wind = 0
  if (windSpeed && windFromDeg != null && shotBearing != null) {
    const theta = ((shotBearing - windFromDeg) * Math.PI) / 180
    wind = windSpeed * Math.cos(theta) * per100 // +headwind longer, -tailwind shorter
  }
  const temp = tempF != null ? ((70 - tempF) / 10) * per100 : 0 // colder plays longer
  const alt = -baseYds * ((altFt || 0) / 1000) * 0.02            // ASL air density: altitude plays shorter
  const elevation = elevDeltaFt != null ? elevDeltaFt * PLAYSLIKE_K_ELEV : 0 // uphill (+) plays longer
  const adj = wind + temp + alt + elevation
  return {
    plays: Math.max(0, Math.round(baseYds + adj)),
    adj: Math.round(adj),
    base: Math.round(baseYds),
    factors: { wind, temp, alt, elevation }, // precise floats — UI rounds/apportions
  }
}

// Estimate altitude (feet) from barometric surface pressure (hPa), standard
// barometric formula. Fallback for the plays-like altitude term when GPS gives
// no altitude. Mirrors the server analyze route exactly. (2026-06-06)
export function estimateAltFromPressure(hPa) {
  if (!hPa) return 0
  return Math.round(44330 * (1 - Math.pow(hPa / 1013.25, 1 / 5.255)) * 3.281)
}

// Average-of-vertices centroid for a polygon ([{lat,lon}, ...]). Good enough
// for nearest-green association; not an area-weighted centroid. Returns null
// for an empty polygon.
export function polygonCentroid(poly) {
  if (!Array.isArray(poly) || poly.length === 0) return null
  let lat = 0, lon = 0
  for (const p of poly) { lat += p.lat; lon += p.lon }
  return { lat: lat / poly.length, lon: lon / poly.length }
}

// Front / Center / Back green distances (yards) from `player` to a green
// polygon. front = nearest vertex, back = farthest vertex, center = the
// known green-center point (centroid). Returns null when inputs can't
// support a real reading (so the caller falls back to a single number).
// NOTE: nearest/farthest-vertex is a deliberate v1 approximation; when the
// player is well off to the side it is not the true line-of-play front/back.
export function greenFCB(player, polygon, centerPt) {
  if (!player || !Array.isArray(polygon) || polygon.length < 3 || !centerPt) return null
  let front = Infinity, back = -Infinity
  for (const v of polygon) {
    const d = haversineYards(player, v)
    if (d == null) continue
    if (d < front) front = d
    if (d > back) back = d
  }
  if (!Number.isFinite(front) || !Number.isFinite(back)) return null
  const center = haversineYards(player, centerPt)
  return { front, center, back }
}

// Associate each hole's green-center point with the OSM green polygon whose
// centroid is nearest, within `thresholdYards`. Prevents a stray practice
// green (the counts exceed 18) from being assigned to a hole. Returns
// { [holeNum]: polygon }.
export function matchPolygonsToHoles(greenCentersByHole, polygons, thresholdYards = 40) {
  const out = {}
  const centroids = polygons.map(poly => ({ poly, c: polygonCentroid(poly) })).filter(x => x.c)
  for (const [holeStr, center] of Object.entries(greenCentersByHole || {})) {
    if (!center) continue
    let best = null, bestD = Infinity
    for (const { poly, c } of centroids) {
      const d = haversineYards(center, c)
      if (d != null && d < bestD) { bestD = d; best = poly }
    }
    if (best && bestD <= thresholdYards) out[holeStr] = best
  }
  return out
}
