// Pure map-overlay geometry for Eagle Eye accuracy visuals (range-rings +
// dispersion zones/bands). No DOM/IO — unit-tests in Node. Additive: does NOT
// touch geo.js or any HoleMapGL distance math.
//
// HONESTY CONTRACT (own-club-arcs-3.3 spec, risk A1/A4; reaffirmed 2026-07-02):
// these shapes are ZONES from a labelled model estimate (1 SD ≈ 5% of distance,
// short-skewed), never precise boundaries. The renderer must draw them soft
// (feathered, low opacity) and never print a dispersion figure.

// Project a point `yards` along `bearingDeg` from {lat,lon} (great-circle).
// Pure copy of the proven HoleMapGL-local helper so this module stays DOM-free.
export function projectPoint(start, bearingDeg, yards) {
  const R = 6371000, d = (yards * 0.9144) / R, br = bearingDeg * Math.PI / 180
  const lat1 = start.lat * Math.PI / 180, lon1 = start.lon * Math.PI / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI }
}

// Dispersion ZONE around a landing point: an ellipse with its depth axis along
// the shot line. Amateurs miss SHORT more than long, so the short half (back
// toward the player, bearing+180) uses depth × shortSkew and the long half uses
// plain depth. Returns a closed [[lon,lat],…] ring (n+1 points).
export function dispersionZonePolygon(landing, bearingDeg, { depthYds, widthYds, shortSkew = 1 }, n = 48) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI
    // local ellipse coords: +x = along shot (long side), −x = short side
    const along = Math.cos(t), across = Math.sin(t)
    const depth = along >= 0 ? depthYds : depthYds * shortSkew
    const dy = along * depth          // yards along the shot line (signed)
    const dx = across * widthYds      // yards across the line (signed)
    const dist = Math.hypot(dx, dy)
    const ang = bearingDeg + (Math.atan2(dx, dy) * 180) / Math.PI
    const p = dist > 0 ? projectPoint(landing, ang, dist) : landing
    out.push([p.lon, p.lat])
  }
  return out
}

// Annular dispersion BAND for a distance arc: the sector between
// radius − depth×shortSkew (inner — misses are mostly short) and
// radius + depth (outer), swept ±halfDeg around bearingDeg from `center`.
// Returns a closed [[lon,lat],…] ring.
export function arcBandPolygon(center, bearingDeg, radiusYds, { depthYds, shortSkew = 1 }, halfDeg = 24, n = 28) {
  const inner = Math.max(1, radiusYds - depthYds * shortSkew)
  const outer = radiusYds + depthYds
  const out = []
  for (let i = 0; i <= n; i++) {           // outer edge, left → right
    const b = bearingDeg - halfDeg + (2 * halfDeg) * (i / n)
    const p = projectPoint(center, b, outer)
    out.push([p.lon, p.lat])
  }
  for (let i = n; i >= 0; i--) {           // inner edge, right → left
    const b = bearingDeg - halfDeg + (2 * halfDeg) * (i / n)
    const p = projectPoint(center, b, inner)
    out.push([p.lon, p.lat])
  }
  out.push(out[0])
  return out
}

// Layup rings that are actually IN PLAY: standard green-relative layup
// distances (the market-validated semantic — "what do I leave myself?"),
// filtered to those meaningfully between the player and the green.
export const LAYUP_RING_YARDS = [100, 150, 200, 250]
export function layupRingsInPlay(distToGreenYds, margin = 15) {
  const d = Number(distToGreenYds)
  if (!Number.isFinite(d) || d <= 0) return []
  return LAYUP_RING_YARDS.filter(r => r <= d - margin)
}
