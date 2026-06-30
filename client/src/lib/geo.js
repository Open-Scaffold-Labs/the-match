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

// Elevation "plays-like": uphill plays longer, downhill shorter — but NOT
// symmetric. Uphill ≈ 1 yd per 3 ft (0.33 yd/ft, the standard caddie rule,
// Trackman-consistent); downhill gives back only ~⅔ of that (you lose less
// going down than you gain going up). We never advertise a precision figure
// (marketing stance). (rebuilt 2026-06-30)
export const PLAYSLIKE_K_ELEV = 1 / 3            // uphill yards per foot
const PLAYSLIKE_DOWNHILL_FACTOR = 0.67           // downhill yields ~⅔ of uphill

// Wind / temperature / altitude / elevation "plays like" model. Sourced,
// physically-defensible coefficients — see
// wiki/synthesis/playslike-accuracy-rebuild-2026-06-30.md:
//   • Wind ASYMMETRIC: headwind +1.0%/mph, tailwind −0.5%/mph (~2:1, Trackman).
//     Only the along-shot (cosine) component changes distance; crosswind is an
//     aim cue, not a distance change.
//   • Temp: ~0.8%/10°F vs a 70°F baseline (air density; colder → longer).
//   • Altitude (ASL): ~1.16%/1000 ft (Titleist R&D; thinner air → shorter).
//   • Elevation: geometric yards (above), kept SEPARATE from altitude (two
//     distinct effects, not double-counted).
// Per-channel caps stop a bad sensor reading producing an absurd number.
// Additive by design so the transparency UI's four factors sum to the total.
// Mirrors the copy in EagleEye.jsx EXACTLY — edit BOTH. `altFt` = absolute
// height ASL; `elevDeltaFt` = target-minus-ball delta. Returns rounded
// plays/adj/base + precise factor floats for the UI.
export function computePlaysLike(baseYds, { windSpeed = 0, windFromDeg = null, shotBearing = null, tempF = null, altFt = 0, elevDeltaFt = null } = {}) {
  if (!baseYds || baseYds <= 0) return { plays: baseYds, adj: 0, base: baseYds || 0, factors: { wind: 0, temp: 0, alt: 0, elevation: 0 } }

  // Wind — asymmetric; only the along-shot (cosine) component changes distance.
  let wind = 0
  if (windSpeed && windFromDeg != null && shotBearing != null) {
    const along = windSpeed * Math.cos(((shotBearing - windFromDeg) * Math.PI) / 180) // + head, − tail
    let pct = along >= 0 ? 0.010 * along : 0.005 * along                              // 1%/mph head, 0.5%/mph tail
    pct = Math.max(-0.30, Math.min(0.40, pct))                                        // sane caps
    wind = pct * baseYds
  }

  // Temperature — air density vs a 70°F baseline; colder plays longer.
  let temp = tempF != null ? ((70 - tempF) / 10) * 0.008 * baseYds : 0
  temp = Math.max(-0.10 * baseYds, Math.min(0.10 * baseYds, temp))

  // Altitude (ASL) — thinner air, ball flies farther, plays shorter.
  let alt = -((altFt || 0) / 1000) * 0.0116 * baseYds
  alt = Math.max(-0.15 * baseYds, Math.min(0.15 * baseYds, alt))

  // Elevation — geometric; uphill full, downhill ~⅔.
  let elevation = 0
  if (elevDeltaFt != null) {
    elevation = elevDeltaFt >= 0
      ? elevDeltaFt * PLAYSLIKE_K_ELEV
      : elevDeltaFt * PLAYSLIKE_K_ELEV * PLAYSLIKE_DOWNHILL_FACTOR
    elevation = Math.max(-40, Math.min(40, elevation))
  }

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
