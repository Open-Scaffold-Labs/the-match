import { useState } from 'react'
import { post } from '../lib/api.js'
import { TMEmblem } from '../components/primitives/Icons.jsx'

// Palette + typography matched to the home page (ProfileHeroCard / REQUESTS box):
//   - Fairway grass photo bg with cream tint overlay (same as App.jsx wrapper)
//   - Translucent cream glass-morphism card (rgba(255,255,255,0.22) + blur(12px))
//   - Georgia serif for the wordmark and section labels
//   - Gold-gradient text for "The Match"
//   - Dark green / brown-gold text on cream for body, labels, hints
//   - Gold accent line top of card (mirrors the gold pinstripe on hero card)
//   (2026-05-03 — Matt: "redo the login page so it matches our cream and
//   gold coloring, words with the georgia font and gold polish coloring,
//   and the translucent boxes from our home screen.")
export default function Login({ onLogin }) {
  const [mode, setMode]     = useState('login')
  const [email, setEmail]   = useState('')
  const [name, setName]     = useState('')
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  const submit = async () => {
    setError(''); setLoading(true)
    try {
      const body = mode === 'signup' ? { email, name, pin } : { email, pin }
      const res  = await post(`/api/auth/${mode}`, body)
      localStorage.setItem('tm_token', res.token)
      onLogin(res.user)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter') submit() }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      // Fairway grass photo with cream tint — matches App.jsx home wrapper exactly
      backgroundImage: 'url("https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=1200&q=90")',
      backgroundSize: 'cover',
      backgroundPosition: 'center 40%',
      backgroundAttachment: 'fixed',
      padding: '40px 0 40px',
    }}>
      {/* Cream tint REMOVED — Matt wanted to see the raw fairway photo
          showing through. (2026-05-03 — preview, may revert.) */}

      {/* Soft warm radial glow — same vocabulary as ProfileHeroCard's gold radial */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 60% at 50% 20%, rgba(232,192,90,0.08) 0%, transparent 70%)',
      }} />

      {/* Main content */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 380,
        padding: '0 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>

        {/* Logo lockup */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 80, height: 80, borderRadius: '50%',
            background: 'rgba(255,255,255,0.45)',
            border: '1.5px solid rgba(201,160,64,0.55)',
            boxShadow: '0 4px 24px rgba(201,160,64,0.20), inset 0 1px 0 rgba(255,255,255,0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            marginBottom: 18,
          }}>
            <TMEmblem size={48} gold />
          </div>
          <h1 style={{
            fontFamily: '"Georgia", serif',
            fontSize: 44, fontWeight: 900, letterSpacing: '-0.03em',
            // Same 4-stop vertical gradient as the home page header —
            // dark amber → bright highlight at 32% → mid gold → deep
            // amber. Reads as polished metal, not flat gold.
            background: 'linear-gradient(180deg, #B58E33 0%, #F8DE91 32%, #E8C05A 58%, #8A6B28 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            margin: '0 0 6px',
          }}>
            The Match
          </h1>
          <p style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: '#7A5800', fontSize: 11, fontStyle: 'italic',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            margin: 0,
            textShadow: '0 1px 1px rgba(255,253,248,0.4)',
          }}>
            Where Competition Lives
          </p>
        </div>

        {/* Mode toggle pills — translucent cream pills with gold accent on the active one */}
        <div style={{
          display: 'flex', width: '100%',
          background: 'rgba(255,255,255,0.45)',
          border: '1px solid rgba(201,160,64,0.35)',
          borderRadius: 12, padding: 3, gap: 3, marginBottom: 18,
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        }}>
          {['login', 'signup'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError('') }} style={{
              flex: 1, padding: '10px 0', border: 'none', borderRadius: 9,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.06em',
              transition: 'all 200ms ease',
              background: mode === m
                ? 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)'
                : 'transparent',
              color: mode === m ? '#5A4810' : 'rgba(122,88,0,0.55)',
              boxShadow: mode === m
                ? '0 2px 8px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,253,248,0.55)'
                : 'none',
            }}>
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Form card — translucent cream glass with gold pinstripe accent at top, matching home */}
        <div style={{
          position: 'relative',
          width: '100%',
          background: 'rgba(255,255,255,0.22)',
          border: '1px solid rgba(255,255,255,0.45)',
          borderRadius: 22,
          padding: '24px 20px 22px',
          boxShadow: '0 8px 32px rgba(122,88,0,0.18), inset 0 1px 0 rgba(255,253,248,0.6)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', flexDirection: 'column', gap: 14,
          overflow: 'hidden',
        }}>
          {/* Gold pinstripe at the top of the card — same flourish vocabulary as ProfileHeroCard */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 3, pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.7), rgba(232,192,90,1.0), rgba(201,160,64,0.7), transparent)',
          }} />

          {mode === 'signup' && (
            <PremiumInput
              label="Your Name"
              value={name} onChange={setName}
              placeholder="Tiger Woods"
              focused={focusedField === 'name'}
              onFocus={() => setFocusedField('name')}
              onBlur={() => setFocusedField(null)}
              onKeyDown={handleKeyDown}
            />
          )}
          <PremiumInput
            label="Email" type="email"
            value={email} onChange={setEmail}
            placeholder="golfer@example.com"
            focused={focusedField === 'email'}
            onFocus={() => setFocusedField('email')}
            onBlur={() => setFocusedField(null)}
            onKeyDown={handleKeyDown}
          />
          <PremiumInput
            label="4-Digit PIN" type="password"
            value={pin} onChange={setPin}
            placeholder="••••" maxLength={4} inputMode="numeric"
            focused={focusedField === 'pin'}
            onFocus={() => setFocusedField('pin')}
            onBlur={() => setFocusedField(null)}
            onKeyDown={handleKeyDown}
          />

          {error && (
            <div style={{
              background: 'rgba(178,34,34,0.10)', border: '1px solid rgba(178,34,34,0.30)',
              borderRadius: 8, padding: '10px 14px',
              color: '#9B2020', fontSize: 13, textAlign: 'center',
              fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic',
            }}>
              {error}
            </div>
          )}

          {/* Submit button — gold polish gradient (matches the ProfileHeroCard "Let's Go" button) */}
          <button
            onClick={submit}
            disabled={loading}
            style={{
              width: '100%', padding: '15px',
              border: '1px solid rgba(155,120,24,0.55)', borderRadius: 12,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
              cursor: loading ? 'default' : 'pointer',
              background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 45%, #C9971E 100%)',
              backgroundSize: '200% 100%',
              color: '#3A2A05',
              boxShadow: '0 4px 18px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,253,248,0.55), inset 0 -1px 0 rgba(122,88,0,0.18)',
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 200ms, transform 100ms',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {loading ? 'Loading…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </div>

        {/* Footer note */}
        <p style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: 'rgba(90,72,16,0.55)', fontSize: 11, fontStyle: 'italic',
          textAlign: 'center', marginTop: 20, lineHeight: 1.6,
          textShadow: '0 1px 1px rgba(255,253,248,0.4)',
        }}>
          By continuing you agree to The Match<br />Terms of Service &amp; Privacy Policy
        </p>
      </div>
    </div>
  )
}

function PremiumInput({ label, value, onChange, placeholder, type = 'text', maxLength, inputMode, focused, onFocus, onBlur, onKeyDown }) {
  return (
    <div>
      <label style={{
        display: 'block', marginBottom: 7,
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: focused ? '#5A4810' : 'rgba(122,88,0,0.65)',
        textShadow: '0 1px 1px rgba(255,253,248,0.4)',
        transition: 'color 200ms',
      }}>
        {label}
      </label>
      <input
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength} inputMode={inputMode}
        onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}
        style={{
          width: '100%', padding: '13px 15px', boxSizing: 'border-box',
          background: focused ? 'rgba(255,253,248,0.85)' : 'rgba(255,253,248,0.65)',
          border: `1px solid ${focused ? 'rgba(201,160,64,0.60)' : 'rgba(201,160,64,0.30)'}`,
          borderRadius: 10,
          color: '#1B5E3B', fontSize: 16, outline: 'none',
          fontFamily: 'Georgia, "Times New Roman", serif',
          boxShadow: focused ? '0 0 0 3px rgba(232,192,90,0.18), inset 0 1px 2px rgba(122,88,0,0.06)' : 'inset 0 1px 2px rgba(122,88,0,0.04)',
          transition: 'all 200ms ease',
          caretColor: '#C9A040',
        }}
      />
    </div>
  )
}
