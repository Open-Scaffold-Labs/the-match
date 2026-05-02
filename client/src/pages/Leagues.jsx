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
export default function Leagues({ user, onCreateEventInLeague }) {
  // Two-stage tier check:
  //   1. If we already know the user (passed in by App), trust it.
  //   2. Listen to fetch failures with status 402; if any, fall through
  //      to paywall regardless of stale local user.tier.
  const [view, setView]     = useState('hub')         // 'hub' | 'detail' | 'create'
  const [activeLeagueId, setActiveLeagueId] = useState(null)
  const [paywall, setPaywall] = useState(null)        // null or { current, message }

  if (paywall || (user && user.tier !== 'elite')) {
    return <LeaguesPaywall current={user?.tier || 'free'} reason={paywall?.message} />
  }

  if (view === 'detail' && activeLeagueId) {
    return (
      <LeagueDetail
        leagueId={activeLeagueId}
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
      onOpen={(id) => { setActiveLeagueId(id); setView('detail') }}
      onCreate={() => setView('create')}
      on402={(payload) => setPaywall(payload || { current: 'free' })}
    />
  )
}

// ─── LeaguesPaywall — free-user upgrade screen ──────────────────────────
function LeaguesPaywall({ current = 'free', reason }) {
  const benefits = [
    { icon: '🏆', title: 'Season-long standings', body: 'Aggregate wins, top-3 finishes, and average score across every event.' },
    { icon: '📋', title: 'Persistent league rosters', body: 'No more re-inviting players for every match. The league knows who plays.' },
    { icon: '🎯', title: 'Commissioner controls', body: 'Set scoring rules once. Cancel rain-outs. Push announcements to the whole roster.' },
    { icon: '📊', title: 'CSV exports + history', body: 'Every event archived. Download standings any time for your records.' },
    { icon: '📡', title: 'Unlimited live leaderboards', body: 'Tee-box QR codes, public spectator boards, branded print sheets.' },
    { icon: '🤝', title: 'Up to 150 players per event', body: 'Foursomes auto-assigned. Bulk-foursome score entry. League-grade scale.' },
  ]

  return (
    <div style={{
      minHeight: '100dvh',
      background: `linear-gradient(180deg, ${AUGUSTA_GREEN} 0%, #0A2918 100%)`,
      color: AUGUSTA_CREAM,
      fontFamily: '"Georgia", serif',
      padding: 'calc(var(--safe-top) + 24px) 20px 80px',
      overflowY: 'auto',
    }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          fontSize: 10, letterSpacing: '0.30em', color: AUGUSTA_GOLD,
          fontWeight: 700, marginBottom: 6,
        }}>THE MATCH ELITE</div>
        <div style={{
          fontSize: 32, fontWeight: 900, letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 8,
        }}>Run real leagues</div>
        <div style={{ fontSize: 14, color: 'rgba(241,231,200,0.75)', lineHeight: 1.5 }}>
          Tournament-grade tools for commissioners running weekly leagues, member-guests, charity outings, or season-long ladders.
        </div>
        {reason && (
          <div style={{
            marginTop: 14, padding: '8px 12px', borderRadius: 10,
            background: 'rgba(248,180,113,0.12)', border: '1px solid rgba(248,180,113,0.40)',
            color: '#F8B471', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          }}>{reason}</div>
        )}
      </div>

      {/* Benefits grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {benefits.map(b => (
          <div key={b.title} style={{
            display: 'flex', gap: 12,
            padding: '14px 16px', borderRadius: 14,
            background: 'rgba(241,231,200,0.06)',
            border: '1px solid rgba(201,160,64,0.20)',
          }}>
            <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>{b.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: AUGUSTA_CREAM, marginBottom: 3 }}>{b.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(241,231,200,0.65)', lineHeight: 1.45 }}>{b.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Pricing card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(245,215,138,0.18), rgba(201,160,64,0.10))',
        border: '1px solid rgba(245,215,138,0.55)',
        borderRadius: 18,
        padding: '20px 18px',
        textAlign: 'center',
        marginBottom: 18,
      }}>
        <div style={{ fontSize: 11, color: AUGUSTA_GOLD, letterSpacing: '0.20em', fontWeight: 700, marginBottom: 6 }}>
          ELITE
        </div>
        <div style={{ fontSize: 36, fontWeight: 900, color: AUGUSTA_CREAM, lineHeight: 1 }}>
          $12.99<span style={{ fontSize: 14, color: 'rgba(241,231,200,0.60)' }}>/month</span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(241,231,200,0.55)', marginTop: 4 }}>
          or $89.99/year (save $66)
        </div>
        <button
          onClick={() => alert('Stripe checkout coming soon. For early access, ping Matt for an invite code.')}
          style={{
            marginTop: 16, width: '100%', padding: 14, borderRadius: 12,
            background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
            color: '#1A1000', border: 'none',
            fontWeight: 800, fontSize: 15, cursor: 'pointer',
            fontFamily: 'inherit', letterSpacing: '0.02em',
          }}>
          Upgrade to Elite
        </button>
      </div>

      <div style={{
        textAlign: 'center', fontSize: 11, color: 'rgba(241,231,200,0.45)',
        lineHeight: 1.6,
      }}>
        Current tier: <strong style={{ color: AUGUSTA_CREAM }}>{current}</strong> · Free users keep access to every standalone Match feature, GPS, scoring, head-to-head records, and Eagle Eye.
      </div>
    </div>
  )
}

// ─── LeaguesHub — list of my leagues ────────────────────────────────────
function LeaguesHub({ onOpen, onCreate, on402 }) {
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
      <div style={{ padding: 'calc(var(--safe-top) + 20px) 20px 0' }}>
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

      <div className="page-scroll" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button onClick={onCreate}
          style={{
            padding: '14px 16px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
            color: '#fff', fontWeight: 800, fontSize: 15,
            boxShadow: '0 4px 16px rgba(46,158,69,0.30)',
            cursor: 'pointer',
          }}>
          + Create league
        </button>

        {leagues == null ? (
          <div style={{ color: 'rgba(13,31,18,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
        ) : leagues.length === 0 ? (
          <div style={{
            padding: '32px 20px', textAlign: 'center',
            background: 'rgba(255,255,255,0.6)',
            border: '1px dashed rgba(27,94,59,0.35)', borderRadius: 14,
          }}>
            <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.65)', marginBottom: 8, fontWeight: 700 }}>No leagues yet</div>
            <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.55)', lineHeight: 1.5 }}>
              Create one for your Tuesday Night skins, your member-guest, or any season-long competition. Standings + roster + commissioner tools all live here.
            </div>
          </div>
        ) : leagues.map(l => (
          <button key={l.id} onClick={() => onOpen(l.id)}
            style={{
              textAlign: 'left', cursor: 'pointer',
              padding: '14px 16px', borderRadius: 14,
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(201,160,64,0.30)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              fontFamily: 'inherit',
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#0E3B23', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
              {l.season && (
                <div style={{ fontSize: 10, color: '#7A5800', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{l.season}</div>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 4, display: 'flex', gap: 12 }}>
              <span>{l.member_count || 0} player{(l.member_count || 0) === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{l.event_count || 0} event{(l.event_count || 0) === 1 ? '' : 's'}</span>
              {l.scoring_format && <><span>·</span><span style={{ textTransform: 'uppercase' }}>{l.scoring_format}</span></>}
            </div>
            {l.description && (
              <div style={{
                fontSize: 12, color: 'rgba(13,31,18,0.65)', marginTop: 8,
                lineHeight: 1.4, display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>{l.description}</div>
            )}
          </button>
        ))}
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

  return (
    <div style={{
      ...hubBase,
      padding: 'calc(var(--safe-top) + 16px) 20px 80px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', fontSize: 22,
          color: '#0E3B23', padding: '0 4px', cursor: 'pointer',
        }}>←</button>
        <div style={{ fontSize: 22, fontWeight: 900, color: '#0E3B23' }}>New league</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="League name *" hint="What do players call this league? Tuesday Night Skins, ABC Member-Guest, etc.">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Tuesday Night Skins"
            style={inputStyle} maxLength={80} autoFocus />
        </Field>
        <Field label="Season" hint="Optional — group this and future events into one season. Examples: '2026', '2026-spring'.">
          <input value={season} onChange={e => setSeason(e.target.value)} placeholder="2026"
            style={inputStyle} maxLength={64} />
        </Field>
        <Field label="Default scoring format" hint="Each event can override this when created.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              { id: 'stroke',     label: 'Stroke' },
              { id: 'match',      label: 'Match' },
              { id: 'skins',      label: 'Skins' },
              { id: 'stableford', label: 'Stableford' },
              { id: 'best_ball',  label: 'Best Ball' },
            ].map(f => (
              <button key={f.id} onClick={() => setScoringFormat(f.id)} style={{
                padding: '8px 12px', borderRadius: 999, border: '1px solid',
                borderColor: scoringFormat === f.id ? '#1A6B28' : 'rgba(13,31,18,0.18)',
                background: scoringFormat === f.id ? 'rgba(46,158,69,0.10)' : 'rgba(255,255,255,0.6)',
                color: scoringFormat === f.id ? '#0E3B23' : 'rgba(13,31,18,0.65)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>{f.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Description" hint="Optional — show on the league page so players know what it's about.">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Weekly skins game at Pebble. $20 buy-in, winner-take-all, carryovers."
            style={{ ...inputStyle, resize: 'vertical' }} maxLength={500} />
        </Field>
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 10, fontSize: 12,
            background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.40)',
            color: '#A03030',
          }}>{error}</div>
        )}
        <button onClick={save} disabled={saving || name.trim().length === 0} style={{
          padding: 14, borderRadius: 12, border: 'none',
          background: name.trim().length > 0
            ? 'linear-gradient(135deg, #1A6B28, #2E9E45)'
            : 'rgba(13,31,18,0.15)',
          color: '#fff', fontWeight: 800, fontSize: 15,
          cursor: saving ? 'not-allowed' : (name.trim().length > 0 ? 'pointer' : 'default'),
          fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Creating…' : 'Create league'}
        </button>
      </div>
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
function LeagueDetail({ leagueId, onBack, on402, onCreateEvent }) {
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
      {/* Header */}
      <div style={{ padding: 'calc(var(--safe-top) + 14px) 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button onClick={onBack} style={{
            background: 'transparent', border: 'none', fontSize: 22,
            color: '#0E3B23', padding: '0 4px', cursor: 'pointer',
          }}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 22, fontWeight: 900, color: '#0E3B23',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{league.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 2 }}>
              {league.season ? `${league.season} · ` : ''}
              {league.member_count || 0} player{(league.member_count || 0) === 1 ? '' : 's'} · {league.event_count || 0} event{(league.event_count || 0) === 1 ? '' : 's'}
              {isCommissioner ? ' · COMMISSIONER' : ''}
            </div>
          </div>
        </div>
        {league.description && (
          <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.65)', lineHeight: 1.5, marginTop: 6 }}>
            {league.description}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, padding: '0 20px', flexShrink: 0 }}>
        {[
          { id: 'standings', label: 'Standings' },
          { id: 'events',    label: `Events (${league.event_count || 0})` },
          { id: 'members',   label: `Roster (${league.member_count || 0})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '8px 6px', borderRadius: 10,
            background: tab === t.id ? 'rgba(46,158,69,0.10)' : 'rgba(255,255,255,0.5)',
            border: '1px solid', borderColor: tab === t.id ? '#1A6B28' : 'rgba(13,31,18,0.10)',
            color: tab === t.id ? '#0E3B23' : 'rgba(13,31,18,0.55)',
            fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="page-scroll" style={{ padding: '14px 20px', flex: 1 }}>
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

        {/* Commissioner controls — danger zone */}
        {isCommissioner && (
          <div style={{
            marginTop: 24, padding: '12px 14px', borderRadius: 12,
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
        display: 'grid', gridTemplateColumns: '32px 1fr 40px 36px 50px',
        gap: 8, padding: '6px 8px', borderBottom: '1px solid rgba(13,31,18,0.10)',
      }}>
        <div style={hdr}>POS</div>
        <div style={hdr}>PLAYER</div>
        <div style={{ ...hdr, textAlign: 'center' }}>WIN</div>
        <div style={{ ...hdr, textAlign: 'center' }}>T3</div>
        <div style={{ ...hdr, textAlign: 'center' }}>AVG</div>
      </div>
      {standings.players.map((p, i) => (
        <div key={p.user_id} style={{
          display: 'grid', gridTemplateColumns: '32px 1fr 40px 36px 50px',
          gap: 8, padding: '10px 8px', alignItems: 'center',
          borderBottom: '1px solid rgba(13,31,18,0.06)',
          background: i === 0 ? 'rgba(201,160,64,0.10)' : 'transparent',
        }}>
          <div style={{ fontWeight: 900, color: i === 0 ? '#7A5800' : '#0E3B23' }}>{i + 1}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0E3B23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
            {p.handle && <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.55)' }}>@{p.handle} · {p.played} played</div>}
          </div>
          <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 900, color: i === 0 ? '#7A5800' : '#0E3B23' }}>{p.wins}</div>
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(13,31,18,0.65)' }}>{p.top3}</div>
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(13,31,18,0.65)' }}>{p.avg_score ?? '—'}</div>
        </div>
      ))}
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
