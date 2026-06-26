// Leagues — paid-tier (Elite) league surface, mounted on the BAG nav slot.
//
// Architecture:
//   - Free user → LeaguesPaywall (upgrade marketing screen).
//   - Elite user → LeaguesHub → optionally drilled into LeagueDetail.
//
// Tier is read from /api/auth/me's user.tier field; the parent App passes
// the user object in. Server-side every route under /api/leagues/* is
// gated by requireElite middleware that returns 402 — the client honors
// that for defense-in-depth even if the tab is somehow reached.
//
// (2026-05-02 — first-class League surface.)

import { useEffect, useState } from 'react'
import { api, post, put, del } from '../lib/api.js'

const AUGUSTA_GREEN  = '#0E3B23'
const AUGUSTA_GOLD   = '#C9A040'
const AUGUSTA_CREAM  = '#F1E7C8'

// ─── Top-level decision: paywall vs hub ─────────────────────────────────
export default function Leagues({ user, onCreateEventInLeague, isDesktop = false }) {
  // Round 7 audit fix — tier handling is more nuanced than "Elite=hub,
  // free=paywall". A free-tier user added to a paying commissioner's
  // league STILL needs to see standings + announcements + events for
  // that league. The whole GTM motion depends on this: commissioner
  // pays once, brings 16 players for free, those players get exposed
  // to Elite via the product.
  //
  // New rules:
  //   - LeaguesHub renders for everyone (Elite + free).
  //   - LeaguesHub asks /api/leagues for leagues the user is a member
  //     of. Free users see only the leagues they were ADDED to (none
  //     if they're brand new). Elite users see those + ones they
  //     created.
  //   - Free users get an inline "Upgrade to create your own league"
  //     card above the league list.
  //   - 402 from a downstream commissioner-only action (create / edit
  //     rules / post announcement) flips to the full paywall page so
  //     the user knows exactly what they're trying to do that needs
  //     Elite.
  const [view, setView]     = useState('hub')         // 'hub' | 'detail' | 'create'
  const [activeLeagueId, setActiveLeagueId] = useState(null)
  const [paywall, setPaywall] = useState(null)        // null or { current, message }

  // Only flip to full paywall when explicitly triggered by a 402
  // response from a tier-gated action (create / edit rules / etc).
  // Free users browsing leagues they're members of stay on the hub.
  if (paywall) {
    return <LeaguesPaywall current={user?.tier || 'free'} reason={paywall?.message} />
  }

  if (view === 'detail' && activeLeagueId) {
    return (
      <LeagueDetail
        leagueId={activeLeagueId}
        isDesktop={isDesktop}
        onBack={() => { setActiveLeagueId(null); setView('hub') }}
        on402={(payload) => setPaywall(payload || { current: 'free' })}
        onCreateEvent={onCreateEventInLeague}
      />
    )
  }
  if (view === 'create') {
    return (
      <LeagueWizard
        onClose={() => setView('hub')}
        onCreated={(league) => { setActiveLeagueId(league.id); setView('detail') }}
        on402={(payload) => setPaywall(payload || { current: 'free' })}
      />
    )
  }
  return (
    <LeaguesHub
      isElite={user?.tier === 'elite'}
      isDesktop={isDesktop}
      onOpen={(id) => { setActiveLeagueId(id); setView('detail') }}
      onCreate={() => {
        // Free user tapping Create → flip to full paywall with the
        // exact upgrade copy. Elite user → wizard.
        if (user?.tier !== 'elite') {
          setPaywall({
            current: user?.tier || 'free',
            message: 'Creating leagues is part of The Match Elite. Upgrade to host your own.',
          })
        } else {
          setView('create')
        }
      }}
      on402={(payload) => setPaywall(payload || { current: 'free' })}
    />
  )
}

// ─── LeaguesPaywall — free-user upgrade screen ──────────────────────────
// Round 26 audit — bespoke SVG glyphs replace the emoji icons that
// previously broke the Augusta brand language. Stroke-on-gold styling
// matches the rest of the app's iconography. (2026-05-02)
function GlyphTrophy() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/><path d="M8 6H6a2 2 0 0 0 2 2"/><path d="M16 6h2a2 2 0 0 1-2 2"/>
    <line x1="12" y1="12" x2="12" y2="16"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="10" y1="16" x2="14" y2="16"/>
  </svg>)
}
function GlyphRoster() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3"/><path d="M3 21v-1a6 6 0 0 1 12 0v1"/>
    <circle cx="17" cy="9" r="2.5"/><path d="M14.5 21v-1a4.5 4.5 0 0 1 6.5-4"/>
  </svg>)
}
function GlyphControls() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
    <circle cx="8" cy="6" r="2" fill="#0E3B23"/><circle cx="14" cy="12" r="2" fill="#0E3B23"/><circle cx="10" cy="18" r="2" fill="#0E3B23"/>
  </svg>)
}
function GlyphChart() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="20" x2="21" y2="20"/>
    <rect x="6" y="11" width="3" height="9"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/>
  </svg>)
}
function GlyphBroadcast() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13a8 8 0 0 1 14 0"/><path d="M3 9a12 12 0 0 1 18 0"/>
    <circle cx="12" cy="18" r="2"/>
  </svg>)
}
function GlyphScale() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18"/><path d="M3 8h18"/><path d="M3 8l3 6h-6z" fill="#C9A04030"/><path d="M21 8l3 6h-6z" fill="#C9A04030"/>
  </svg>)
}
function LeaguesPaywall({ current = 'free', reason }) {
  const benefits = [
    { Icon: GlyphTrophy,    title: 'Season-long standings',     body: 'Aggregate wins, top-3 finishes, and average score across every event.' },
    { Icon: GlyphRoster,    title: 'Persistent league rosters', body: 'No more re-inviting players for every match. The league knows who plays.' },
    { Icon: GlyphControls,  title: 'Commissioner controls',     body: 'Set scoring rules once. Cancel rain-outs. Push announcements to the whole roster.' },
    { Icon: GlyphChart,     title: 'CSV exports + history',     body: 'Every event archived. Download standings any time for your records.' },
    { Icon: GlyphBroadcast, title: 'Unlimited live leaderboards', body: 'Tee-box QR codes, public spectator boards, branded print sheets.' },
    { Icon: GlyphScale,     title: 'Up to 150 players per event', body: 'Foursomes auto-assigned. Bulk-foursome score entry. League-grade scale.' },
  ]

  return (
    <div style={{
      minHeight: '100dvh',
      background: `linear-gradient(180deg, ${AUGUSTA_GREEN} 0%, #0A2918 100%)`,
      color: AUGUSTA_CREAM,
      fontFamily: '"Georgia", serif',
      padding: 'calc(var(--safe-top) + 24px) 20px 80px',
      overflowY: 'auto',
      position: 'relative',
      overflow: 'hidden auto',
    }}>
      {/* Ambient radial glow behind the trophy crest. Gives the hero
          actual focus / depth instead of a flat green wash. Pinned to
          the top center, sized so it bleeds off the edges. */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: 520, height: 380,
        background: 'radial-gradient(ellipse at center top, rgba(232,192,90,0.22) 0%, transparent 60%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Hero crest — 'ELITE' laurel arrangement */}
      <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 1 }}>
        {/* Crest: large trophy framed by two laurel sprigs */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, marginBottom: 14,
        }}>
          {/* Left laurel */}
          <svg width="38" height="56" viewBox="0 0 38 56" fill="none" stroke={AUGUSTA_GOLD} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
            <path d="M30 4 Q 18 14 16 28 Q 16 42 30 52" />
            <path d="M28 9 Q 22 11 22 17" /><path d="M25 14 Q 19 16 19 22" /><path d="M22 20 Q 16 22 16 28" />
            <path d="M22 36 Q 16 36 16 30" /><path d="M25 42 Q 19 42 19 36" /><path d="M28 47 Q 22 47 22 41" />
          </svg>
          {/* Centerpiece — large trophy in a circular gold-bordered medallion */}
          <div style={{
            width: 88, height: 88, borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 35%, rgba(245,215,138,0.30) 0%, rgba(201,160,64,0.10) 70%, transparent 100%)',
            border: '2px solid rgba(201,160,64,0.65)',
            boxShadow: '0 4px 24px rgba(201,160,64,0.30), inset 0 0 24px rgba(245,215,138,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={AUGUSTA_GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8v4a4 4 0 0 1-8 0V4z" fill="rgba(232,192,90,0.20)"/>
              <path d="M8 6H6a2 2 0 0 0 2 2"/>
              <path d="M16 6h2a2 2 0 0 1-2 2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="10" y1="16" x2="14" y2="16"/>
            </svg>
          </div>
          {/* Right laurel (mirrored) */}
          <svg width="38" height="56" viewBox="0 0 38 56" fill="none" stroke={AUGUSTA_GOLD} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85, transform: 'scaleX(-1)' }}>
            <path d="M30 4 Q 18 14 16 28 Q 16 42 30 52" />
            <path d="M28 9 Q 22 11 22 17" /><path d="M25 14 Q 19 16 19 22" /><path d="M22 20 Q 16 22 16 28" />
            <path d="M22 36 Q 16 36 16 30" /><path d="M25 42 Q 19 42 19 36" /><path d="M28 47 Q 22 47 22 41" />
          </svg>
        </div>

        <div style={{
          fontSize: 10, letterSpacing: '0.40em', color: AUGUSTA_GOLD,
          fontWeight: 800, marginBottom: 8,
          fontFamily: '"Arial Black", Arial, sans-serif',
        }}>THE MATCH · ELITE</div>
        <div style={{
          fontSize: 34, fontWeight: 900, letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 8, lineHeight: 1.05,
          textShadow: '0 2px 24px rgba(232,192,90,0.18)',
          fontFamily: '"Georgia", serif',
        }}>Run real leagues</div>
        <div style={{
          fontSize: 14, color: 'rgba(241,231,200,0.78)',
          lineHeight: 1.55, maxWidth: 360, margin: '0 auto',
          fontStyle: 'italic',
        }}>
          Tournament-grade tools for the commissioner. Built for weekly leagues, member-guests, charity outings, or season-long ladders.
        </div>
        {reason && (
          <div style={{
            marginTop: 14, padding: '8px 12px', borderRadius: 10,
            background: 'rgba(248,180,113,0.12)', border: '1px solid rgba(248,180,113,0.40)',
            color: '#F8B471', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          }}>{reason}</div>
        )}
      </div>

      {/* Gold flourish divider — a centered three-diamond ornament with
          hairline rules running off both sides. Editorial transition
          between the hero and the benefits list. */}
      <FlourishDivider />

      {/* Section overline */}
      <div style={{
        fontSize: 9, letterSpacing: '0.30em', textAlign: 'center',
        color: AUGUSTA_GOLD, fontWeight: 800, marginBottom: 16,
        fontFamily: '"Arial Black", Arial, sans-serif',
        position: 'relative', zIndex: 1,
      }}>WHAT&apos;S INSIDE</div>

      {/* Benefits grid — bespoke SVG glyphs in gold-tinted square tiles
          to match the rest of the app's Augusta iconography. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {benefits.map(b => (
          <div key={b.title} style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            padding: '14px 16px', borderRadius: 14,
            background: 'rgba(241,231,200,0.06)',
            border: '1px solid rgba(201,160,64,0.20)',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(201,160,64,0.12)',
              border: '1px solid rgba(201,160,64,0.30)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <b.Icon />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: AUGUSTA_CREAM, marginBottom: 3 }}>{b.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(241,231,200,0.65)', lineHeight: 1.45 }}>{b.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Flourish before pricing — sets up the membership-card moment */}
      <FlourishDivider />

      {/* Pricing card — engraved-membership-card aesthetic. Gold inner
          border + corner ornaments + serial-number footer give it the
          weight of a real club card, not a SaaS price tile. */}
      <div style={{
        position: 'relative',
        background: 'linear-gradient(135deg, rgba(245,215,138,0.22), rgba(201,160,64,0.12))',
        border: '1px solid rgba(245,215,138,0.65)',
        borderRadius: 18,
        padding: '24px 20px 22px',
        textAlign: 'center',
        marginBottom: 18,
        boxShadow: '0 8px 32px rgba(201,160,64,0.20), inset 0 1px 0 rgba(245,215,138,0.40)',
        zIndex: 1,
      }}>
        {/* Inner double-line frame — subtle but evokes a real card. */}
        <div aria-hidden style={{
          position: 'absolute', inset: 8, borderRadius: 12,
          border: '1px solid rgba(245,215,138,0.30)',
          pointerEvents: 'none',
        }} />
        {/* Four corner ornaments */}
        {[
          { top: 10, left: 10, rot: 0 },
          { top: 10, right: 10, rot: 90 },
          { bottom: 10, right: 10, rot: 180 },
          { bottom: 10, left: 10, rot: 270 },
        ].map((c, i) => (
          <svg key={i} aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={AUGUSTA_GOLD} strokeWidth="1.2" strokeLinecap="round" style={{
            position: 'absolute', ...c, transform: `rotate(${c.rot}deg)`,
            opacity: 0.55, pointerEvents: 'none',
          }}>
            <path d="M2 2 L7 2" /><path d="M2 2 L2 7" />
            <circle cx="2" cy="2" r="1" fill={AUGUSTA_GOLD} stroke="none" />
          </svg>
        ))}

        <div style={{
          fontSize: 11, color: AUGUSTA_GOLD, letterSpacing: '0.30em',
          fontWeight: 800, marginBottom: 10,
          fontFamily: '"Arial Black", Arial, sans-serif',
        }}>MEMBERSHIP</div>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: AUGUSTA_CREAM, lineHeight: 1 }}>$</span>
          <span style={{
            fontSize: 44, fontWeight: 900, color: AUGUSTA_CREAM, lineHeight: 1,
            fontFamily: '"Georgia", serif', letterSpacing: '-0.02em',
          }}>12</span>
          <span style={{ fontSize: 22, fontWeight: 900, color: AUGUSTA_CREAM, lineHeight: 1 }}>.99</span>
          <span style={{ fontSize: 13, color: 'rgba(241,231,200,0.60)', marginLeft: 4 }}>/mo</span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(241,231,200,0.65)', marginTop: 6, letterSpacing: '0.04em' }}>
          or <strong style={{ color: AUGUSTA_GOLD }}>$89.99/year</strong> · save $66
        </div>

        <button
          onClick={() => alert('Stripe checkout coming soon. For early access, ping Matt for an invite code.')}
          style={{
            marginTop: 18, width: '100%', padding: '15px 14px', borderRadius: 12,
            background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
            color: '#1A1000', border: 'none',
            fontWeight: 900, fontSize: 15, cursor: 'pointer',
            fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '0.04em',
            textTransform: 'uppercase',
            boxShadow: '0 4px 14px rgba(201,160,64,0.40), inset 0 1px 0 rgba(255,255,255,0.50)',
            WebkitTapHighlightColor: 'transparent',
          }}>
          Upgrade to Elite
        </button>
        <div style={{
          fontSize: 9, letterSpacing: '0.18em', color: 'rgba(241,231,200,0.45)',
          marginTop: 12, fontWeight: 700,
          fontFamily: '"Arial Black", Arial, sans-serif',
        }}>NO. {String(Date.now()).slice(-6)} · CHARTER MEMBER</div>
      </div>

      <div style={{
        textAlign: 'center', fontSize: 11, color: 'rgba(241,231,200,0.50)',
        lineHeight: 1.6, position: 'relative', zIndex: 1,
      }}>
        Current tier: <strong style={{ color: AUGUSTA_CREAM, letterSpacing: '0.02em' }}>{current}</strong>
        <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(241,231,200,0.40)' }}>
          Free users keep access to every standalone Match feature — GPS, scoring,<br/>head-to-head records, and Eagle Eye.
        </div>
      </div>
    </div>
  )
}

// Centered three-diamond gold flourish + flanking hairline rules. Used
// as a section divider on the paywall to mark editorial transitions
// (hero → benefits → pricing).
function FlourishDivider() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, margin: '12px 0 24px',
      position: 'relative', zIndex: 1,
    }}>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.55))' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="6" height="6" viewBox="0 0 6 6"><polygon points="3,0 6,3 3,6 0,3" fill="#C9A040" opacity="0.6" /></svg>
        <svg width="8" height="8" viewBox="0 0 8 8"><polygon points="4,0 8,4 4,8 0,4" fill="#E8C05A" /></svg>
        <svg width="6" height="6" viewBox="0 0 6 6"><polygon points="3,0 6,3 3,6 0,3" fill="#C9A040" opacity="0.6" /></svg>
      </div>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(201,160,64,0.55), transparent)' }} />
    </div>
  )
}

// ─── LeaguesHub — list of my leagues ────────────────────────────────────
function LeaguesHub({ isElite, onOpen, onCreate, on402, isDesktop = false }) {
  // Desktop breakout: center the column and lay the league cards out in a
  // responsive grid that uses the width, instead of one stretched phone-width
  // column. Mobile is unchanged. (2026-06-26)
  const centerCol = isDesktop
    ? { maxWidth: 1120, marginLeft: 'auto', marginRight: 'auto', width: '100%', boxSizing: 'border-box' }
    : null
  const cardWrap = isDesktop
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }
    : { display: 'flex', flexDirection: 'column', gap: 12 }
  const [leagues, setLeagues] = useState(null)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    api('/api/leagues')
      .then(d => { if (!cancelled) setLeagues(d.leagues || []) })
      .catch(err => {
        if (cancelled) return
        if (err?.status === 402) on402?.(err.payload)
        else setError(err?.message || 'Could not load leagues')
      })
    return () => { cancelled = true }
  }, [on402])

  if (error) {
    return <div style={hubBase}>
      <div style={{ color: '#F87171', textAlign: 'center', padding: 40, fontSize: 13 }}>{error}</div>
    </div>
  }

  return (
    <div style={hubBase}>
      {/* Round 31 audit — tap feedback for league cards. Without this
          the cards feel inert on touch. Augusta-grade UI requires
          visible response. */}
      <style>{`
        .tm-league-card:active {
          transform: scale(0.985);
          box-shadow: 0 1px 4px rgba(0,0,0,0.10) !important;
          border-color: rgba(201,160,64,0.55) !important;
        }
        @media (hover: hover) {
          .tm-league-card:hover {
            box-shadow: 0 4px 14px rgba(0,0,0,0.10) !important;
            border-color: rgba(201,160,64,0.50) !important;
          }
        }
      `}</style>
      <div style={{ padding: 'calc(var(--safe-top) + 20px) 20px 0', ...centerCol }}>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 4,
        }}>Leagues</div>
        <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.55)' }}>
          {leagues == null
            ? 'Loading…'
            : leagues.length === 0
              ? 'No leagues yet — create your first.'
              : `${leagues.length} league${leagues.length === 1 ? '' : 's'} on your roster.`}
        </div>
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, ...centerCol }}>
        {/* Round 7 audit fix — Create button is gold-outlined "Upgrade
            to create" for free users, primary green for Elite. The
            actual paywall flip happens in the parent's onCreate. */}
        <button onClick={onCreate}
          style={{
            padding: '14px 16px', borderRadius: 14, border: isElite ? 'none' : '1px solid rgba(201,160,64,0.50)',
            background: isElite
              ? 'linear-gradient(135deg, #1A6B28, #2E9E45)'
              : 'linear-gradient(135deg, rgba(245,215,138,0.20), rgba(201,160,64,0.10))',
            color: isElite ? '#fff' : '#7A5800',
            fontWeight: 800, fontSize: 15,
            boxShadow: isElite ? '0 4px 16px rgba(46,158,69,0.30)' : 'none',
            cursor: 'pointer',
          }}>
          {isElite ? '+ Create league' : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              {/* Bespoke 4-point burst (replaces ✨) — Augusta gold,
                  matches the rest of the icon system. */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 L13.5 9.5 L20 11 L13.5 12.5 L12 19 L10.5 12.5 L4 11 L10.5 9.5 Z" fill="currentColor"/>
              </svg>
              Upgrade to create a league
            </span>
          )}
        </button>
        {!isElite && (
          <div style={{
            fontSize: 11, color: 'rgba(13,31,18,0.55)',
            background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(13,31,18,0.08)',
            padding: '10px 12px', borderRadius: 10, lineHeight: 1.5,
          }}>
            You can still <strong>play in any league a friend invites you to</strong> — standings, schedules, and announcements are all visible. Hosting your own league requires The Match Elite ($7.50/mo annual).
          </div>
        )}

        {leagues == null ? (
          <div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
        ) : leagues.length === 0 ? (
          /* Round 32 audit — empty state shows three named templates
              instead of a flat dashed-border card. Each is a non-
              interactive preview (clicking still goes through Create)
              but they SHOW the host what's possible the moment they
              land. The bar is "ecstatic, not comfortable." */
          <div>
            <div style={{
              padding: '20px 20px 12px', textAlign: 'center',
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(201,160,64,0.30)', borderRadius: 14,
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 14, color: '#0E3B23', marginBottom: 4, fontWeight: 800 }}>
                {isElite ? 'Start your first league' : 'Leagues you can join'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.60)', lineHeight: 1.5 }}>
                {isElite
                  ? 'Pick a template below to start, or tap Create above to design your own.'
                  : 'Once a friend invites you to their league, it\'ll appear here.'}
              </div>
            </div>
            {isElite && [
              { name: 'Tuesday Night Skins',  format: 'skins',      detail: 'Weekly skins with carryover. Most leagues land here.' },
              { name: 'Member-Guest',         format: 'best_ball',  detail: '2-day team event. Best Ball formats supported.' },
              { name: 'Season Stroke Ladder', format: 'stableford', detail: 'Custom Stableford points across an entire season.' },
            ].map(tpl => (
              <button key={tpl.name} onClick={onCreate} style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '12px 14px', borderRadius: 12, marginBottom: 8,
                background: 'rgba(255,255,255,0.55)',
                border: '1px dashed rgba(201,160,64,0.40)',
                fontFamily: 'inherit',
                transition: 'background 120ms, border-color 120ms',
                WebkitTapHighlightColor: 'transparent',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0E3B23' }}>{tpl.name}</div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#7A5800', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{tpl.format.replace('_', ' ')}</div>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 3 }}>{tpl.detail}</div>
              </button>
            ))}
          </div>
        ) : (
         <div style={cardWrap}>
          {leagues.map(l => (
          /* Tournament-board card. Three-row anatomy:
              1. Top accent strip (gold gradient) → SEASON · FORMAT pills
              2. Middle: name + commissioner attribution
              3. Bottom: 3-column StatBlock row (Players / Events / Format) */
          <button key={l.id} onClick={() => onOpen(l.id)}
            className="tm-league-card"
            style={{
              textAlign: 'left', cursor: 'pointer',
              padding: 0, borderRadius: 16,
              background: 'linear-gradient(180deg, #FFFCF3 0%, #F4E9C4 100%)',
              border: '1px solid rgba(201,160,64,0.40)',
              boxShadow: '0 4px 14px rgba(13,31,18,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
              fontFamily: 'inherit',
              transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
              WebkitTapHighlightColor: 'transparent',
              overflow: 'hidden',
              position: 'relative',
            }}>
            {/* Top accent strip — gold gradient with season + format
                pills sitting on top. Sets the tournament-board feel
                immediately. */}
            <div style={{
              height: 32,
              background: 'linear-gradient(90deg, #C9A040 0%, #E8C05A 50%, #C9A040 100%)',
              padding: '0 14px',
              display: 'flex', alignItems: 'center',
              justifyContent: l.season ? 'space-between' : 'flex-end',
              borderBottom: '1px solid rgba(13,31,18,0.18)',
            }}>
              {l.season && (
                <div style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: '0.18em',
                  color: '#0E3B23', textTransform: 'uppercase',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  textShadow: '0 1px 0 rgba(255,255,255,0.30)',
                }}>SEASON · {l.season}</div>
              )}
              {l.scoring_format && (
                <div style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: '0.16em',
                  color: '#0E3B23', textTransform: 'uppercase',
                  padding: '3px 10px', borderRadius: 999,
                  background: 'rgba(14,59,35,0.12)',
                  border: '1px solid rgba(14,59,35,0.30)',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                }}>{l.scoring_format.replace('_', ' ')}</div>
              )}
            </div>
            {/* Body */}
            <div style={{ padding: '14px 16px 12px' }}>
              <div style={{
                fontSize: 18, fontWeight: 900, color: '#0E3B23',
                fontFamily: '"Georgia", serif', letterSpacing: '-0.01em',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                lineHeight: 1.15,
              }}>{l.name}</div>
              {l.commissioner_name && (
                <div style={{
                  fontSize: 10, color: 'rgba(13,31,18,0.55)', marginTop: 3,
                  letterSpacing: '0.04em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  Run by <strong style={{ color: '#7A5800', fontWeight: 700 }}>{l.commissioner_name}</strong>{l.commissioner_handle ? ` · @${l.commissioner_handle}` : ''}
                </div>
              )}
              {l.description && (
                <div style={{
                  fontSize: 11.5, color: 'rgba(13,31,18,0.65)', marginTop: 10,
                  lineHeight: 1.45, fontStyle: 'italic',
                  display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{l.description}</div>
              )}
              {/* Stat row — two compact blocks. Splits members + events
                  visually so the eye locks on the numbers. */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
                marginTop: 12,
              }}>
                <CardStatBlock label="Players" value={l.member_count || 0} />
                <CardStatBlock label="Events"  value={l.event_count || 0} />
              </div>
            </div>
            {/* Right-edge subtle chevron arrow — signals tappable. */}
            <div style={{
              position: 'absolute', top: 32, right: 8, bottom: 0,
              display: 'flex', alignItems: 'center',
              pointerEvents: 'none', color: 'rgba(13,31,18,0.20)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </button>
          ))}
         </div>
        )}
      </div>
    </div>
  )
}

const hubBase = {
  display: 'flex', flexDirection: 'column', height: '100%',
  background: `linear-gradient(180deg, #FFFDF8 0%, #F1E7C8 100%)`,
}

// ─── LeagueWizard — create a league ─────────────────────────────────────
function LeagueWizard({ onClose, onCreated, on402 }) {
  const [name, setName]     = useState('')
  const [season, setSeason] = useState('')
  const [scoringFormat, setScoringFormat] = useState('stroke')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function save() {
    if (name.trim().length === 0) {
      setError('Name is required.')
      return
    }
    setSaving(true); setError(null)
    try {
      const data = await post('/api/leagues', {
        name: name.trim(),
        season: season.trim() || null,
        scoring_format: scoringFormat,
        description: description.trim() || null,
      })
      onCreated(data.league)
    } catch (err) {
      if (err?.status === 402) on402?.(err.payload)
      else setError(err?.message || 'Could not create league')
    } finally {
      setSaving(false)
    }
  }

  // Format options with pictogram glyphs — turns the radio row into a
  // visual menu instead of generic chips.
  const FORMAT_OPTIONS = [
    { id: 'stroke',     label: 'Stroke',     desc: 'Lowest total wins' },
    { id: 'match',      label: 'Match',      desc: 'Hole-by-hole, head to head' },
    { id: 'skins',      label: 'Skins',      desc: 'Low score per hole, carryovers' },
    { id: 'stableford', label: 'Stableford', desc: 'Points per hole, custom map' },
    { id: 'best_ball',  label: 'Best Ball',  desc: 'Team format · best of N per hole' },
  ]

  return (
    <div style={{
      ...hubBase,
      padding: 0, paddingBottom: 80,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* HERO — 'Found a new league' ceremony header. Deep green block
          with trophy crest, overline, and italic tagline. Replaces the
          flat back-arrow + 'New league' text. */}
      <div style={{
        background: 'linear-gradient(160deg, #0E3B23 0%, #1A6B28 60%, #0E3B23 100%)',
        padding: 'calc(var(--safe-top) + 14px) 20px 22px',
        borderBottom: '2px solid #C9A040',
        position: 'relative', overflow: 'hidden',
      }}>
        <div aria-hidden style={{
          position: 'absolute', top: -50, right: -50, width: 220, height: 220,
          background: 'radial-gradient(circle, rgba(232,192,90,0.20) 0%, transparent 65%)',
          pointerEvents: 'none',
        }} />
        <button onClick={onClose} aria-label="Back" style={{
          background: 'rgba(241,231,200,0.08)', border: '1px solid rgba(241,231,200,0.20)',
          borderRadius: 999, width: 36, height: 36, color: '#F1E7C8',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 14, WebkitTapHighlightColor: 'transparent',
          position: 'relative',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          {/* Trophy crest in a smaller medallion */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            background: 'radial-gradient(circle at 50% 35%, rgba(245,215,138,0.30) 0%, rgba(201,160,64,0.10) 70%, transparent 100%)',
            border: '1.5px solid rgba(201,160,64,0.65)',
            boxShadow: 'inset 0 0 16px rgba(245,215,138,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8v4a4 4 0 0 1-8 0V4z" fill="rgba(232,192,90,0.20)"/>
              <path d="M8 6H6a2 2 0 0 0 2 2"/>
              <path d="M16 6h2a2 2 0 0 1-2 2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="10" y1="16" x2="14" y2="16"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.30em', color: '#C9A040',
              fontWeight: 800, textTransform: 'uppercase', marginBottom: 2,
              fontFamily: '"Arial Black", Arial, sans-serif',
            }}>FOUND A NEW LEAGUE</div>
            <div style={{
              fontSize: 26, fontWeight: 900, color: '#F1E7C8',
              fontFamily: '"Georgia", serif', letterSpacing: '-0.01em',
              lineHeight: 1.1,
              textShadow: '0 1px 2px rgba(0,0,0,0.35)',
            }}>{name.trim() ? name.trim() : 'Start a League'}</div>
            <div style={{
              fontSize: 11, color: 'rgba(241,231,200,0.65)', marginTop: 4,
              fontStyle: 'italic',
            }}>The four steps below — name, season, format, description — set how every event runs.</div>
          </div>
        </div>
      </div>

      {/* FORM — numbered steps with stepper indicator + bigger fields */}
      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <WizardStep n={1} title="Name your league"
          hint="What do players call it? Tuesday Night Skins, ABC Member-Guest, Office Ladder.">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Tuesday Night Skins"
            style={inputStyle} maxLength={80} autoFocus />
        </WizardStep>

        <WizardStep n={2} title="Season tag"
          hint="Group this and future events into one season. Optional but recommended for season-long standings.">
          <input value={season} onChange={e => setSeason(e.target.value)} placeholder="2026"
            style={inputStyle} maxLength={64} />
        </WizardStep>

        <WizardStep n={3} title="Default scoring format"
          hint="Hosts can override this on any single event. Most leagues pick one and stick with it.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FORMAT_OPTIONS.map(f => {
              const active = scoringFormat === f.id
              return (
                <button key={f.id} onClick={() => setScoringFormat(f.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 12,
                  border: active ? '1.5px solid #1A6B28' : '1px solid rgba(13,31,18,0.14)',
                  background: active
                    ? 'linear-gradient(135deg, rgba(46,158,69,0.14), rgba(46,158,69,0.06))'
                    : 'rgba(255,255,255,0.65)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  textAlign: 'left',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'all 120ms ease',
                  boxShadow: active ? '0 2px 8px rgba(46,158,69,0.18)' : 'none',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    border: active ? '6px solid #1A6B28' : '2px solid rgba(13,31,18,0.25)',
                    background: active ? '#FFF' : 'transparent',
                    transition: 'all 120ms ease',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 800, color: '#0E3B23',
                      letterSpacing: '0.02em',
                    }}>{f.label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 1 }}>{f.desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </WizardStep>

        <WizardStep n={4} title="Describe it (optional)"
          hint="Show this on the league page so players know what it's about.">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Weekly skins game at Pebble. $20 buy-in, winner-take-all, carryovers."
            style={{ ...inputStyle, resize: 'vertical' }} maxLength={500} />
        </WizardStep>

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 10, fontSize: 12,
            background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.40)',
            color: '#A03030',
          }}>{error}</div>
        )}

        {/* CHARTER button — ceremonial. Gold + green double-stroke. */}
        <button onClick={save} disabled={saving || name.trim().length === 0} style={{
          padding: '16px 14px', borderRadius: 14, border: 'none',
          background: name.trim().length > 0
            ? 'linear-gradient(135deg, #1A6B28 0%, #2E9E45 50%, #1A6B28 100%)'
            : 'rgba(13,31,18,0.15)',
          color: '#fff', fontWeight: 900, fontSize: 15,
          cursor: saving ? 'not-allowed' : (name.trim().length > 0 ? 'pointer' : 'default'),
          fontFamily: '"Arial Black", Arial, sans-serif',
          letterSpacing: '0.06em', textTransform: 'uppercase',
          opacity: saving ? 0.7 : 1,
          boxShadow: name.trim().length > 0
            ? '0 6px 20px rgba(46,158,69,0.35), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 0 0 1px rgba(201,160,64,0.45)'
            : 'none',
          marginTop: 4,
          WebkitTapHighlightColor: 'transparent',
        }}>
          {saving ? 'Chartering…' : 'Charter League'}
        </button>
        <div style={{
          fontSize: 10, color: 'rgba(13,31,18,0.45)', textAlign: 'center',
          letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 700,
        }}>You'll be the commissioner</div>
      </div>
    </div>
  )
}

// ─── WizardStep — numbered ceremonial section header for LeagueWizard ──
function WizardStep({ n, title, hint, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #C9A040 0%, #E8C05A 100%)',
          color: '#0E3B23', fontWeight: 900, fontSize: 13,
          fontFamily: '"Arial Black", Arial, sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 4px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,255,255,0.40)',
        }}>{n}</div>
        <div style={{ flex: 1, paddingTop: 2 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: '#0E3B23',
            letterSpacing: '0.01em',
          }}>{title}</div>
          {hint && (
            <div style={{
              fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 2,
              lineHeight: 1.4,
            }}>{hint}</div>
          )}
        </div>
      </div>
      <div style={{ paddingLeft: 36 }}>{children}</div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(13,31,18,0.18)',
  borderRadius: 10, color: '#0E3B23', boxSizing: 'border-box',
  fontFamily: 'inherit',
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#0E3B23', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  )
}

// ─── LeagueDetail — standings + events + members + commissioner controls ─
function LeagueDetail({ leagueId, onBack, on402, onCreateEvent, isDesktop = false }) {
  // Desktop breakout: center hero + tabs + content in a readable column rather
  // than stretching the standings table and roster across the full width. Keeps
  // the existing tab structure; mobile is unchanged. (2026-06-26)
  const detailCol = isDesktop
    ? { maxWidth: 920, marginLeft: 'auto', marginRight: 'auto', width: '100%', boxSizing: 'border-box' }
    : null
  const [data, setData]   = useState(null)   // { league, role }
  const [tab, setTab]     = useState('standings')   // 'standings' | 'events' | 'members'
  const [standings, setStandings] = useState(null)
  const [events, setEvents]       = useState(null)
  const [members, setMembers]     = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy]   = useState(false)

  useEffect(() => {
    let cancelled = false
    api(`/api/leagues/${leagueId}`)
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => {
        if (cancelled) return
        if (err?.status === 402) on402?.(err.payload)
        else setError(err?.message || 'Could not load league')
      })
    return () => { cancelled = true }
  }, [leagueId, on402])

  useEffect(() => {
    if (!data) return
    if (tab === 'standings' && standings == null) {
      api(`/api/leagues/${leagueId}/standings`)
        .then(d => setStandings(d))
        .catch(() => setStandings({ players: [], events_count: 0 }))
    } else if (tab === 'events' && events == null) {
      api(`/api/leagues/${leagueId}/events`)
        .then(d => setEvents(d.events || []))
        .catch(() => setEvents([]))
    } else if (tab === 'members' && members == null) {
      api(`/api/leagues/${leagueId}/members`)
        .then(d => setMembers(d.members || []))
        .catch(() => setMembers([]))
    }
  }, [tab, data, leagueId, standings, events, members])

  async function deleteLeague() {
    if (!data?.league) return
    const confirmed = window.confirm(
      `Delete "${data.league.name}"?\n\n` +
      `Members will be unenrolled and every event will become a standalone match. ` +
      `This can't be undone.`
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await del(`/api/leagues/${leagueId}`)
      onBack()
    } catch (err) {
      alert(err?.message || 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div style={hubBase}><div style={{ color: '#F87171', textAlign: 'center', padding: 40, fontSize: 13 }}>{error}</div></div>
  if (!data) return <div style={hubBase}><div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 40, fontSize: 13 }}>Loading…</div></div>

  const { league, role } = data
  const isCommissioner = role === 'commissioner'

  return (
    <div style={hubBase}>
      {/* HERO HEADER — broadcast-board feel for the league. Replaces
          the previous flat back-arrow + name layout. Spectator/commish
          opens this and sees a real surface, not a placeholder.
          (Visual polish pass — May 2026.) */}
      <div style={{
        padding: 'calc(var(--safe-top) + 14px) 20px 14px',
        background: 'linear-gradient(160deg, #0E3B23 0%, #1A6B28 55%, #0E3B23 100%)',
        borderBottom: '2px solid #C9A040',
        position: 'relative', overflow: 'hidden',
        flexShrink: 0, ...detailCol,
      }}>
        {/* Subtle radial highlight in the top-right — adds depth. */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 180, height: 180,
          background: 'radial-gradient(circle, rgba(201,160,64,0.18) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        {/* Top row: back + commissioner pill (if applicable). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, position: 'relative' }}>
          <button onClick={onBack} aria-label="Back" style={{
            background: 'rgba(241,231,200,0.08)', border: '1px solid rgba(241,231,200,0.20)',
            borderRadius: 999, width: 36, height: 36, color: '#F1E7C8',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          {isCommissioner && (
            <div style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.18em',
              color: '#C9A040', textTransform: 'uppercase',
              padding: '4px 10px', borderRadius: 999,
              background: 'rgba(201,160,64,0.14)', border: '1px solid rgba(201,160,64,0.45)',
            }}>Commissioner</div>
          )}
        </div>
        {/* Season tag overline */}
        {league.season && (
          <div style={{
            fontSize: 10, letterSpacing: '0.30em', color: '#C9A040',
            fontWeight: 800, textTransform: 'uppercase', marginBottom: 4,
            position: 'relative',
          }}>SEASON · {league.season}</div>
        )}
        {/* League name — large serif headline */}
        <div style={{
          fontSize: 26, fontWeight: 900, lineHeight: 1.1,
          color: '#F1E7C8', fontFamily: '"Georgia", serif',
          letterSpacing: '-0.01em',
          textShadow: '0 1px 2px rgba(0,0,0,0.35)',
          position: 'relative',
          marginBottom: league.description ? 6 : 12,
        }}>{league.name}</div>
        {league.description && (
          <div style={{
            fontSize: 12, color: 'rgba(241,231,200,0.75)', lineHeight: 1.45,
            marginBottom: 12, fontStyle: 'italic', position: 'relative',
          }}>{league.description}</div>
        )}
        {/* Stat tile row — Players · Events · Format */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: league.scoring_format ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
          gap: 8, marginBottom: 4, position: 'relative',
        }}>
          <StatTilePill label="Players" value={league.member_count || 0} />
          <StatTilePill label="Events"  value={league.event_count || 0} />
          {league.scoring_format && (
            <StatTilePill label="Format" value={league.scoring_format.replace('_', ' ').toUpperCase()} small />
          )}
        </div>
        {/* Banner sits BELOW the hero, in dark style. */}
        <LeagueAnnouncementBanner league={league} hero />
      </div>

      {/* Tab bar — Rules + Comms tabs only render for the commissioner.
          Round 19 audit fix: role=tablist + aria-selected so screen
          readers announce the tab state correctly. */}
      <div role="tablist" aria-label="League sections" style={{ display: 'flex', gap: 6, padding: '0 20px', flexShrink: 0, flexWrap: 'wrap', ...detailCol }}>
        {[
          { id: 'standings', label: 'Standings' },
          { id: 'events',    label: `Events (${league.event_count || 0})` },
          { id: 'members',   label: `Roster (${league.member_count || 0})` },
          ...(isCommissioner ? [
            { id: 'rules', label: 'Rules' },
            { id: 'comms', label: 'Comms' },
          ] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            style={{
            flex: '1 1 30%', minWidth: 80, padding: '8px 6px', borderRadius: 10,
            background: tab === t.id ? 'rgba(46,158,69,0.10)' : 'rgba(255,255,255,0.5)',
            border: '1px solid', borderColor: tab === t.id ? '#1A6B28' : 'rgba(13,31,18,0.10)',
            color: tab === t.id ? '#0E3B23' : 'rgba(13,31,18,0.55)',
            fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="page-scroll" style={{ padding: '14px 20px', flex: 1, ...detailCol }}>
        {tab === 'standings' && (
          <StandingsView standings={standings} />
        )}
        {tab === 'events' && (
          <EventsView
            events={events}
            isCommissioner={isCommissioner}
            onCreateEvent={() => onCreateEvent?.(leagueId)}
          />
        )}
        {tab === 'members' && (
          <MembersView members={members} isCommissioner={isCommissioner} commissionerId={league.commissioner_id} leagueId={leagueId}
            onRefresh={() => setMembers(null)} />
        )}
        {tab === 'rules' && isCommissioner && (
          <LeagueRulesEditor
            leagueId={leagueId}
            league={league}
            onSaved={(updated) => setData(d => d ? { ...d, league: { ...d.league, ...updated } } : d)}
          />
        )}
        {tab === 'comms' && isCommissioner && (
          <LeagueCommsTab
            leagueId={leagueId}
            league={league}
          />
        )}

        {/* Commissioner cross-event tools — visible on every tab so they're
            always one tap away. Danger zone (delete) at the very bottom. */}
        {isCommissioner && (
          <div style={{
            marginTop: 24, padding: '12px 14px', borderRadius: 12,
            background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(13,31,18,0.10)',
          }}>
            <div style={{ fontSize: 10, color: '#7A5800', fontWeight: 800, letterSpacing: '0.10em', marginBottom: 6 }}>
              CROSS-EVENT TOOLS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button onClick={async () => {
                try {
                  const res = await fetch(`/api/leagues/${leagueId}/export.csv`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('tm_token')}` },
                  })
                  if (!res.ok) throw new Error(`Export failed (${res.status})`)
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = `league-${leagueId}.csv`
                  document.body.appendChild(a); a.click(); a.remove()
                  URL.revokeObjectURL(url)
                } catch (err) { alert(err?.message || 'Export failed') }
              }} style={{
                padding: '7px 12px', borderRadius: 8,
                background: 'rgba(245,215,138,0.15)', border: '1px solid rgba(201,160,64,0.45)',
                color: '#7A5800', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Season CSV
                </span>
              </button>
              <button onClick={() => setTab('audit')} style={{
                padding: '7px 12px', borderRadius: 8,
                background: 'rgba(46,158,69,0.10)', border: '1px solid rgba(26,107,40,0.40)',
                color: '#1A6B28', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="1"/>
                    <line x1="7" y1="9" x2="17" y2="9"/>
                    <line x1="7" y1="13" x2="17" y2="13"/>
                    <line x1="7" y1="17" x2="13" y2="17"/>
                  </svg>
                  League audit log
                </span>
              </button>
            </div>
          </div>
        )}

        {tab === 'audit' && isCommissioner && (
          <LeagueAuditLog leagueId={leagueId} />
        )}

        {/* Commissioner controls — danger zone */}
        {isCommissioner && (
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 12,
            background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.25)',
          }}>
            <div style={{ fontSize: 11, color: '#A03030', fontWeight: 800, letterSpacing: '0.06em', marginBottom: 4 }}>
              COMMISSIONER · DANGER
            </div>
            <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.65)', marginBottom: 8, lineHeight: 1.4 }}>
              Deleting a league unenrolls every member and detaches every event (which become standalone matches). Cannot be undone.
            </div>
            <button onClick={deleteLeague} disabled={busy} style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.50)',
              background: 'rgba(248,113,113,0.10)', color: '#A03030',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              opacity: busy ? 0.5 : 1,
            }}>{busy ? 'Deleting…' : 'Delete league'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

function StandingsView({ standings }) {
  if (!standings) return <div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
  if (!standings.players?.length) {
    return (
      <div style={{
        padding: '32px 20px', textAlign: 'center',
        background: 'rgba(255,255,255,0.6)',
        border: '1px dashed rgba(27,94,59,0.35)', borderRadius: 14,
      }}>
        <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.65)', marginBottom: 4, fontWeight: 700 }}>
          {standings.events_count > 0 ? 'No completed events with scores yet.' : 'No events played yet.'}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', lineHeight: 1.5 }}>
          Create an event from your Match tab and tag it to this league. Once it ends, standings populate here.
        </div>
      </div>
    )
  }
  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: '36px 1fr 40px 36px 50px',
        gap: 8, padding: '6px 8px', borderBottom: '1px solid rgba(13,31,18,0.10)',
      }}>
        <div style={hdr}>POS</div>
        <div style={hdr}>PLAYER</div>
        <div style={{ ...hdr, textAlign: 'center' }}>WIN</div>
        <div style={{ ...hdr, textAlign: 'center' }}>T3</div>
        <div style={{ ...hdr, textAlign: 'center' }}>AVG</div>
      </div>
      {(() => {
        // Round 15 audit fix — assign tied positions ('T1', 'T2', etc.)
        // when consecutive players match on wins/top3/avg. Previously
        // every row got a sequential rank regardless of ties, which is
        // misleading for a league that finishes a season with two
        // players on identical records.
        const tieKey = p => `${p.wins}|${p.top3}|${p.avg_score ?? 'x'}`
        const positions = []
        let lastKey = null, lastPos = 0
        standings.players.forEach((p, i) => {
          const k = tieKey(p)
          if (k !== lastKey) { lastPos = i + 1; lastKey = k }
          positions.push(lastPos)
        })
        // Count how many players share each position number so we can
        // prefix 'T' when tied.
        const counts = positions.reduce((m, v) => { m[v] = (m[v] || 0) + 1; return m }, {})
        return standings.players.map((p, i) => {
          const pos = positions[i]
          const tied = counts[pos] > 1
          const posStr = tied ? `T${pos}` : String(pos)
          const isLeader = pos === 1
          return (
            <div key={p.user_id} style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 40px 36px 50px',
              gap: 8, padding: '10px 8px', alignItems: 'center',
              borderBottom: '1px solid rgba(13,31,18,0.06)',
              background: isLeader ? 'rgba(201,160,64,0.10)' : 'transparent',
            }}>
              <div style={{
                fontWeight: 900, color: isLeader ? '#7A5800' : '#0E3B23',
                fontSize: tied ? 11 : 13,
              }}>{posStr}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0E3B23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                {p.handle && <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.55)' }}>@{p.handle} · {p.played} played</div>}
              </div>
              <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 900, color: isLeader ? '#7A5800' : '#0E3B23' }}>{p.wins}</div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(13,31,18,0.65)' }}>{p.top3}</div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(13,31,18,0.65)' }}>{p.avg_score ?? '—'}</div>
            </div>
          )
        })
      })()}
    </div>
  )
}

function EventsView({ events, isCommissioner, onCreateEvent }) {
  if (events == null) return <div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isCommissioner && (
        <button onClick={onCreateEvent} style={{
          padding: '11px 14px', borderRadius: 12,
          background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
          color: '#fff', border: 'none',
          fontWeight: 800, fontSize: 13, cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 2px 10px rgba(46,158,69,0.30)',
        }}>+ New event in this league</button>
      )}
      {events.length === 0 && (
        <div style={{
          padding: '24px 20px', textAlign: 'center',
          background: 'rgba(255,255,255,0.6)',
          border: '1px dashed rgba(27,94,59,0.35)', borderRadius: 14,
        }}>
          <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.65)', marginBottom: 4, fontWeight: 700 }}>No events yet</div>
          <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', lineHeight: 1.5 }}>
            {isCommissioner
              ? 'Tap the button above to create the first one — it auto-attaches to this league.'
              : 'The commissioner hasn\'t created the first event yet.'}
          </div>
        </div>
      )}
      {events.map(e => (
        <div key={e.id} style={{
          padding: '10px 12px', borderRadius: 10,
          background: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(201,160,64,0.20)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: '#0E3B23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
            <div style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
              background: e.status === 'closed' ? 'rgba(201,160,64,0.18)'
                : e.status === 'cancelled' ? 'rgba(248,113,113,0.18)'
                : 'rgba(46,158,69,0.18)',
              color: e.status === 'closed' ? '#7A5800'
                : e.status === 'cancelled' ? '#A03030'
                : '#1A6B28',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>{e.status}</div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 2 }}>
            {e.course_name || 'TBD'}{e.course_par ? ` · Par ${e.course_par}` : ''}{e.code ? ` · ${e.code}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

function MembersView({ members, isCommissioner, commissionerId, leagueId, onRefresh }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!adding) return
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const data = await api(`/api/friends/search?q=${encodeURIComponent(q)}`)
        setResults(data?.users || [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [query, adding])

  async function addUser(uid) {
    try {
      await post(`/api/leagues/${leagueId}/members`, { user_id: uid, role: 'player' })
      setAdding(false); setQuery(''); setResults([])
      onRefresh?.()
    } catch (err) {
      alert(err?.message || 'Could not add')
    }
  }

  async function removeUser(uid, name) {
    if (!window.confirm(`Remove ${name} from the league?`)) return
    try {
      await del(`/api/leagues/${leagueId}/members/${uid}`)
      onRefresh?.()
    } catch (err) {
      alert(err?.message || 'Could not remove')
    }
  }

  if (members == null) return <div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
  return (
    <div>
      {isCommissioner && (
        <div style={{ marginBottom: 14 }}>
          {!adding ? (
            <button onClick={() => setAdding(true)} style={{
              padding: '8px 14px', borderRadius: 999,
              background: 'rgba(46,158,69,0.10)', border: '1px solid rgba(26,107,40,0.40)',
              color: '#1A6B28', fontSize: 12, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>+ Add player</button>
          ) : (
            <div style={{
              padding: 10, borderRadius: 12,
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(13,31,18,0.10)',
            }}>
              <input
                value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search by name or @handle"
                style={{ ...inputStyle, marginBottom: results.length > 0 ? 8 : 0 }}
                autoFocus
              />
              {searching && <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', padding: '6px 4px' }}>Searching…</div>}
              {results.map(u => (
                <button key={u.id} onClick={() => addUser(u.id)} style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                  background: 'transparent', border: '1px solid rgba(13,31,18,0.08)',
                  marginTop: 4, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0E3B23' }}>{u.name}</div>
                  {u.handle && <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)' }}>@{u.handle}</div>}
                </button>
              ))}
              <button onClick={() => { setAdding(false); setQuery(''); setResults([]) }} style={{
                marginTop: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700,
                background: 'transparent', border: 'none', color: 'rgba(13,31,18,0.55)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
            </div>
          )}
        </div>
      )}
      {members.map(m => {
        const isComm = String(m.user_id) === String(commissionerId)
        return (
          <div key={m.user_id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderBottom: '1px solid rgba(13,31,18,0.06)',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(46,158,69,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#1A6B28', fontWeight: 800, fontSize: 14, flexShrink: 0,
            }}>{(m.name || '?').slice(0, 1).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0E3B23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)' }}>
                {m.handle ? `@${m.handle}` : ''}
                {m.handicap != null ? `${m.handle ? ' · ' : ''}HCP ${m.handicap}` : ''}
                {isComm ? ` · COMMISSIONER` : ''}
              </div>
            </div>
            {isCommissioner && !isComm && (
              <button onClick={() => removeUser(m.user_id, m.name)} style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 800, fontFamily: 'inherit',
                background: 'transparent', border: '1px solid rgba(248,113,113,0.40)',
                borderRadius: 999, color: '#A03030', cursor: 'pointer',
              }}>Remove</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

const hdr = {
  fontSize: 9, fontWeight: 800, color: 'rgba(13,31,18,0.55)',
  letterSpacing: '0.08em', textTransform: 'uppercase',
}

// ─── CardStatBlock — light-mode stat tile for LeaguesHub league cards ──
// Distinct from StatTilePill (dark-on-dark for the hero). This one sits
// on the cream gradient of the league card with green Augusta typography.
function CardStatBlock({ label, value }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.55)',
      border: '1px solid rgba(13,31,18,0.10)',
      borderRadius: 8, padding: '7px 10px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{
        fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: '#7A5800', fontWeight: 800,
      }}>{label}</div>
      <div style={{
        fontSize: 17, fontWeight: 900, color: '#0E3B23',
        fontFamily: '"Arial Black", Arial, sans-serif', lineHeight: 1,
      }}>{value}</div>
    </div>
  )
}

// ─── StatTilePill — small inline KPI tile for the LeagueDetail hero ─────
function StatTilePill({ label, value, small = false }) {
  return (
    <div style={{
      background: 'rgba(241,231,200,0.08)',
      border: '1px solid rgba(241,231,200,0.18)',
      borderRadius: 10, padding: '8px 10px',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      gap: 2,
    }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase',
        color: 'rgba(201,160,64,0.85)', fontWeight: 800,
      }}>{label}</div>
      <div style={{
        fontSize: small ? 12 : 18, fontWeight: 900, color: '#F1E7C8',
        fontFamily: '"Arial Black", Arial, sans-serif',
        letterSpacing: small ? '0.04em' : '0',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}>{value}</div>
    </div>
  )
}

// ─── LeagueAnnouncementBanner — pinned latest, visible to ALL members ──
function LeagueAnnouncementBanner({ league, hero = false }) {
  const list = Array.isArray(league?.config?.announcements) ? league.config.announcements : []
  const latest = list[0]
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    setDismissed(false)
    if (!latest?.id) return
    try {
      const seen = localStorage.getItem(`tm_league_announce_seen_${league.id}`)
      if (seen === latest.id) setDismissed(true)
    } catch { /* ignore */ }
  }, [league?.id, latest?.id])
  if (!latest || dismissed) return null

  function whenStr(iso) {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    if (min < 1440) return `${Math.floor(min / 60)}h ago`
    return `${Math.floor(min / 1440)}d ago`
  }

  // Banner adapts based on whether it's inside the dark hero or
  // floating on a light surface. (Visual polish.)
  const palette = hero ? {
    bg: 'rgba(0,0,0,0.30)',
    border: '1px solid rgba(201,160,64,0.45)',
    iconBg: 'rgba(201,160,64,0.30)',
    iconBorder: '1px solid rgba(201,160,64,0.55)',
    iconStroke: '#F5D78A',
    overline: '#F5D78A',
    timestamp: 'rgba(241,231,200,0.55)',
    body: 'rgba(241,231,200,0.92)',
    closeBtn: 'rgba(241,231,200,0.55)',
  } : {
    bg: 'linear-gradient(135deg, rgba(245,215,138,0.18), rgba(201,160,64,0.10))',
    border: '1px solid rgba(245,215,138,0.50)',
    iconBg: 'rgba(201,160,64,0.20)',
    iconBorder: '1px solid rgba(201,160,64,0.35)',
    iconStroke: '#7A5800',
    overline: '#7A5800',
    timestamp: 'rgba(13,31,18,0.45)',
    body: '#0E3B23',
    closeBtn: 'rgba(13,31,18,0.45)',
  }
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 12,
      background: palette.bg, border: palette.border,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
        background: palette.iconBg, border: palette.iconBorder,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: 1,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={palette.iconStroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l18-5v12L3 13z"/>
          <path d="M11.6 16.8a3 3 0 1 1 -5.2 3"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: palette.overline, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            {latest.posted_by_name || 'Commissioner'}
          </span>
          <span style={{ fontSize: 9, color: palette.timestamp }}>· {whenStr(latest.posted_at)}</span>
        </div>
        <div style={{ fontSize: 12, color: palette.body, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{latest.text}</div>
      </div>
      <button
        onClick={() => {
          try { localStorage.setItem(`tm_league_announce_seen_${league.id}`, latest.id) } catch { /* ignore */ }
          setDismissed(true)
        }}
        aria-label="Dismiss"
        style={{
          background: 'transparent', border: 'none',
          color: palette.closeBtn, fontSize: 16, cursor: 'pointer',
          padding: '0 4px', lineHeight: 1, flexShrink: 0,
        }}>✕</button>
    </div>
  )
}

// ─── LeagueAuditLog — paginated cross-event audit ────────────────────────
function LeagueAuditLog({ leagueId }) {
  const [entries, setEntries] = useState(null)
  const [cursor, setCursor]   = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api(`/api/leagues/${leagueId}/audit?limit=50`)
      .then(d => { if (!cancelled) { setEntries(d?.entries || []); setCursor(d?.next_cursor || null) } })
      .catch(() => { if (!cancelled) setEntries([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [leagueId])

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const d = await api(`/api/leagues/${leagueId}/audit?limit=50&cursor=${encodeURIComponent(cursor)}`)
      setEntries(prev => [...(prev || []), ...(d?.entries || [])])
      setCursor(d?.next_cursor || null)
    } catch {/* keep cursor non-null so user can retry */}
    finally { setLoading(false) }
  }

  function whenStr(iso) {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    if (min < 1440) return `${Math.floor(min / 60)}h ago`
    return `${Math.floor(min / 1440)}d ago`
  }

  if (entries == null) return <div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
  if (entries.length === 0) {
    return (
      <div style={{
        padding: '24px 20px', textAlign: 'center', marginTop: 12,
        background: 'rgba(255,255,255,0.6)',
        border: '1px dashed rgba(27,94,59,0.35)', borderRadius: 14,
      }}>
        <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.65)' }}>No score corrections yet across any event.</div>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', color: 'rgba(13,31,18,0.55)', textTransform: 'uppercase', marginBottom: 8 }}>
        League audit · {entries.length} change{entries.length === 1 ? '' : 's'}
      </div>
      {entries.map(e => (
        <div key={e.id} style={{
          padding: '8px 10px', borderRadius: 8, marginBottom: 4,
          background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(13,31,18,0.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0E3B23' }}>
              {e.outing_name || `Event ${e.outing_id}`} · Hole {Number(e.hole) + 1}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.45)' }}>{whenStr(e.created_at)}</div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.60)', marginTop: 2 }}>
            {e.old_score == null ? 'Set to' : `${e.old_score} →`} <strong style={{ color: '#7A5800' }}>{e.new_score}</strong>
            {e.edited_by_name ? ` · by ${e.edited_by_name}` : ''}
          </div>
        </div>
      ))}
      {cursor && (
        <button onClick={loadMore} disabled={loading} style={{
          width: '100%', padding: 10, borderRadius: 10, marginTop: 4,
          background: 'rgba(245,215,138,0.15)', border: '1px solid rgba(201,160,64,0.40)',
          color: '#7A5800', fontSize: 11, fontWeight: 800, cursor: 'pointer',
          fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
        }}>{loading ? 'Loading…' : 'Load more · 50 older'}</button>
      )}
    </div>
  )
}

// ─── LeagueRulesEditor — set defaults that cascade to every event ────────
// Stores rules on league.config (handicap_allowance, stableford_preset,
// stableford_points, no_show_policy) plus league.scoring_format. The
// CreateWizard reads these on mount when pendingLeagueId is set, so the
// commissioner only configures rules once and every event inherits.
function LeagueRulesEditor({ leagueId, league, onSaved }) {
  const initialFormat   = league.scoring_format || 'stroke'
  const initialCfg      = (league.config && typeof league.config === 'object') ? league.config : {}
  const [scoringFormat, setScoringFormat] = useState(initialFormat)
  const [allowance, setAllowance]   = useState(Number.isFinite(Number(initialCfg.handicap_allowance)) ? Number(initialCfg.handicap_allowance) : 100)
  const [preset, setPreset]         = useState(initialCfg.stableford_preset || 'standard')
  const [customPts, setCustomPts]   = useState(initialCfg.stableford_points || { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 })
  const [noShow, setNoShow]         = useState(initialCfg.no_show_policy || 'dns')
  const [expectedPlayers, setExpectedPlayers] = useState(Number.isFinite(Number(initialCfg.expected_players)) ? Number(initialCfg.expected_players) : '')
  const [saving, setSaving]         = useState(false)
  const [savedAt, setSavedAt]       = useState(null)
  const [error, setError]           = useState(null)

  async function save() {
    setSaving(true); setError(null)
    try {
      const cfg = {
        ...initialCfg,
        handicap_allowance: Math.max(1, Math.min(100, Math.round(Number(allowance) || 100))),
        stableford_preset:  preset,
        stableford_points:  preset === 'custom' ? customPts : null,
        no_show_policy:     noShow,
      }
      const expN = Number(expectedPlayers)
      if (Number.isFinite(expN) && expN >= 2 && expN <= 150) cfg.expected_players = Math.round(expN)
      else delete cfg.expected_players

      const data = await put(`/api/leagues/${leagueId}`, {
        scoring_format: scoringFormat,
        config: cfg,
      })
      onSaved?.(data?.league || {})
      setSavedAt(Date.now())
    } catch (err) {
      setError(err?.message || 'Could not save rules')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.65)', marginBottom: 12, lineHeight: 1.45 }}>
        These rules cascade <strong>down to every new event</strong> in this league. Hosts can override on any single event without changing the league default.
      </div>

      {/* Default scoring format */}
      <RulesSection title="Default scoring format">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            { id: 'stroke', label: 'Stroke' },
            { id: 'match', label: 'Match' },
            { id: 'skins', label: 'Skins' },
            { id: 'stableford', label: 'Stableford' },
            { id: 'best_ball', label: 'Best Ball' },
          ].map(f => (
            <button key={f.id} onClick={() => setScoringFormat(f.id)} style={pill(scoringFormat === f.id)}>{f.label}</button>
          ))}
        </div>
      </RulesSection>

      {/* Handicap allowance */}
      <RulesSection title="Handicap allowance %">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[100, 95, 90, 85, 80, 75].map(v => (
            <button key={v} onClick={() => setAllowance(v)} style={pill(allowance === v)}>{v}%</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.55)', marginTop: 4 }}>
          100% = full handicap. Lower percentages tighten the field for tournament play.
        </div>
      </RulesSection>

      {/* Stableford preset (only when format includes stableford) */}
      {scoringFormat === 'stableford' && (
        <RulesSection title="Stableford preset">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              { id: 'standard', label: 'Standard' },
              { id: 'modified', label: 'Modified' },
              { id: 'custom',   label: 'Custom' },
            ].map(p => (
              <button key={p.id} onClick={() => setPreset(p.id)} style={pill(preset === p.id)}>{p.label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div style={{
              marginTop: 8, padding: 10, background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(13,31,18,0.10)', borderRadius: 10,
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
            }}>
              {[
                { key: 'double_eagle', label: 'Double Eagle (−3)' },
                { key: 'eagle',        label: 'Eagle (−2)' },
                { key: 'birdie',       label: 'Birdie (−1)' },
                { key: 'par',          label: 'Par' },
                { key: 'bogey',        label: 'Bogey (+1)' },
                { key: 'double',       label: 'Double (+2)' },
                { key: 'worse',        label: 'Triple+ (+3 or worse)' },
              ].map(b => (
                <label key={b.key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, padding: '6px 8px',
                  background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(13,31,18,0.08)',
                  borderRadius: 8,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#0E3B23' }}>{b.label}</span>
                  <input
                    type="number" step="1" min="-10" max="20"
                    value={customPts[b.key] ?? 0}
                    onChange={e => setCustomPts(prev => ({ ...prev, [b.key]: e.target.value === '' ? 0 : Number(e.target.value) }))}
                    style={{
                      width: 50, height: 28, textAlign: 'center', fontSize: 13, fontWeight: 800,
                      color: '#0E3B23', background: '#fff', border: '1px solid rgba(13,31,18,0.12)',
                      borderRadius: 6,
                    }}
                  />
                </label>
              ))}
            </div>
          )}
        </RulesSection>
      )}

      {/* No-show policy */}
      <RulesSection title="No-show policy">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            { id: 'dns',        label: 'DNS', sub: 'excluded' },
            { id: 'max_plus_2', label: 'Max +2', sub: 'par+2 every hole' },
            { id: 'manual',     label: 'Manual', sub: 'commissioner sets' },
          ].map(p => (
            <button key={p.id} onClick={() => setNoShow(p.id)} style={{
              ...pill(noShow === p.id),
              flex: '1 1 30%', minWidth: 90, textAlign: 'left',
              padding: '8px 10px',
            }}>
              <div>{p.label}</div>
              <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.7, marginTop: 2 }}>{p.sub}</div>
            </button>
          ))}
        </div>
      </RulesSection>

      {/* Expected players */}
      <RulesSection title="Expected players per event (optional)">
        <input
          type="number" inputMode="numeric" min={2} max={150}
          value={expectedPlayers}
          onChange={e => setExpectedPlayers(e.target.value)}
          placeholder="Leave blank for ad-hoc"
          style={{
            width: 100, padding: '8px 10px', fontSize: 14, fontWeight: 700,
            color: '#0E3B23', background: '#fff',
            border: '1px solid rgba(13,31,18,0.18)', borderRadius: 8,
            fontFamily: 'inherit',
          }}
        />
        <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.55)', marginTop: 4 }}>
          Past 4 players, foursomes auto-create. Leave blank to pick per event.
        </div>
      </RulesSection>

      {error && (
        <div style={{
          padding: '8px 10px', borderRadius: 8, fontSize: 11, marginBottom: 10,
          background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.40)',
          color: '#A03030',
        }}>{error}</div>
      )}
      <button onClick={save} disabled={saving} style={{
        width: '100%', padding: 12, borderRadius: 12, border: 'none',
        background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
        color: '#fff', fontWeight: 800, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', opacity: saving ? 0.6 : 1, marginTop: 4,
      }}>
        {saving ? 'Saving…' : savedAt ? '✓ Rules saved' : 'Save rules'}
      </button>
    </div>
  )
}

function RulesSection({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', color: '#0E3B23', textTransform: 'uppercase', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function pill(active) {
  return {
    padding: '7px 12px', borderRadius: 999, border: '1px solid',
    borderColor: active ? '#1A6B28' : 'rgba(13,31,18,0.18)',
    background: active ? 'rgba(46,158,69,0.10)' : 'rgba(255,255,255,0.7)',
    color: active ? '#0E3B23' : 'rgba(13,31,18,0.65)',
    fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  }
}

// ─── LeagueCommsTab — push announcements to every league member ──────────
// Distinct from the per-event Comms tab: this fans out to the whole
// league roster (not just one event's participants). Posts to
// /api/leagues/:id/announcement which logs the message and pushes.
function LeagueCommsTab({ leagueId, league }) {
  const [text, setText]     = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError]   = useState(null)
  const [history, setHistory] = useState(Array.isArray(league.config?.announcements) ? league.config.announcements : [])

  async function postAnnouncement() {
    const t = text.trim()
    if (t.length === 0) return
    if (t.length > 600) { setError('Too long (600 char max).'); return }
    setError(null); setPosting(true)
    try {
      const data = await post(`/api/leagues/${leagueId}/announcement`, { text: t })
      setHistory(data?.announcements || [])
      setText('')
    } catch (err) {
      setError(err?.message || 'Could not post')
    } finally {
      setPosting(false)
    }
  }

  function whenStr(iso) {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    if (min < 1440) return `${Math.floor(min / 60)}h ago`
    return `${Math.floor(min / 1440)}d ago`
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.65)', marginBottom: 8, lineHeight: 1.45 }}>
        Push a message to <strong>every player on the league roster</strong>. They get a push notification AND see it pinned on the league page.
      </div>
      <textarea
        value={text} onChange={e => setText(e.target.value)}
        placeholder="e.g. Week 6 is at Pebble. $30 buy-in. Tee off at 9am."
        rows={3} maxLength={600}
        style={{
          width: '100%', padding: 10, fontFamily: 'inherit', fontSize: 13,
          background: '#fff', border: '1px solid rgba(13,31,18,0.18)',
          borderRadius: 10, color: '#0E3B23', resize: 'vertical', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.40)' }}>{text.length} / 600</div>
        <button onClick={postAnnouncement} disabled={posting || text.trim().length === 0} style={{
          padding: '8px 14px', borderRadius: 12,
          background: text.trim().length > 0
            ? 'linear-gradient(135deg, #1A6B28, #2E9E45)'
            : 'rgba(13,31,18,0.10)',
          color: text.trim().length > 0 ? '#fff' : 'rgba(13,31,18,0.40)',
          border: 'none', fontWeight: 800, fontSize: 12, cursor: posting ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', opacity: posting ? 0.7 : 1,
        }}>
          {posting ? 'Posting…' : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11l18-5v12L3 13z"/>
                <path d="M11.6 16.8a3 3 0 1 1 -5.2 3"/>
              </svg>
              Post & notify
            </span>
          )}
        </button>
      </div>
      {error && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11,
          background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.40)',
          color: '#A03030',
        }}>{error}</div>
      )}
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', color: 'rgba(13,31,18,0.55)', textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>
        Recent announcements
      </div>
      {history.length === 0 ? (
        <div style={{ color: 'rgba(13,31,18,0.45)', textAlign: 'center', padding: 18, fontSize: 12, fontStyle: 'italic' }}>
          None yet.
        </div>
      ) : history.map(a => (
        <div key={a.id} style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 6,
          background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(13,31,18,0.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7A5800' }}>{a.posted_by_name || 'Commissioner'}</div>
            <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.45)' }}>{whenStr(a.posted_at)}</div>
          </div>
          <div style={{ fontSize: 13, color: '#0E3B23', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{a.text}</div>
        </div>
      ))}
    </div>
  )
}
