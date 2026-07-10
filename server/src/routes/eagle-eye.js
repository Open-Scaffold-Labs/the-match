const router     = require('express').Router()
const requireAuth = require('../middleware/auth')
const db         = require('../db')



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
// Upper bound on how long we wait for the durable L2 write before responding.
// The write is awaited (not fire-and-forget) so it can't be dropped when the
// Vercel function freezes after res.json(); this cap ensures a hung DB can
// never stall the client — a normal INSERT is well under this. (2026-07-09)
const OSM_WRITE_MAX_WAIT_MS = 3000

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
    // bbox is interpolated into the Overpass QL, so hard-validate its shape:
    // exactly four comma-separated numbers (south,west,north,east). Anything
    // else can't be a real bbox and must never reach the query string. (Slice 4)
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(bbox)) {
      return res.status(400).json({ error: 'bbox must be south,west,north,east numbers' })
    }

    // Allowlist the query kind up front — `osmType` is used only as a map key
    // (never interpolated into the Overpass QL), so it can't inject. Unknown
    // type → holes. Resolving it here keeps the cache key + DB key consistent
    // with the query actually run. (2026-06-06; hardened 2026-06-24)
    const osmType = ['holes', 'teegreen', 'greengeom', 'surfaces', 'nearby'].includes(type) ? type : 'holes'
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
    // 'surfaces'  = golf=fairway + golf=bunker polygons (ways + multipolygon
    //               relations) for Slice-4 confidence-gated auto-lie — out geom
    // 'nearby'    = leisure=golf_course names+centers for the course picker's
    //               instant nearby list (2026-07-10, Play funnel) — out center.
    //               Client snaps the bbox to a 0.1° grid so cells cache-hit.
    const queries = {
      teegreen:  `[out:json][timeout:25];(node["golf"="tee"](${bbox});way["golf"="tee"](${bbox});node["golf"="green"](${bbox});way["golf"="green"](${bbox}););out center;`,
      greengeom: `[out:json][timeout:20];(way["golf"="green"](${bbox}););out geom;`,
      holes:     `[out:json][timeout:15];(way["golf"="hole"](${bbox}););out geom;`,
      surfaces:  `[out:json][timeout:25];(way["golf"="fairway"](${bbox});relation["golf"="fairway"](${bbox});way["golf"="bunker"](${bbox});relation["golf"="bunker"](${bbox}););out geom;`,
      nearby:    `[out:json][timeout:15];(node["leisure"="golf_course"](${bbox});way["leisure"="golf_course"](${bbox});relation["leisure"="golf_course"](${bbox}););out center;`,
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
        // Persist durably BEFORE responding. This was fire-and-forget, but on
        // Vercel the function can freeze the moment res.json() returns, killing
        // an in-flight INSERT — reproduced 2026-07-09: large `surfaces` payloads
        // (80+ polygons w/ full geometry) lost the race to the freeze and never
        // reached L2, so every cold start re-hit Overpass. Awaiting the write
        // fixes that; it only costs latency on the FIRST fetch of each
        // (osm_type, bbox) — every later hit is served from L1/L2 cache. The
        // write error is still swallowed so a DB hiccup can never break the
        // response, and the race cap keeps a hung DB from stalling the client.
        await Promise.race([
          db.query(
            `INSERT INTO tm_osm_cache (osm_type, bbox, data, fetched_at)
               VALUES ($1, $2, $3, now())
             ON CONFLICT (osm_type, bbox)
               DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
            [osmType, bbox, data]
          ).catch(e => console.error('[eagle-eye/osm] L2 cache write failed:', e.message)),
          new Promise(resolve => setTimeout(resolve, OSM_WRITE_MAX_WAIT_MS)),
        ])
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

// ── Elevation (DEM) for the plays-like elevation term (Phase 3.1) ──────────
// Resolves terrain elevation (feet) for the target (green/aim) and the player,
// returns the uphill/downhill delta the plays-like model needs. Cached exactly
// like /osm:
//   L1 — in-memory Map (instant within a warm Vercel instance)
//   L2 — Supabase tm_elevation_cache (migration 029; elevation is STATIC so no
//        TTL — a coordinate cell is fetched from the public DEM at most once).
// Provider: USGS 3DEP EPQS (US, ~1 m, public domain, keyless). Non-US / no-data
// → null elevation; the client simply drops the elevation factor (wind + temp
// still compute). The plays-like DISTANCE must never block on or break from
// this — every failure path returns nulls, never an error the UI can't absorb.
const elevCache = new Map()                 // "lat5,lon5" → ft (number)
const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json'
const EPQS_TIMEOUT_MS = 6000
// Absolute sanity range in feet — Dead Sea shore ≈ -1410 ft, highest land
// ≈ 29032 ft. Anything outside is a no-data sentinel (EPQS returns a large
// negative for off-grid/ocean) → treated as unknown, never a fabricated number.
const ELEV_MIN_FT = -1500
const ELEV_MAX_FT = 30000
const round5 = (n) => Math.round(n * 1e5) / 1e5

async function fetchUsgsElevationFt(lat, lon) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), EPQS_TIMEOUT_MS)
  try {
    const url = `${EPQS_URL}?x=${lon}&y=${lat}&units=Feet&wkid=4326&includeDate=false`
    const r = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    const j = await r.json()
    const ft = Number(j?.value)
    if (!Number.isFinite(ft) || ft < ELEV_MIN_FT || ft > ELEV_MAX_FT) return null
    return ft
  } catch { return null } finally { clearTimeout(timer) }
}

// Provider abstraction — USGS today; open-meteo DEM is the intended worldwide
// fallback but its contract is UNVERIFIED (timed out 2026-06-25), so it's not
// wired here yet (non-US gracefully returns null until then).
async function resolveElevationFt(lat, lon) {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const la = round5(lat), lo = round5(lon)
  const key = `${la},${lo}`
  if (elevCache.has(key)) return elevCache.get(key)            // L1
  try {                                                         // L2 (durable)
    const row = await db.one('SELECT elevation_ft FROM tm_elevation_cache WHERE lat_round = $1 AND lon_round = $2', [la, lo])
    if (row) { const ft = Number(row.elevation_ft); elevCache.set(key, ft); return ft }
  } catch (e) { console.error('[eagle-eye/elevation] L2 read failed:', e.message) }
  const ft = await fetchUsgsElevationFt(la, lo)                 // L3 (live DEM)
  if (ft == null) return null                                  // no-data → don't cache; client drops the term
  elevCache.set(key, ft)
  db.query(                                                     // persist (fire-and-forget)
    `INSERT INTO tm_elevation_cache (lat_round, lon_round, elevation_ft, source, fetched_at)
       VALUES ($1, $2, $3, 'usgs', now())
     ON CONFLICT (lat_round, lon_round) DO UPDATE SET elevation_ft = EXCLUDED.elevation_ft, fetched_at = now()`,
    [la, lo, ft]
  ).catch(e => console.error('[eagle-eye/elevation] L2 write failed:', e.message))
  return ft
}

// GET /api/eagle-eye/elevation?glat=&glon=[&plat=&plon=]
//   glat/glon — target (green/aim), required · plat/plon — player, optional
// → { greenFt, playerFt, deltaFt, source }; deltaFt = greenFt − playerFt
//   (positive = target uphill from the player = plays longer). Any unknown → null.
router.get('/elevation', async (req, res) => {
  try {
    const num = (v) => (v == null || v === '' ? null : Number(v))
    const glat = num(req.query.glat), glon = num(req.query.glon)
    const plat = num(req.query.plat), plon = num(req.query.plon)
    if (glat == null || glon == null || !Number.isFinite(glat) || !Number.isFinite(glon)) {
      return res.status(400).json({ error: 'glat,glon required' })
    }
    const [greenFt, playerFt] = await Promise.all([
      resolveElevationFt(glat, glon),
      (plat != null && plon != null) ? resolveElevationFt(plat, plon) : Promise.resolve(null),
    ])
    const deltaFt = (greenFt != null && playerFt != null) ? Math.round((greenFt - playerFt) * 10) / 10 : null
    res.json({ greenFt, playerFt, deltaFt, source: 'usgs' })
  } catch (err) {
    console.error('[eagle-eye/elevation]', err.message)
    res.json({ greenFt: null, playerFt: null, deltaFt: null, source: null }) // never 500 an optional factor
  }
})

module.exports = router
