// Unit tests for the pure overlay geometry (range-rings + dispersion).
// Run via `npm --prefix client test` (node --test).
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectPoint, dispersionZonePolygon, arcBandPolygon, layupRingsInPlay, LAYUP_RING_YARDS } from './mapOverlays.js'
import { dispersionEllipse } from './clubModel.js'

const ORIGIN = { lat: 40.221, lon: -74.187 } // Pebble Creek-ish, NJ
const YD = 0.9144
// great-circle yards between two points (haversine, local copy for assertions)
function yds(a, b) {
  const R = 6371000
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180
  const dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x)) / YD
}

test('projectPoint round-trips distance', () => {
  const p = projectPoint(ORIGIN, 37, 230)
  assert.ok(Math.abs(yds(ORIGIN, p) - 230) < 0.5)
})

test('dispersion zone: short side extends MORE than long side (skew inward)', () => {
  const bearing = 0 // shot due north; landing zone around a point 200y out
  const landing = projectPoint(ORIGIN, bearing, 200)
  const ell = dispersionEllipse(200) // depth=width=10, shortSkew=1.3
  const ring = dispersionZonePolygon(landing, bearing, ell)
  // walk the ring; measure max extension toward the player (south) vs away (north)
  let maxShort = 0, maxLong = 0
  for (const [lon, lat] of ring) {
    const d = yds(landing, { lat, lon })
    if (lat < landing.lat) maxShort = Math.max(maxShort, d)
    else maxLong = Math.max(maxLong, d)
  }
  assert.ok(maxShort > maxLong, `short ${maxShort} must exceed long ${maxLong}`)
  assert.ok(Math.abs(maxShort - ell.depthYds * ell.shortSkew) < 1.5)
  assert.ok(Math.abs(maxLong - ell.depthYds) < 1.5)
})

test('dispersion zone ring is closed and sized sanely', () => {
  const ring = dispersionZonePolygon(ORIGIN, 90, dispersionEllipse(150))
  assert.deepEqual(ring[0], ring[ring.length - 1])
  assert.ok(ring.length >= 49)
})

test('arc band: inner radius reflects short skew, outer plain depth; ring closed', () => {
  const ell = dispersionEllipse(230) // depth 11.5, skew 1.3
  const ring = arcBandPolygon(ORIGIN, 0, 230, ell, 24)
  assert.deepEqual(ring[0], ring[ring.length - 1])
  const dists = ring.map(([lon, lat]) => yds(ORIGIN, { lat, lon }))
  const min = Math.min(...dists), max = Math.max(...dists)
  assert.ok(Math.abs(min - (230 - ell.depthYds * ell.shortSkew)) < 1.5, `inner ${min}`)
  assert.ok(Math.abs(max - (230 + ell.depthYds)) < 1.5, `outer ${max}`)
})

test('arc band floors inner radius at 1 (never inverts on tiny radii)', () => {
  const ring = arcBandPolygon(ORIGIN, 0, 5, { depthYds: 10, shortSkew: 1.3 })
  const dists = ring.map(([lon, lat]) => yds(ORIGIN, { lat, lon }))
  assert.ok(Math.min(...dists) >= 0.5)
})

test('layup rings filter to in-play only', () => {
  assert.deepEqual(layupRingsInPlay(435), [100, 150, 200, 250])
  assert.deepEqual(layupRingsInPlay(230), [100, 150, 200])
  assert.deepEqual(layupRingsInPlay(160), [100])
  assert.deepEqual(layupRingsInPlay(140), [100])
  assert.deepEqual(layupRingsInPlay(110), [])   // 100 not ≤ 110−15
  assert.deepEqual(layupRingsInPlay(null), [])
  assert.deepEqual(layupRingsInPlay(-5), [])
  assert.equal(LAYUP_RING_YARDS.length, 4)
})
