import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(strokes, par) {
  if (!strokes || !par) return 'var(--tm-text-2)'
  const d = strokes - par
  if (d <= -2) return 'var(--tm-eagle)'
  if (d === -1) return 'var(--tm-birdie)'
  if (d === 0)  return 'var(--tm-par)'
  if (d === 1)  return 'var(--tm-bogey)'
  return 'var(--tm-double)'
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
}
function wlLabel(w, l, t) {
  if (!w && !l && !t) return '—'
  return `${w}-${l}${t ? `-${t}` : ''}`
}

// ─── Outing Hub (main landing) ────────────────────────────────────────────────
function OutingHub({ user, onJoin, onCreate, onOpenOuting }) {
  const [rivalries, setRivalries] = useState([])
  const [recentOutings, setRecentOutings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/api/outings/my-rivalries').catch(() => ({ rivalries: [] })),
      api.get('/api/outings/recent').catch(() => ({ outings: [] })),
    ]).then(([rv, ro]) => {
      setRivalries(rv.rivalries || [])
      setRecentOutings(ro.outings || [])
      setLoading(false)
    })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 2,
        }}>Outings</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Your rivalries live here</div>
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', gap: 16 }}>
        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onCreate}
            style={{
              flex: 1, padding: '16px 0', borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
              color: '#fff', fontWeight: 800, fontSize: 15,
              boxShadow: '0 4px 16px rgba(46,158,69,0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
              cursor: 'pointer',
            }}>
            + Create
          </button>
          <button onClick={onJoin}
            style={{
              flex: 1, padding: '16px 0', borderRadius: 14,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(94,212,122,0.35)',
              color: '#5ED47A', fontWeight: 800, fontSize: 15,
              cursor: 'pointer',
            }}>
            Join Code
          </button>
        </div>

        {/* Head-to-head rivalries */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Your Rivalries</div>
          {loading
            ? <div style={{ color: 'var(--tm-text-3)', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>Loading…</div>
            : rivalries.length === 0
            ? <EmptyRivalries />
            : rivalries.map(r => <RivalryCard key={r.opponent_id} r={r} userId={user.id} />)
          }
        </div>

        {/* Recent outings */}
        {recentOutings.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Recent Outings</div>
            {recentOutings.map(o => (
              <button key={o.id} onClick={() => onOpenOuting(o.code)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 14, padding: '14px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 8,
                }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {o.course_name} · {o.player_count}p · <span style={{ color: '#E8C05A', fontWeight: 700, letterSpacing: 2 }}>{o.code}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 20,
                  background: o.status === 'active' ? 'rgba(94,212,122,0.15)' : 'rgba(255,255,255,0.06)',
                  color: o.status === 'active' ? '#5ED47A' : 'rgba(255,255,255,0.4)',
                  border: o.status === 'active' ? '1px solid rgba(94,212,122,0.3)' : '1px solid rgba(255,255,255,0.1)',
                }}>
                  {o.status === 'active' ? '● LIVE' : 'Final'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Rivalry Card ─────────────────────────────────────────────────────────────
function RivalryCard({ r, userId }) {
  const myWins   = r.my_wins ?? 0
  const oppWins  = r.opp_wins ?? 0
  const ties     = r.ties ?? 0
  const total    = myWins + oppWins + ties
  const lead     = myWins > oppWins ? 'up' : myWins < oppWins ? 'down' : 'even'
  const leadColor = lead === 'up' ? 'var(--tm-birdie)' : lead === 'down' ? 'var(--tm-bogey)' : 'var(--tm-par)'

  return (
    <div style={{
      borderRadius: 18,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
      padding: '16px', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(30,80,35,0.8), rgba(15,50,20,0.8))',
            border: '1.5px solid rgba(94,212,122,0.4)',
            boxShadow: '0 0 12px rgba(94,212,122,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#5ED47A',
          }}>
            {initials(r.opponent_name)}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{r.opponent_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{total} match{total !== 1 ? 'es' : ''}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: leadColor }}>{wlLabel(myWins, oppWins, ties)}</div>
          <div style={{ fontSize: 11, color: leadColor, fontWeight: 600, marginTop: 1 }}>
            {lead === 'up' ? `+${myWins - oppWins} up` : lead === 'down' ? `${myWins - oppWins} down` : 'EVEN'}
          </div>
        </div>
      </div>
      {/* Win bar */}
      {total > 0 && (
        <>
          <div style={{ marginTop: 14, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', display: 'flex', gap: 1 }}>
            <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, #2A7A38, #5ED47A)', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
            {ties > 0 && <div style={{ width: `${(ties/total)*100}%`, background: 'rgba(138,180,248,0.5)' }} />}
            <div style={{ flex: 1, background: 'rgba(224,122,90,0.5)', borderRadius: '0 99px 99px 0' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'rgba(94,212,122,0.7)', fontWeight: 600 }}>You {myWins}W</span>
            {ties > 0 && <span style={{ fontSize: 11, color: 'rgba(138,180,248,0.6)', fontWeight: 600 }}>{ties}T</span>}
            <span style={{ fontSize: 11, color: 'rgba(224,122,90,0.7)', fontWeight: 600 }}>{oppWins}W {r.opponent_name?.split(' ')[0]}</span>
          </div>
        </>
      )}
    </div>
  )
}

function EmptyRivalries() {
  return (
    <div style={{
      borderRadius: 18,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      padding: '32px 20px', textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/>
          <path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
      </div>
      <div style={{ fontWeight: 700, color: '#fff', fontSize: 15, marginBottom: 8 }}>No rivalries yet</div>
      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, lineHeight: 1.6 }}>Create or join an outing to start tracking your head-to-head record.</div>
    </div>
  )
}

// ─── Join Sheet ───────────────────────────────────────────────────────────────
function JoinSheet({ onClose, onJoined }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    const c = code.toUpperCase().trim()
    if (c.length !== 4) { setError('Enter a 4-digit code'); return }
    setLoading(true); setError('')
    try {
      const data = await api.post(`/api/outings/${c}/join`, {})
      onJoined(data.outing)
    } catch (e) {
      setError(e.message || 'Outing not found')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', padding: '24px 20px calc(24px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm-text)' }}>Join an Outing</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 12 }}>Enter the 4-character code from your group</div>
        <input
          value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0,4))}
          placeholder="CODE" maxLength={4}
          style={{ width: '100%', textAlign: 'center', fontSize: 32, fontWeight: 800, letterSpacing: 8, background: 'var(--tm-surface-2)', border: `2px solid ${error ? 'var(--tm-danger)' : 'var(--tm-border-2)'}`, borderRadius: 'var(--tm-radius)', color: 'var(--tm-gold-text)', padding: '16px', outline: 'none', boxSizing: 'border-box' }}
        />
        {error && <div style={{ color: 'var(--tm-danger)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</div>}
        <button onClick={handleJoin} disabled={loading || code.length < 4}
          style={{ width: '100%', marginTop: 16, padding: '16px', borderRadius: 'var(--tm-radius-lg)', background: code.length === 4 ? 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))' : 'var(--tm-surface-2)', color: code.length === 4 ? '#fff' : 'var(--tm-text-3)', fontWeight: 800, fontSize: 16, border: 'none' }}>
          {loading ? 'Joining…' : 'Join Outing'}
        </button>
      </div>
    </div>
  )
}

// ─── Create Outing Wizard ─────────────────────────────────────────────────────
const FORMATS = [
  { id: 'stroke',    label: 'Stroke Play',    desc: 'Total strokes wins' },
  { id: 'match',     label: 'Match Play',     desc: 'Hole-by-hole wins' },
  { id: 'stableford',label: 'Stableford',     desc: 'Points system' },
  { id: 'skins',     label: 'Skins',          desc: 'Win each hole outright' },
]
const TEAMS = [
  { id: 'individual', label: 'Individual',    desc: 'Every man for himself' },
  { id: 'teams',      label: 'Team Battle',   desc: '2 teams, 8 players' },
  { id: 'big_team',   label: 'Big Team Battle', desc: 'Up to 40 players, 2 sides' },
]

function CreateWizard({ user, onClose, onCreated }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ name: '', courseName: '', format: 'stroke', team: 'individual', holes: 18 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      const data = await api.post('/api/outings', {
        name: form.name || `${user.name}'s Outing`,
        courseName: form.courseName || 'TBD',
        scoringFormats: [form.format],
        teamFormat: form.team,
        coursePar: form.holes === 9 ? 36 : 72,
      })
      onCreated(data.outing)
    } catch (e) {
      setError(e.message || 'Failed to create outing')
    } finally { setLoading(false) }
  }

  const steps = [
    // Step 0: Name + Course
    <div key="0" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Outing Name</div>
        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={`${user.name}'s Outing`}
          style={{ width: '100%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px', outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Course</div>
        <input value={form.courseName} onChange={e => set('courseName', e.target.value)} placeholder="Course name (optional)"
          style={{ width: '100%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px', outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Holes</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[9,18].map(h => <button key={h} onClick={() => set('holes', h)} style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--tm-radius)', border: '1px solid', borderColor: form.holes === h ? 'var(--tm-green)' : 'var(--tm-border)', background: form.holes === h ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)', color: form.holes === h ? 'var(--tm-green-text)' : 'var(--tm-text-2)', fontWeight: 700 }}>{h} Holes</button>)}
        </div>
      </div>
    </div>,

    // Step 1: Format
    <div key="1" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {FORMATS.map(f => (
        <button key={f.id} onClick={() => set('format', f.id)}
          style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.format === f.id ? 'var(--tm-green)' : 'var(--tm-border)', background: form.format === f.id ? 'var(--tm-green-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{f.label}</div>
            <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{f.desc}</div>
          </div>
          {form.format === f.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800 }}>✓</div>}
        </button>
      ))}
    </div>,

    // Step 2: Team format
    <div key="2" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {TEAMS.map(t => (
        <button key={t.id} onClick={() => set('team', t.id)}
          style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.team === t.id ? 'var(--tm-gold)' : 'var(--tm-border)', background: form.team === t.id ? 'var(--tm-gold-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{t.label}</div>
            <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{t.desc}</div>
          </div>
          {form.team === t.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-inv)', fontSize: 11, fontWeight: 800 }}>✓</div>}
        </button>
      ))}
    </div>,
  ]

  const stepTitles = ['Set the Stage', 'Choose Format', 'Team Setup']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm-text)' }}>{stepTitles[step]}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginBottom: 16 }}>Step {step+1} of 3</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {[0,1,2].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--tm-green)' : 'var(--tm-surface-3)' }} />)}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {steps[step]}
        </div>
        {error && <div style={{ color: 'var(--tm-danger)', fontSize: 13, padding: '8px 20px', textAlign: 'center' }}>{error}</div>}
        <div style={{ padding: '16px 20px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', display: 'flex', gap: 12, flexShrink: 0 }}>
          {step > 0 && <button onClick={() => setStep(s => s-1)} style={{ flex: 1, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700 }}>Back</button>}
          {step < 2
            ? <button onClick={() => setStep(s => s+1)} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: '#fff', fontWeight: 800, fontSize: 15, border: 'none' }}>Next →</button>
            : <button onClick={handleCreate} disabled={loading} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15, border: 'none' }}>{loading ? 'Creating…' : 'Create Outing'}</button>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Live Outing Scorer ───────────────────────────────────────────────────────
function LiveOuting({ code, user, onBack }) {
  const [outing, setOuting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hole, setHole] = useState(0)
  const [myScores, setMyScores] = useState([])

  const loadOuting = useCallback(async () => {
    try {
      const data = await api.get(`/api/outings/${code}`)
      setOuting(data.outing)
      if (!myScores.length && data.outing?.course_par) {
        const h = data.outing.state?.holes ?? 18
        setMyScores(new Array(h).fill(0))
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [code])

  useEffect(() => { loadOuting() }, [loadOuting])
  // Poll every 15s for live scores
  useEffect(() => {
    const t = setInterval(loadOuting, 15000)
    return () => clearInterval(t)
  }, [loadOuting])

  async function submitScore(h, val) {
    const next = [...myScores]; next[h] = val; setMyScores(next)
    try {
      await api.put(`/api/outings/${code}/scores`, { hole: h, score: val })
    } catch (e) { console.error(e) }
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--tm-text-3)' }}>Loading outing…</div>
  if (!outing) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 20 }}>
    <div style={{ fontSize: 36 }}>❌</div>
    <div style={{ color: 'var(--tm-text)', fontWeight: 700 }}>Outing not found</div>
    <button onClick={onBack} style={{ color: 'var(--tm-green-text)', background: 'none', border: 'none', fontWeight: 700 }}>← Back</button>
  </div>

  const participants = outing.state?.participants ?? []
  const holeCount = outing.state?.holes ?? 18
  const coursePar = outing.course_par ?? 72
  const holePar = Math.round(coursePar / holeCount)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', background: 'var(--tm-surface)', borderBottom: '1px solid var(--tm-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20, padding: 0 }}>←</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, color: 'var(--tm-text)', fontSize: 15 }}>{outing.name}</div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>{outing.course_name}</div>
          </div>
          <div style={{ background: 'var(--tm-green-muted)', padding: '4px 10px', borderRadius: 'var(--tm-radius-full)', fontSize: 11, fontWeight: 700, color: 'var(--tm-green-text)', letterSpacing: 2 }}>{code}</div>
        </div>
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', gap: 16 }}>
        {/* My score entry */}
        <div style={{ background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', border: '1px solid var(--tm-gold-dim)', padding: '16px' }}>
          <div style={{ fontSize: 12, color: 'var(--tm-gold-text)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Your Score — Hole {hole+1}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={() => setHole(h => Math.max(0, h-1))} disabled={hole === 0}
              style={{ padding: '8px 16px', borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700, opacity: hole === 0 ? 0.3 : 1 }}>←</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button onClick={() => submitScore(hole, Math.max(1, (myScores[hole] || 0) - 1))}
                style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 22, fontWeight: 300 }}>−</button>
              <div style={{ fontSize: 44, fontWeight: 900, color: scoreColor(myScores[hole], holePar), minWidth: 44, textAlign: 'center' }}>{myScores[hole] || 0}</div>
              <button onClick={() => submitScore(hole, (myScores[hole] || 0) + 1)}
                style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--tm-green-muted)', border: '1px solid var(--tm-green)', color: 'var(--tm-green-text)', fontSize: 22, fontWeight: 300 }}>+</button>
            </div>
            <button onClick={() => setHole(h => Math.min(holeCount-1, h+1))} disabled={hole === holeCount-1}
              style={{ padding: '8px 16px', borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700, opacity: hole === holeCount-1 ? 0.3 : 1 }}>→</button>
          </div>
        </div>

        {/* Live leaderboard */}
        <div style={{ background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', border: '1px solid var(--tm-border)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--tm-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-2)' }}>Leaderboard</div>
            <button onClick={loadOuting} style={{ fontSize: 12, color: 'var(--tm-green-text)', background: 'none', border: 'none', fontWeight: 600 }}>↻ Refresh</button>
          </div>
          {participants.length === 0
            ? <div style={{ padding: '20px', textAlign: 'center', color: 'var(--tm-text-3)', fontSize: 13 }}>Waiting for players to join…</div>
            : participants
                .sort((a, b) => (a.total ?? 999) - (b.total ?? 999))
                .map((p, i) => {
                  const diff = (p.total ?? 0) - coursePar
                  const isMe = p.user_id === user.id
                  return (
                    <div key={p.user_id} style={{ padding: '12px 16px', borderBottom: i < participants.length-1 ? '1px solid var(--tm-border)' : 'none', display: 'flex', alignItems: 'center', gap: 12, background: isMe ? 'var(--tm-gold-muted)' : 'transparent' }}>
                      <div style={{ width: 24, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--tm-text-3)' }}>{i+1}</div>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: isMe ? 'var(--tm-gold-muted)' : 'var(--tm-surface-3)', border: `2px solid ${isMe ? 'var(--tm-gold)' : 'var(--tm-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: isMe ? 'var(--tm-gold-text)' : 'var(--tm-text-2)' }}>
                        {initials(p.name)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: isMe ? 800 : 600, color: 'var(--tm-text)', fontSize: 14 }}>{p.name}{isMe ? ' (you)' : ''}</div>
                        <div style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>{p.holes_played ?? 0} holes</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(p.total, coursePar) }}>{p.total ?? '—'}</div>
                        {p.total && <div style={{ fontSize: 11, color: scoreColor(p.total, coursePar), fontWeight: 700 }}>{diff === 0 ? 'E' : diff > 0 ? `+${diff}` : diff}</div>}
                      </div>
                    </div>
                  )
                })
          }
        </div>
      </div>
    </div>
  )
}

// ─── Code Share Sheet ─────────────────────────────────────────────────────────
function CodeShare({ outing, onEnter }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 32px', gap: 20 }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(30,80,35,0.5) 0%, rgba(10,30,14,0.3) 100%)',
        border: '1px solid rgba(94,212,122,0.25)',
        boxShadow: '0 0 32px rgba(94,212,122,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#5ED47A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <line x1="4" y1="22" x2="4" y2="15"/>
        </svg>
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, color: '#fff', textAlign: 'center' }}>{outing.name}</div>
      <div style={{ fontSize: 14, color: 'var(--tm-text-3)', textAlign: 'center' }}>{outing.course_name}</div>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(232,192,90,0.35)',
        borderRadius: 20, padding: '24px 40px', textAlign: 'center',
        boxShadow: '0 0 40px rgba(232,192,90,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}>
        <div style={{ fontSize: 11, color: 'rgba(232,192,90,0.7)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Join Code</div>
        <div style={{
          fontSize: 54, fontWeight: 900, letterSpacing: 10,
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 0 8px rgba(232,192,90,0.3))',
        }}>{outing.code}</div>
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
        Share this code with your group so they can join
      </div>
      <button onClick={onEnter}
        style={{
          width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
          color: '#fff', fontWeight: 800, fontSize: 16,
          boxShadow: '0 4px 20px rgba(46,158,69,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
        }}>
        Enter Outing →
      </button>
    </div>
  )
}

// ─── Main Outing Component ────────────────────────────────────────────────────
export default function Outing({ user }) {
  const [view, setView] = useState('hub')       // 'hub' | 'live' | 'code-share'
  const [showJoin, setShowJoin] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [activeCode, setActiveCode] = useState(null)
  const [freshOuting, setFreshOuting] = useState(null)

  if (view === 'live' && activeCode) return <LiveOuting code={activeCode} user={user} onBack={() => setView('hub')} />
  if (view === 'code-share' && freshOuting) return <CodeShare outing={freshOuting} onEnter={() => { setActiveCode(freshOuting.code); setView('live') }} />

  return (
    <>
      <OutingHub
        user={user}
        onJoin={() => setShowJoin(true)}
        onCreate={() => setShowCreate(true)}
        onOpenOuting={code => { setActiveCode(code); setView('live') }}
      />
      {showJoin && (
        <JoinSheet
          onClose={() => setShowJoin(false)}
          onJoined={o => { setShowJoin(false); setActiveCode(o.code); setView('live') }}
        />
      )}
      {showCreate && (
        <CreateWizard
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={o => { setShowCreate(false); setFreshOuting(o); setView('code-share') }}
        />
      )}
    </>
  )
}
