// ShotEditor — the post-round FLYOVER shot editor (Phase 3, 2026-07-10).
//
// Opens a CLOSED round (tm_rounds row) and lets the owner review / add / move /
// tag the shots they hit, hole by hole, on the satellite map — producing the
// complete {shots + putts} chains the read-time SG engine walks into
// OTT/APP/ARG/PUTT. The market research thesis this implements: the flyover
// IS the editor (each hole change flies the hole via HoleMapGL's cinematic
// camera — nobody in the market fuses replay + editing), zero-capture rounds
// are FIRST-class (tap-in a whole hole after the fact), and a per-hole
// SG-ready indicator + round progress replace the "sign-off homework" the
// incumbents force.
//
// Data contract: reads GET /api/rounds/:id (any-auth readable — the EDIT
// affordances are owner-gated by the callers; the PATCH is owner-enforced
// server-side). Saves via PATCH /api/rounds/:id/shots (server re-cleans;
// optional atomic putts ride-along). Geometry: curated tm_course_holes
// overrides FIRST (the "Map this course" editor's output), OSM golf=hole ways
// second, no-map manual list fallback third — no dead ends.
//
// SG safety: the editor only edits FACTS. SG is computed at read time and
// gates on complete chains; handicap never reads shots. A broken chain shows
// as "not SG-ready" here — never a wrong number anywhere.
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'
import { haversineYards, calcBearing } from '../lib/geo.js'
import { ShotSheet, SHOT_LIES } from '../components/scorecard/ShotSheet.jsx'
import PuttChips from '../components/scorecard/PuttChips.jsx'
import HoleMapGL from './HoleMapGL.jsx'

// Project a point `yards` along `bearingDeg` from {lat,lon} (local copy of the
// HoleMapGL helper — that one isn't exported; no drive-by refactors).
function projectByYards(start, bearingDeg, yards) {
  const R = 6371000, d = (yards * 0.9144) / R, br = bearingDeg * Math.PI / 180
  const lat1 = start.lat * Math.PI / 180, lon1 = start.lon * Math.PI / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI }
}

const padArr = (a, n, fill = null) => {
  const out = Array.isArray(a) ? a.slice(0, n) : []
  while (out.length < n) out.push(fill)
  return out
}

const lieLabel = (key) => SHOT_LIES.find(l => l.key === key)?.label ?? key

export default function ShotEditor({ roundId, onClose }) {
  // ── All state up top (no-use-before-define discipline) ──
  const [round, setRound] = useState(null)
  const [loadErr, setLoadErr] = useState(false)
  const [geo, setGeo] = useState(null)           // null=loading | 'none' | { geocoded, tees, greens, geoms }
  const [hole, setHole] = useState(1)            // 1-indexed
  const [shots, setShots] = useState(null)       // draft: per-hole arrays (0-indexed)
  const [putts, setPutts] = useState(null)
  const [firstPutts, setFirstPutts] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState(null)           // selected shot index on the current hole
  const [moveMode, setMoveMode] = useState(false)
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'error'
  const [manualOpen, setManualOpen] = useState(false)

  const holeCount = round ? (round.hole_pars?.length || round.scores?.length || 18) : 0

  // ── Load the round + seed editable drafts ──
  useEffect(() => {
    let cancelled = false
    api(`/api/rounds/${roundId}`).then(r => {
      if (cancelled) return
      const n = r.hole_pars?.length || r.scores?.length || 18
      setRound(r)
      setShots(padArr(r.shots, n).map(h => (Array.isArray(h) ? h.map(s => ({ ...s })) : null)))
      setPutts(padArr(r.putts, n))
      setFirstPutts(padArr(r.first_putts, n))
    }).catch(() => { if (!cancelled) setLoadErr(true) })
    return () => { cancelled = true }
  }, [roundId])

  // ── Load hole geometry: overrides first (course-editor output), OSM ways
  //    second; anchor from the course record. No course_id → list-only mode. ──
  useEffect(() => {
    if (!round) return
    const cid = round.course_id
    if (!cid) { setGeo('none'); return }
    let cancelled = false
    ;(async () => {
      try {
        const [course, ov] = await Promise.all([
          api(`/api/courses/${cid}`),
          api(`/api/courses/${cid}/holes`).catch(() => null),
        ])
        if (cancelled) return
        const anchor = (course?.latitude != null && course?.longitude != null)
          ? { lat: Number(course.latitude), lon: Number(course.longitude) } : null
        const tees = {}, greens = {}, geoms = {}
        if (anchor) {
          const bbox = `${anchor.lat - 0.015},${anchor.lon - 0.015},${anchor.lat + 0.015},${anchor.lon + 0.015}`
          const osm = await fetch(`/api/eagle-eye/osm?bbox=${encodeURIComponent(bbox)}&type=holes`)
            .then(r => r.json()).catch(() => ({ elements: [] }))
          if (cancelled) return
          // Primary golf=hole ways only (the EagleEye parse minus gap-fill —
          // an editor hole without geometry falls back to the manual list).
          for (const el of (osm?.elements || [])) {
            if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue
            const ref = parseInt(el.tags?.ref)
            if (!(ref >= 1 && ref <= 18) || tees[ref]) continue
            const geom = el.geometry.map(p => ({ lat: p.lat, lon: p.lon }))
            tees[ref] = { ...geom[0] }
            greens[ref] = { ...geom[geom.length - 1] }
            geoms[ref] = geom
          }
        }
        for (const h of (ov?.holes || [])) {  // curated overrides always win
          if (h.tee) tees[h.hole] = h.tee
          if (h.green) greens[h.hole] = h.green
          if (h.tee && h.green) geoms[h.hole] = h.aim ? [h.tee, h.aim, h.green] : [h.tee, h.green]
        }
        const any = Object.keys(greens).length > 0
        setGeo(any && anchor ? { geocoded: anchor, tees, greens, geoms } : 'none')
      } catch {
        if (!cancelled) setGeo('none')
      }
    })()
    return () => { cancelled = true }
  }, [round])

  // ── Per-hole derived values (render-time only) ──
  const curShots = (shots && shots[hole - 1]) || []
  const tee = geo && geo !== 'none' ? geo.tees[hole] : null
  const green = geo && geo !== 'none' ? geo.greens[hole] : null
  const mapMode = !!(geo && geo !== 'none' && green)
  const score = Number(round?.scores?.[hole - 1]) || null
  const par = round?.hole_pars?.[hole - 1] ?? null
  const puttN = putts?.[hole - 1]

  // A shot's map position: persisted pin → exact; lie 'tee' → the tee; else
  // walk back from the green toward the tee by toPin (estimate until touched).
  function posForShot(s) {
    if (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))) return { lat: Number(s.lat), lon: Number(s.lon) }
    if (s.lie === 'tee' && tee) return { lat: tee.lat, lon: tee.lon }
    const toward = tee || (geo !== 'none' ? geo?.geocoded : null)
    if (!green || !toward) return null
    const maxY = tee ? (haversineYards(tee, green) || 400) : 400
    return projectByYards(green, calcBearing(green, toward), Math.min(Number(s.toPin) || 0, maxY))
  }

  const isHoleReady = (i) => {
    const hs = (shots && shots[i]) || []
    const sc = Number(round?.scores?.[i]) || 0
    const pn = putts?.[i]
    return sc > 0 && pn != null && hs.length > 0
      && hs.length + Number(pn) === sc
      && hs.every(s => s.lie && Number(s.toPin) > 0)
  }
  const readyCount = round ? Array.from({ length: holeCount }, (_, i) => i).filter(isHoleReady).length : 0

  // ── Mutators (drafts only; PATCH happens on hole advance / Done) ──
  function mutateShots(fn) {
    setShots(prev => {
      const next = prev.map(h => (h ? h.map(s => ({ ...s })) : h))
      fn(next)
      return next
    })
    setDirty(true)
  }
  function addShot(shot) {
    const newIdx = curShots.length
    mutateShots(n => {
      const arr = n[hole - 1] ? n[hole - 1].slice() : []
      arr.push(shot)
      n[hole - 1] = arr
    })
    setSel(newIdx)
  }
  function updateShot(i, fn) {
    mutateShots(n => {
      const arr = (n[hole - 1] || []).slice()
      if (!arr[i]) return
      arr[i] = fn({ ...arr[i] })
      n[hole - 1] = arr
    })
  }
  function deleteShot(i) {
    mutateShots(n => {
      const arr = (n[hole - 1] || []).slice()
      arr.splice(i, 1)
      n[hole - 1] = arr.length ? arr : null
    })
    setSel(null)
    setMoveMode(false)
  }

  function handleShotTap({ lat, lon, hit }) {
    if (saveState === 'saving') return
    const hitIdx = hit != null ? Number(hit) : null
    if (moveMode && sel != null) {
      const toPin = green ? Math.max(1, Math.round(haversineYards({ lat, lon }, green) || 1)) : null
      updateShot(sel, s => ({ ...s, lat, lon, ...(toPin ? { toPin } : {}) }))
      setMoveMode(false)
      return
    }
    if (hitIdx != null && curShots[hitIdx]) { setSel(hitIdx === sel ? null : hitIdx); return }
    if (!green) return
    const toPin = Math.max(1, Math.round(haversineYards({ lat, lon }, green) || 1))
    addShot({ lie: curShots.length === 0 ? 'tee' : 'fairway', toPin, lat, lon })
  }

  // ── Save (PATCH — server re-cleans; putts ride along when any exist) ──
  async function save() {
    if (!dirty) return true
    setSaveState('saving')
    try {
      const body = { shots: shots.map(h => (h && h.length ? h : null)) }
      if (putts.some(p => p != null)) { body.putts = putts; body.firstPutts = firstPutts }
      await api(`/api/rounds/${roundId}/shots`, { method: 'PATCH', body: JSON.stringify(body) })
      setDirty(false)
      setSaveState(null)
      return true
    } catch {
      setSaveState('error')
      return false
    }
  }
  async function goHole(delta) {
    const next = Math.min(holeCount, Math.max(1, hole + delta))
    if (next === hole) return
    if (!(await save())) return   // failed save keeps the hole open (retry chip)
    setHole(next)
    setSel(null)
    setMoveMode(false)
  }
  async function done() {
    if (!(await save())) return
    onClose?.()
  }

  // ── UI ──
  // 44px min touch height (project rule; design-critique 2026-07-10).
  const btn = {
    background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', borderRadius: 12,
    padding: '8px 14px', minHeight: 44, color: 'var(--tm-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
  }
  const selShot = sel != null ? curShots[sel] : null
  const expected = score != null && puttN != null ? Math.max(0, score - Number(puttN)) : null
  const ready = isHoleReady(hole - 1)

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 8500, background: 'var(--tm-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <div style={{ padding: 'calc(env(safe-area-inset-top, 12px) + 8px) 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={done} aria-label="Close" style={{ ...btn, width: 44, height: 44, minHeight: 44, padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {round?.course_name || 'Round'} — shot review
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-3)' }}>
            {readyCount}/{holeCount || '—'} holes SG-ready
          </div>
        </div>
        <button onClick={done} disabled={saveState === 'saving'} style={{ ...btn, background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', border: 'none', color: 'var(--tm-text-inv)', fontWeight: 800 }}>
          {saveState === 'saving' ? 'Saving…' : 'Done'}
        </button>
      </div>

      {/* ── Map (flyover camera rides HoleMapGL's per-hole cinematic) / fallback card ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--tm-bg)' }}>
        {!round && !loadErr && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-3)', fontSize: 13, fontWeight: 600 }}>Loading round…</div>
        )}
        {loadErr && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-3)', fontSize: 13, fontWeight: 600 }}>
            Couldn't load this round.
            <button onClick={onClose} style={btn}>Close</button>
          </div>
        )}
        {round && mapMode && (
          <HoleMapGL
            courseCtx={null}
            currentHole={hole}
            gps={null}
            geocoded={geo.geocoded}
            holePositions={geo.tees}
            greenPositions={geo.greens}
            greenPolys={{}}
            holeGeometries={geo.geoms}
            shotMode
            shotDraft={{ points: curShots.map((s, i) => ({ ...(posForShot(s) || {}), sel: i === sel })).filter(p => p.lat != null), green }}
            onShotTap={handleShotTap}
          />
        )}
        {round && geo === 'none' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'var(--tm-text-3)', fontSize: 13, fontWeight: 600, lineHeight: 1.6 }}>
            No map available for this course — add shots with the button below and they'll count toward strokes gained all the same.
          </div>
        )}
        {round && geo === null && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-3)', fontSize: 13, fontWeight: 600 }}>Loading course map…</div>
        )}
        {/* tap hint / move-mode banner */}
        {round && mapMode && (
          <div style={{ position: 'absolute', top: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderRadius: 999, padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#fff' }}>
              {moveMode ? `Tap where shot ${sel + 1} was hit from` : curShots.length === 0 ? 'Tap the map where each shot was hit from' : 'Tap a pin to edit · tap open ground to add'}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom panel ── */}
      <div style={{ background: 'var(--tm-surface)', borderTop: '1px solid var(--tm-border)', padding: '10px 16px calc(env(safe-area-inset-bottom, 12px) + 10px)', maxHeight: '46vh', overflowY: 'auto' }}>
        {/* hole nav + facts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={() => goHole(-1)} disabled={hole <= 1 || saveState === 'saving'} aria-label="Previous hole" style={{ ...btn, minWidth: 44, opacity: hole <= 1 ? 0.4 : 1 }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--tm-text)' }}>
              Hole {hole}
              {par != null && <span style={{ fontWeight: 600, color: 'var(--tm-text-3)' }}> · Par {par}</span>}
              {score != null && <span style={{ fontWeight: 600, color: 'var(--tm-text-3)' }}> · Score {score}</span>}
            </div>
            {/* #8FCB9B: the RoundScorecard "tagged" green — readable on the
                dark surface where the raw fairway green fails contrast. */}
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: ready ? '#8FCB9B' : 'var(--tm-text-3)' }}>
              {ready ? 'SG-ready ✓' : expected != null
                ? `${curShots.length}/${expected} shots + ${puttN} putts ${curShots.length + Number(puttN) === score ? '' : `(score ${score})`}`
                : 'Add shots + putts to unlock strokes gained'}
            </div>
          </div>
          <button onClick={() => goHole(1)} disabled={hole >= holeCount || saveState === 'saving'} aria-label="Next hole" style={{ ...btn, minWidth: 44, opacity: hole >= holeCount ? 0.4 : 1 }}>›</button>
        </div>

        {/* save-failed retry chip */}
        {saveState === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', borderRadius: 12, border: '1px solid var(--tm-red, #C0392B)', background: 'var(--tm-surface-2)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-red, #C0392B)' }}>Couldn't save — your edits are still here.</span>
            <button onClick={save} style={{ ...btn, padding: '5px 12px' }}>Retry</button>
          </div>
        )}

        {/* shot chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 8 }}>
          {curShots.map((s, i) => (
            <button key={i} onClick={() => { setSel(i === sel ? null : i); setMoveMode(false) }} style={{
              ...btn, flexShrink: 0,
              border: i === sel ? '1.5px solid var(--tm-gold-dim)' : '1px solid var(--tm-border)',
              background: i === sel ? 'var(--tm-gold-muted)' : 'var(--tm-surface-2)',
              color: i === sel ? 'var(--tm-gold-text)' : 'var(--tm-text)',
            }}>
              {i + 1} · {lieLabel(s.lie)} · {s.toPin}y{s.club ? ` · ${s.club}` : ''}
            </button>
          ))}
          <button onClick={() => setManualOpen(true)} disabled={saveState === 'saving'} style={{ ...btn, flexShrink: 0, color: 'var(--tm-text-3)' }}>+ Add shot</button>
        </div>

        {/* selected-shot controls */}
        {selShot && (
          <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)' }}>
            <div style={{ fontSize: 10, color: 'var(--tm-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Shot {sel + 1} — lie
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {SHOT_LIES.map(l => (
                <button key={l.key} onClick={() => updateShot(sel, s => ({ ...s, lie: l.key }))} style={{
                  padding: '7px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: selShot.lie === l.key ? 'var(--tm-gold-muted)' : 'var(--tm-surface)',
                  border: selShot.lie === l.key ? '1.5px solid var(--tm-gold-dim)' : '1px solid var(--tm-border)',
                  color: selShot.lie === l.key ? 'var(--tm-gold-text)' : 'var(--tm-text-3)',
                }}>{l.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {mapMode && (
                <button onClick={() => setMoveMode(m => !m)} style={{ ...btn, flex: 1, border: moveMode ? '1.5px solid var(--tm-gold-dim)' : btn.border, color: moveMode ? 'var(--tm-gold-text)' : btn.color }}>
                  {moveMode ? 'Tap the map…' : 'Move pin'}
                </button>
              )}
              <button onClick={() => deleteShot(sel)} style={{ ...btn, flex: 1, color: 'var(--tm-red, #C0392B)' }}>Delete</button>
            </div>
          </div>
        )}

        {/* putts — same shared chips as live capture */}
        <PuttChips
          puttVal={puttN ?? null}
          setPuttVal={(updater) => {
            setPutts(prev => {
              const next = prev.slice()
              next[hole - 1] = typeof updater === 'function' ? updater(prev[hole - 1]) : updater
              return next
            })
            setDirty(true)
          }}
          firstPutt={firstPutts?.[hole - 1] ?? null}
          setFirstPutt={(updater) => {
            setFirstPutts(prev => {
              const next = prev.slice()
              next[hole - 1] = typeof updater === 'function' ? updater(prev[hole - 1]) : updater
              return next
            })
            setDirty(true)
          }}
        />
      </div>

      {/* manual add (list fallback + precision entry) — the shared capture sheet */}
      {manualOpen && (
        <ShotSheet
          isFirstShot={curShots.length === 0}
          onClose={() => setManualOpen(false)}
          onAdd={(s) => {
            setManualOpen(false)
            if (s?.lie && Number(s.toPin) > 0) {
              addShot({ lie: s.lie, toPin: Number(s.toPin), ...(s.club ? { club: s.club } : {}) })
            }
          }}
        />
      )}
    </div>,
    document.body
  )
}
