import { useState } from 'react'
import MatchEndShareModal from './MatchEndShare.jsx'
import ShotEditor from '../ShotEditor.jsx'

// ─── End Match / Winner Ceremony ──────────────────────────────────────────────
export default function EndMatchScreen({ summary, user, onDone }) {
  const { code, name, winner, podium = [], highlights, course, course_par, format } = summary
  // Phase 3 (2026-07-10): your round id (server round_ids map) → the ceremony
  // is the natural moment to review shots for strokes gained. Missing (old
  // matches / guests) → no button, no dead end.
  const myRoundId = summary?.round_ids?.[user?.id] ?? null
  const [shotEditorOpen, setShotEditorOpen] = useState(false)
  const [shared, setShared] = useState(false)
  const [linkShared, setLinkShared] = useState(false)
  // 2026-05-06 (polish task #4) — optional Canvas-rendered match-result
  // share card. Reuses the HighlightShare pipeline (1080×1080 PNG +
  // navigator.share with file blob, download fallback). Toggled by the
  // "Save share image" button below the existing text + live-link
  // share buttons. Defaults to closed; opens on demand.
  const [showImageShare, setShowImageShare] = useState(false)

  async function share() {
    const lines = [`${winner?.name} wins ${winner?.name ? '"' + (course || 'The Match') + '"' : ''}!`]
    podium.forEach((p, i) => {
      const sign = p.diff >= 0 ? `+${p.diff}` : `${p.diff}`
      lines.push(`${i + 1}. ${p.name}  ${p.total}  (${sign})`)
    })
    if (highlights?.most_eagles)  lines.push(`${highlights.most_eagles.name} — ${highlights.most_eagles.count} eagle${highlights.most_eagles.count !== 1 ? 's' : ''}`)
    if (highlights?.most_birdies) lines.push(`Most birdies: ${highlights.most_birdies.name} (${highlights.most_birdies.count})`)
    if (code) lines.push(`Live board: ${window.location.origin}/?live=${code}`)
    lines.push('Tracked on The Match')
    const text = lines.join('\n')
    if (navigator.share) {
      try { await navigator.share({ text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      setShared(true); setTimeout(() => setShared(false), 2500)
    }
  }

  // Share the public final-results URL — same /?live=CODE link
  // used during play, but the public board now reads 'FINAL RESULTS'
  // for ended outings. (Round 8 audit.)
  async function shareLink() {
    if (!code) return
    const url = `${window.location.origin}/?live=${code}`
    if (navigator.share) {
      try { await navigator.share({ title: name || 'The Match', url, text: `${name || 'Match'} — final leaderboard` }) } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      setLinkShared(true); setTimeout(() => setLinkShared(false), 2500)
    }
  }

  // Rank badge treatments — solid fills so the numerals read over anything
  // (grass-tab doctrine: translucent panels, SOLID numerals/accents).
  const rankBadge = [
    { bg: 'linear-gradient(135deg, #E8C05A, #C9A040)', color: '#FFFFFF', ring: 'rgba(201,160,64,0.55)' },
    { bg: 'linear-gradient(135deg, #C4CBD2, #9AA3AB)', color: '#FFFFFF', ring: 'rgba(154,163,171,0.5)' },
    { bg: 'linear-gradient(135deg, #D99A5B, #B87333)', color: '#FFFFFF', ring: 'rgba(184,115,51,0.5)' },
  ]
  const diffColor = (d) => (d < 0 ? 'var(--tm-gold-text)' : d > 0 ? '#B22222' : 'var(--tm-text-2)')

  // Ceremony redesign (2026-07-10 design-critique): the screen used to be
  // `background: transparent` over the Match tab's bright fairway photo with
  // DARK-theme surfaces (#F5D78A gold, white-6% fills) — everything washed
  // out (~1.3:1 contrast on the winner name). Now: a parchment VEIL gradient
  // keeps the grass glowing through while every panel follows the grass-tab
  // doctrine (translucent white + blur, solid numerals); the champion is the
  // unmistakable hero (glowing gold medallion + gradient-gold name); one gold
  // primary action; shares collapsed to a compact row. Entrance animations
  // honor prefers-reduced-motion.
  return (
    <div data-no-pull-refresh="true" style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto',
      background: 'linear-gradient(180deg, rgba(242,238,230,0.96) 0%, rgba(242,238,230,0.86) 26%, rgba(242,238,230,0.80) 55%, rgba(242,238,230,0.92) 100%)',
      backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
    }}>
      <style>{`
        @keyframes tm-end-pop { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
        @keyframes tm-end-glow {
          0%, 100% { box-shadow: 0 0 0 10px rgba(201,160,64,0.10), 0 6px 34px rgba(201,160,64,0.35); }
          50%      { box-shadow: 0 0 0 16px rgba(201,160,64,0.16), 0 6px 52px rgba(201,160,64,0.55); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tm-end-anim, .tm-end-medal { animation: none !important; }
        }
      `}</style>

      {/* ── Trophy hero ── */}
      <div className="tm-end-anim" style={{ padding: '36px 24px 22px', textAlign: 'center', animation: 'tm-end-pop 0.5s cubic-bezier(0.22,1,0.36,1) both' }}>
        <div className="tm-end-medal" style={{
          width: 96, height: 96, margin: '0 auto 16px', borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #FDF8EC 0%, #F3E3B8 45%, #E2C87E 100%)',
          border: '2px solid rgba(201,160,64,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'tm-end-glow 2.8s ease-in-out infinite',
        }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--tm-gold-dim)' }}>
            <path d="M8 21h8M12 17v4M17 3H7l1 7a5 5 0 0010 0l1-7z"/>
            <path d="M7 3H4a2 2 0 000 4h3M17 3h3a2 2 0 010 4h-3"/>
          </svg>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-gold-text)', textTransform: 'uppercase', letterSpacing: 4, marginBottom: 10 }}>
          Champion
        </div>
        {winner && (
          <>
            <div style={{
              fontSize: 38, fontWeight: 900, lineHeight: 1.08, marginBottom: 8, letterSpacing: '-0.5px',
              background: 'linear-gradient(180deg, #C9A040 0%, #7A5800 90%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.65))',
            }}>
              {winner.name}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tm-text-2)' }}>
              {winner.total} strokes
              {winner.diff !== undefined && (
                <span style={{ marginLeft: 8, fontWeight: 900, color: diffColor(winner.diff) }}>
                  ({winner.diff === 0 ? 'E' : winner.diff > 0 ? `+${winner.diff}` : winner.diff})
                </span>
              )}
            </div>
          </>
        )}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 2, marginTop: 10 }}>
          {format === 'match' ? 'Match Play' : format === 'stableford' ? 'Stableford' : format === 'skins' ? 'Skins' : 'Stroke Play'} · {course || 'Final Results'}
        </div>
        {/* gold hairline flourish */}
        <div style={{ width: 120, height: 2, margin: '18px auto 0', borderRadius: 2, background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.85), transparent)' }} />
      </div>

      {/* ── Podium ── */}
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-green-text)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 2 }}>Final Standings</div>
        {podium.map((p, i) => {
          const sign = p.diff === 0 ? 'E' : p.diff > 0 ? `+${p.diff}` : `${p.diff}`
          const badge = rankBadge[i]
          const isChamp = i === 0
          return (
            <div key={p.user_id} className="tm-end-anim" style={{
              background: isChamp
                ? 'linear-gradient(135deg, rgba(253,248,236,0.92), rgba(255,255,255,0.82))'
                : 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
              border: isChamp ? '1.5px solid rgba(201,160,64,0.6)' : '1px solid var(--tm-border-2)',
              boxShadow: isChamp
                ? '0 8px 28px rgba(201,160,64,0.28), inset 0 1px 0 rgba(255,255,255,0.9)'
                : '0 3px 14px rgba(27,94,59,0.10), inset 0 1px 0 rgba(255,255,255,0.8)',
              borderRadius: 16, padding: isChamp ? '16px 16px' : '13px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
              animation: `tm-end-pop 0.5s cubic-bezier(0.22,1,0.36,1) ${0.08 + i * 0.07}s both`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: badge?.bg ?? 'var(--tm-surface-3)',
                boxShadow: badge ? `0 0 0 3px ${badge.ring}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 900, color: badge?.color ?? 'var(--tm-text-2)',
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: 'var(--tm-text)', fontSize: isChamp ? 16 : 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}{p.is_guest ? ' (guest)' : ''}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-text-2)', marginTop: 2 }}>
                  {p.birdies > 0 && <span style={{ color: 'var(--tm-gold-text)', fontWeight: 800, marginRight: 8 }}>{p.birdies} birdie{p.birdies !== 1 ? 's' : ''}</span>}
                  {p.eagles > 0 && <span style={{ color: 'var(--tm-gold-text)', fontWeight: 800, marginRight: 8 }}>{p.eagles} eagle{p.eagles !== 1 ? 's' : ''}</span>}
                  {p.holes_played} holes
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: isChamp ? 24 : 21, fontWeight: 900, color: 'var(--tm-text)', fontVariantNumeric: 'tabular-nums' }}>{p.total}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: diffColor(p.diff) }}>{sign}</div>
              </div>
            </div>
          )
        })}

        {/* Highlights */}
        {(highlights?.most_birdies || highlights?.most_eagles) && (
          <div className="tm-end-anim" style={{
            background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid var(--tm-border-2)', borderRadius: 16, padding: '14px 16px', marginTop: 4,
            boxShadow: '0 3px 14px rgba(27,94,59,0.10), inset 0 1px 0 rgba(255,255,255,0.8)',
            animation: 'tm-end-pop 0.5s cubic-bezier(0.22,1,0.36,1) 0.3s both',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-green-text)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Round Highlights</div>
            {highlights.most_eagles && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-2)' }}>Eagle{highlights.most_eagles.count > 1 ? 's' : ''}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--tm-gold-text)' }}>{highlights.most_eagles.name} × {highlights.most_eagles.count}</span>
              </div>
            )}
            {highlights.most_birdies && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-2)' }}>Most birdies</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--tm-gold-text)' }}>{highlights.most_birdies.name} × {highlights.most_birdies.count}</span>
              </div>
            )}
          </div>
        )}

        {/* ── PRIMARY action — Phase 3 flyover review (the SG payoff moment) ── */}
        {myRoundId && (
          <button onClick={() => setShotEditorOpen(true)} className="tm-end-anim" style={{
            width: '100%', minHeight: 52, padding: '15px 16px', borderRadius: 15, cursor: 'pointer', marginTop: 10,
            background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
            border: 'none', color: '#FFFFFF', fontWeight: 800, fontSize: 15,
            boxShadow: '0 8px 22px rgba(160,120,40,0.4), inset 0 1px 0 rgba(255,255,255,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
            animation: 'tm-end-pop 0.5s cubic-bezier(0.22,1,0.36,1) 0.36s both',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>
            </svg>
            Review your shots — unlock strokes gained
          </button>
        )}
        {shotEditorOpen && myRoundId && (
          <ShotEditor roundId={myRoundId} onClose={() => setShotEditorOpen(false)} />
        )}

        {/* ── Shares — one compact glass row (was three stacked full-width
            buttons of equal weight fighting the ceremony for attention) ── */}
        <div className="tm-end-anim" style={{ display: 'flex', gap: 8, marginTop: myRoundId ? 2 : 10, animation: 'tm-end-pop 0.5s cubic-bezier(0.22,1,0.36,1) 0.42s both' }}>
          <button onClick={share} style={{
            flex: 1, minHeight: 50, borderRadius: 14, cursor: 'pointer',
            background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid var(--tm-border-2)', color: 'var(--tm-green-text)',
            fontWeight: 800, fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            {shared ? 'Copied!' : 'Results'}
          </button>
          {code && (
            <button onClick={shareLink} style={{
              flex: 1, minHeight: 50, borderRadius: 14, cursor: 'pointer',
              background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
              border: '1px solid var(--tm-border-2)', color: 'var(--tm-green-text)',
              fontWeight: 800, fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              WebkitTapHighlightColor: 'transparent',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              {linkShared ? 'Copied!' : 'Live link'}
            </button>
          )}
          <button onClick={() => setShowImageShare(true)} style={{
            flex: 1, minHeight: 50, borderRadius: 14, cursor: 'pointer',
            background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid var(--tm-border-2)', color: 'var(--tm-green-text)',
            fontWeight: 800, fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            WebkitTapHighlightColor: 'transparent',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            Image
          </button>
        </div>

        <button onClick={onDone} className="tm-end-anim" style={{
          width: '100%', minHeight: 52, padding: '15px', borderRadius: 15, cursor: 'pointer',
          background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid var(--tm-border-2)',
          color: 'var(--tm-green-text)', fontWeight: 800, fontSize: 15,
          boxShadow: '0 3px 14px rgba(27,94,59,0.10)',
          WebkitTapHighlightColor: 'transparent',
          animation: 'tm-end-pop 0.5s cubic-bezier(0.22,1,0.36,1) 0.48s both',
        }}>Back to Matches</button>
      </div>

      {showImageShare && (
        <MatchEndShareModal
          summary={summary}
          viewerId={user?.id}
          onClose={() => setShowImageShare(false)}
        />
      )}
    </div>
  )
}
