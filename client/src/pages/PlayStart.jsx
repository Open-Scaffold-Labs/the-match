// PlayStart — the Play tab's start funnel (Phase 1 / S3b of the Play-funnel
// plan, wiki/synthesis/play-funnel-phase1-build-spec-2026-07-10.md).
//
// Renders inside EagleEye in place of the old Welcome hero, ONLY when no
// course context is active (an active round resumes straight to the map —
// one-tap resume is the top friction remover). Target: 2–3 taps from
// app-open to hole-1 distance when the course default is right, with ZERO
// interstitials — the single loudest start-flow complaint class across the
// market leaders (research 2026-07-10).
//
// Course default = nearest recent within 5 miles (visible confirm card,
// NEVER an invisible auto-start — wrong-course lock-on is the market's #1
// trust killer), falling back to last-played, falling back to search. The
// card pre-fills the remembered per-course tee (none of the leaders do
// per-course tee memory well).
//
// Solo is the default mode; Match is one tap. The heavy CreateWizard stays
// on the Match tab for events/leagues. "Just browse a course map" preserves
// the pre-funnel behavior (load a course on the map without starting a
// round). IMPORTANT (Matt, 2026-07-10): Eagle Eye is ONE surface — an
// AI-powered CADDIE where yardages and scoring live together (the Scorecard
// is wired straight in). There is no separate "rangefinder mode"; never
// frame any path as "yardages only, no scoring".

import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { dedupeTees } from '../lib/tees.js'
import { readRecents, nearestRecent, lastUsed, recentDistMiles } from '../lib/course-recents.js'
import { readSavedSoloRound } from '../lib/solo-round.js'
import { readSession } from '../lib/active-round-session.js'

// onBackToMap: present when a course view is active behind this screen
// (showStart in EagleEye) — renders the escape back to the map.
export default function PlayStart({ user, gps, onRequestLocation, onOpenPicker, onStart, onResumeSolo, onResumeMatch, onBackToMap, startBusy, startError }) {
  const [mode, setMode]   = useState('solo') // 'solo' | 'match'
  const [holes, setHoles] = useState(18)
  const [chosenId, setChosenId] = useState(null) // recent overridden by a tap
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  const recents = readRecents()
  const auto = nearestRecent(gps ? { lat: gps.lat, lon: gps.lon } : null, 5) || lastUsed()
  const candidate = (chosenId != null && recents.find(r => String(r.id) === String(chosenId))) || auto
  const candMiles = candidate && gps ? recentDistMiles(candidate, { lat: gps.lat, lon: gps.lon }) : Infinity
  const isNearby = candMiles <= 5
  const otherRecents = recents.filter(r => !candidate || String(r.id) !== String(candidate.id)).slice(0, 3)

  // An in-progress solo round with no course context (edge: pre-S2 blobs
  // never seeded sharedCourse). Never double-start — offer Resume.
  const savedSolo = readSavedSoloRound(user?.id)

  // P2-B (2026-07-10) — active MATCH resume card from the session index
  // (covers matches created/joined anywhere, even with the Match tab at the
  // hub). Re-read on session changes so an end elsewhere drops the card.
  const [, setSessionTick] = useState(0)
  useEffect(() => {
    const bump = () => setSessionTick(t => t + 1)
    window.addEventListener('tm-session-changed', bump)
    return () => window.removeEventListener('tm-session-changed', bump)
  }, [])
  const session = readSession(user?.id)
  const matchSession = session?.kind === 'match' && session.code ? session : null

  const busy = startBusy || localBusy
  const error = startError || localError

  async function handleStart() {
    if (busy) return
    if (mode === 'solo' && savedSolo) { onResumeSolo?.(); return }
    if (!candidate) { onOpenPicker?.(mode, holes); return }
    setLocalError('')
    setLocalBusy(true)
    try {
      // Resolve the recent to a full course + tee: detail fetch, gender-correct
      // tee dedupe, remembered tee by name, else the first tee.
      const detail = await api(`/api/courses/${candidate.id}`)
      const tees = dedupeTees(detail?.tees, user?.gender)
      if (!tees.length) {
        // No tee data — fall through to the full picker rather than block.
        onOpenPicker?.(mode, holes)
        return
      }
      const tee = tees.find(t => t.tee_name === candidate.lastTee) || tees[0]
      await onStart?.({ course: detail, tee }, mode, holes)
    } catch {
      setLocalError('Could not load that course — try picking it again.')
    } finally {
      setLocalBusy(false)
    }
  }

  const chip = (active) => ({
    padding: '10px 0', flex: 1, borderRadius: 12, cursor: 'pointer',
    border: `1px solid ${active ? 'rgb(var(--tm-ee-gold-bright-rgb) / 0.5)' : 'rgb(var(--tm-ee-white-rgb) / 0.12)'}`,
    background: active ? 'rgb(var(--tm-ee-gold-bright-rgb) / 0.16)' : 'rgb(var(--tm-ee-white-rgb) / 0.05)',
    color: active ? 'var(--tm-ee-gold-light)' : 'rgb(var(--tm-ee-white-rgb) / 0.55)',
    fontWeight: 800, fontSize: 13,
  })

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 16px', animation: 'ee-fade-in 0.4s ease', position: 'relative' }}>
      {/* Back to the live map — only when a course view sits behind this
          screen (course-name tap in the header). (2026-07-10) */}
      {onBackToMap && (
        <button onClick={onBackToMap} style={{
          position: 'absolute', top: 8, left: 20,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.14)',
          borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.65)',
          WebkitTapHighlightColor: 'transparent',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to map
        </button>
      )}
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.22em', color: 'var(--tm-ee-gold)', marginBottom: 8 }}>EAGLE EYE · AI-POWERED CADDIE</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginBottom: 18, letterSpacing: '-0.03em', lineHeight: 1.1, textAlign: 'center' }}>
        Ready to play?
      </div>

      {/* Resume card — an active MATCH (from the session index). */}
      {matchSession && (
        <button onClick={() => onResumeMatch?.(matchSession.code)} style={{
          width: '100%', maxWidth: 360, padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
          border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.5)', background: 'rgb(var(--tm-ee-gold-rgb) / 0.12)',
          textAlign: 'left', marginBottom: 14,
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--tm-ee-gold)', marginBottom: 4 }}>MATCH IN PROGRESS</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
            MATCH {matchSession.code}{matchSession.courseName ? ` at ${matchSession.courseName}` : ''} — resume →
          </div>
        </button>
      )}

      {/* Resume card — an in-progress solo round outranks everything. */}
      {savedSolo && (
        <button onClick={onResumeSolo} style={{
          width: '100%', maxWidth: 360, padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
          border: '1px solid rgb(var(--tm-ee-green-rgb) / 0.45)', background: 'rgb(var(--tm-ee-green-rgb) / 0.12)',
          textAlign: 'left', marginBottom: 14,
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--tm-ee-green)', marginBottom: 4 }}>ROUND IN PROGRESS</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{savedSolo.config?.courseName || 'Solo round'} — resume →</div>
        </button>
      )}

      {/* Course confirm card — visible default, one tap to correct. */}
      {candidate ? (
        <div style={{
          width: '100%', maxWidth: 360, borderRadius: 16, padding: '14px 16px', marginBottom: 12,
          background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.35)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--tm-ee-gold)', marginBottom: 4 }}>
                {isNearby ? 'NEAREST COURSE' : 'LAST PLAYED'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.club_name}</div>
              <div style={{ fontSize: 12, color: 'rgb(var(--tm-ee-white-rgb) / 0.45)', marginTop: 2 }}>
                {isNearby && candMiles < Infinity ? (candMiles < 0.1 ? 'You’re here' : `${candMiles < 1 ? `${Math.round(candMiles * 10) / 10}` : Math.round(candMiles)} mi away`) : null}
                {isNearby && candidate.lastTee ? ' · ' : ''}
                {candidate.lastTee ? `${candidate.lastTee} tees` : ''}
              </div>
            </div>
            <button onClick={() => onOpenPicker?.(mode, holes)} style={{
              background: 'rgb(var(--tm-ee-white-rgb) / 0.07)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.15)',
              borderRadius: 10, padding: '8px 12px', color: 'rgb(var(--tm-ee-white-rgb) / 0.7)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}>Not here?</button>
          </div>
          {otherRecents.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {otherRecents.map(r => (
                <button key={r.id} onClick={() => setChosenId(r.id)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)',
                  color: 'rgb(var(--tm-ee-white-rgb) / 0.55)', maxWidth: 160,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{r.club_name}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'rgb(var(--tm-ee-white-rgb) / 0.4)', textAlign: 'center', marginBottom: 12, maxWidth: 280, lineHeight: 1.5 }}>
          Pick your course — it’ll be remembered here for a one-tap start next time.
        </div>
      )}

      {/* Holes + mode */}
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', gap: 8, marginBottom: 8 }}>
        {[9, 18].map(h => (
          <button key={h} onClick={() => setHoles(h)} style={chip(holes === h)}>{h} holes</button>
        ))}
      </div>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode('solo')} style={chip(mode === 'solo')}>Solo</button>
        <button onClick={() => setMode('match')} style={chip(mode === 'match')}>Match</button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#F87171', marginBottom: 10, textAlign: 'center', maxWidth: 320 }}>{error}</div>
      )}

      {/* START — gold hero action (the old Select Course button's styling). */}
      <button onClick={handleStart} disabled={busy} style={{
        width: '100%', maxWidth: 360, padding: '16px 0', borderRadius: 16, border: 'none',
        cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
        background: 'linear-gradient(135deg, var(--tm-ee-gold) 0%, var(--tm-ee-gold-bright) 100%)',
        color: 'var(--tm-ee-bg)', fontWeight: 900, fontSize: 16, letterSpacing: '0.02em',
        boxShadow: '0 6px 32px rgb(var(--tm-ee-gold-rgb) / 0.4), 0 2px 8px rgb(var(--tm-ee-black-rgb) / 0.3)',
      }}>
        {busy ? 'Starting…'
          : mode === 'solo' && savedSolo ? 'Resume Round'
          : candidate ? `Play ${mode === 'match' ? 'a Match' : ''} at ${candidate.club_name}`.replace('  ', ' ')
          : 'Select Course'}
      </button>

      {/* Quiet paths: location + browse-a-course. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 16 }}>
        {!gps && (
          <button onClick={onRequestLocation} style={{
            padding: '9px 22px', borderRadius: 12, border: '1px solid rgb(var(--tm-ee-green-rgb) / 0.4)', cursor: 'pointer',
            background: 'rgb(var(--tm-ee-green-rgb) / 0.1)', color: 'var(--tm-ee-green)', fontWeight: 700, fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tm-ee-green)', boxShadow: '0 0 8px var(--tm-ee-green)' }} />
            Enable Location for the nearest-course default
          </button>
        )}
        <button onClick={() => onOpenPicker?.(null, holes)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 12, fontWeight: 600, color: 'rgb(var(--tm-ee-white-rgb) / 0.35)', textDecoration: 'underline',
        }}>
          Just browse a course map — no round started
        </button>
      </div>
    </div>
  )
}
