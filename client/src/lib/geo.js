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
// Wind + air-density act on ONE carry's worth of flight time, not on a whole-
// hole distance — and flight time stops growing past full-swing apex (Trackman:
// apex ~30-32y for every club), so a driver loses fewer % than a wedge. Cap the
// distance those %-terms scale on at a single-carry ceiling so a long-hole
// number can't balloon them (250y sits under tour driver carry ~282y, above
// most amateur carries → approach shots ≤250 are unchanged). Elevation is
// geometry to the target, so it is NOT capped. (research 2026-06-30)
const PLAYSLIKE_CARRY_CEILING = 250              // yards

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

  // Wind + air density act on a single carry, not the full (possibly whole-hole)
  // distance. Cap the distance they scale on so long holes can't balloon them
  // (≤250 ⇒ no change; a real aim/approach shot passes its own distance in).
  const flightYds = Math.min(baseYds, PLAYSLIKE_CARRY_CEILING)

  // Wind — asymmetric; only the along-shot (cosine) component changes distance.
  let wind = 0
  if (windSpeed && windFromDeg != null && shotBearing != null) {
    const along = windSpeed * Math.cos(((shotBearing - windFromDeg) * Math.PI) / 180) // + head, − tail
    let pct = along >= 0 ? 0.010 * along : 0.005 * along                              // 1%/mph head, 0.5%/mph tail
    pct = Math.max(-0.30, Math.min(0.40, pct))                                        // sane caps
    wind = pct * flightYds
  }

  // Temperature — air density vs a 70°F baseline; colder plays longer.
  let temp = tempF != null ? ((70 - tempF) / 10) * 0.008 * flightYds : 0
  temp = Math.max(-0.10 * flightYds, Math.min(0.10 * flightYds, temp))

  // Altitude (ASL) — thinner air, ball flies farther, plays shorter.
  let alt = -((altFt || 0) / 1000) * 0.0116 * flightYds
  alt = Math.max(-0.15 * flightYds, Math.min(0.15 * flightYds, alt))

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

// Assign each hole a tee for courses that OSM maps WITHOUT golf=hole ways and
// WITHOUT ref-tagged tee nodes (e.g. Beacon Hill CC — 45 unlabeled tee nodes,
// zero hole numbers). Greens are recovered first (matchGreensToHoles); this
// then picks, per hole, the UNUSED tee whose distance to that hole's green best
// matches the scorecard yardage — so the tee lands the right distance in the
// right direction. That's enough for the tee marker and the straight tee→green
// hole line to draw (HoleMapGL already falls back to a straight line when it
// has no golf=hole geometry). Mirrors matchGreensToHoles' most-distinctive-
// -yardage-first ordering to reduce cascading mis-assignments. `greensByHole`
// = { [holeNum]: {lat,lon} }; `scorecard` = [{ hole, yardage }]. Returns
// { [holeNum]: {lat,lon} }. (2026-07-09)
export function matchTeesToHoles(tees, greensByHole, scorecard, maxDiffYards = 60) {
  const assigned = {}
  if (!Array.isArray(tees) || !tees.length || !Array.isArray(scorecard) || !scorecard.length) return assigned
  const used = new Set()
  const yards = scorecard.map(h => h.yardage).filter(y => y != null).sort((a, b) => a - b)
  const medY = yards.length ? yards[Math.floor(yards.length / 2)] : 0
  const order = [...scorecard].sort((a, b) => Math.abs((b.yardage ?? 0) - medY) - Math.abs((a.yardage ?? 0) - medY))
  for (const hole of order) {
    const green = greensByHole?.[hole.hole]
    if (!green || hole.yardage == null) continue
    let bestIdx = -1, bestDiff = Infinity
    for (let i = 0; i < tees.length; i++) {
      if (used.has(i)) continue
      const d = haversineYards(tees[i], green)
      if (d == null) continue
      const diff = Math.abs(d - hole.yardage)
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    }
    if (bestIdx >= 0 && bestDiff <= maxDiffYards) {
      assigned[hole.hole] = tees[bestIdx]
      used.add(bestIdx)
    }
  }
  return assigned
}

// Ray-cast (even-odd) point-in-polygon test. `pt` = {lat,lon}; `polygon` =
// [{lat,lon}, ...]. Treats lat/lon as planar — fine at green scale (~30 yds),
// where curvature is negligible. Returns false for a degenerate polygon
// (<3 vertices) or non-finite input. Used for on-green detection (Slice 3).
export function pointInPolygon(pt, polygon) {
  if (!pt || !Array.isArray(polygon) || polygon.length < 3) return false
  const x = Number(pt.lon), y = Number(pt.lat)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.lon), yi = Number(polygon[i]?.lat)
    const xj = Number(polygon[j]?.lon), yj = Number(polygon[j]?.lat)
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}


// ── Slice 4: confidence-gated auto-lie (fairway / bunker) ──────────────────
// Classify the surface a player stands on from their GPS fix vs OSM course
// polygons, with a confidence tier so we NEVER silently record a wrong lie
// (a wrong lie — especially SAND — corrupts strokes-gained). See
// wiki/synthesis/eagle-eye-walk-and-confirm-progress-2026-07-07 §Slice 4.
export const LIE_SAND_ACC_MAX = 5   // m — sand needs a tight fix to auto-fill
export const LIE_GEN_ACC_MAX  = 8   // m — fairway/general auto-fill ceiling
export const LIE_MARGIN_FLOOR = 5   // m — absolute min distance INSIDE a boundary

function _metersPerDeg(latDeg) {
  return { mLat: 111320, mLon: 111320 * Math.cos((latDeg * Math.PI) / 180) }
}

// Distance (m) from point (px,py) to segment (ax,ay)-(bx,by), planar metres.
function _distPointToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Minimum distance (metres) from `pt` to the nearest EDGE of `polygon`
// ([{lat,lon}]). Local equirectangular projection centred on pt — sub-metre
// accurate at golf-hole scale. This is the confidence "margin": how far INSIDE
// a boundary a fix sits (only meaningful when pt is inside). Returns null for a
// degenerate polygon or non-finite input. (Slice 4)
export function distanceToPolygonEdgeMeters(pt, polygon) {
  if (!pt || !Array.isArray(polygon) || polygon.length < 3) return null
  const plat = Number(pt.lat), plon = Number(pt.lon)
  if (!Number.isFinite(plat) || !Number.isFinite(plon)) return null
  const { mLat, mLon } = _metersPerDeg(plat)
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = (Number(polygon[i]?.lon) - plon) * mLon, yi = (Number(polygon[i]?.lat) - plat) * mLat
    const xj = (Number(polygon[j]?.lon) - plon) * mLon, yj = (Number(polygon[j]?.lat) - plat) * mLat
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue
    const d = _distPointToSeg(0, 0, xi, yi, xj, yj)
    if (d < best) best = d
  }
  return Number.isFinite(best) ? best : null
}

// Returns { inside, confidence, marginM } for the first polygon in `polys`
// that contains pt. HIGH only when the fix is tight (accM ≤ accMax) AND sits a
// margin of ≥ max(FLOOR, 2·accM) inside the edge — so a jittery fix, or a
// bunker smaller than the error, can never auto-fill. (Slice 4)
function _firstContaining(pt, polys, accM, accMax) {
  for (const poly of (polys || [])) {
    if (!pointInPolygon(pt, poly)) continue
    const marginM = distanceToPolygonEdgeMeters(pt, poly)
    const need = Math.max(LIE_MARGIN_FLOOR, 2 * (accM == null ? Infinity : accM))
    const high = accM != null && accM <= accMax && marginM != null && marginM >= need
    return { inside: true, confidence: high ? 'high' : 'medium', marginM }
  }
  return { inside: false, confidence: 'none', marginM: null }
}

// classifyLie(pt, { fairwayPolys, bunkerPolys, accM }) →
//   { lie: 'sand'|'fairway'|'rough'|null, confidence: 'high'|'medium'|'low'|'none', marginM }
// Priority sand > fairway > rough-default. `accM` = GPS horizontal accuracy (m).
// No polygons at all → { lie:null, confidence:'none' } so the caller keeps
// today's behaviour (graceful degradation is the COMMON case). Never returns a
// lie the caller should silently commit — 'high' pre-selects, 'medium' merely
// suggests; the player always confirms in the sheet. (Slice 4)
export function classifyLie(pt, { fairwayPolys = [], bunkerPolys = [], accM = null } = {}) {
  if (!pt || !Number.isFinite(Number(pt.lat)) || !Number.isFinite(Number(pt.lon))) {
    return { lie: null, confidence: 'none', marginM: null }
  }
  const fw = Array.isArray(fairwayPolys) ? fairwayPolys : []
  const bk = Array.isArray(bunkerPolys) ? bunkerPolys : []
  if (fw.length === 0 && bk.length === 0) return { lie: null, confidence: 'none', marginM: null }

  // 1) SAND — highest priority (a bunker cut into a fairway must win).
  const sand = _firstContaining(pt, bk, accM, LIE_SAND_ACC_MAX)
  if (sand.inside) return { lie: 'sand', confidence: sand.confidence, marginM: sand.marginM }

  // 2) FAIRWAY.
  const fair = _firstContaining(pt, fw, accM, LIE_GEN_ACC_MAX)
  if (fair.inside) return { lie: 'fairway', confidence: fair.confidence, marginM: fair.marginM }

  // 3) ROUGH — inferable only when fairway coverage EXISTS (absence is then
  //    meaningful). Fuzzy edges → a suggestion, never an auto-fill.
  if (fw.length > 0) return { lie: 'rough', confidence: 'medium', marginM: null }

  return { lie: null, confidence: 'none', marginM: null }
}