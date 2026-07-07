import { useState, useEffect } from 'react'
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
  // Mode is one of:
  //   'login'   — email + PIN sign-in (default)
  //   'signup'  — email + name + PIN account creation
  //   'forgot'  — email-only "send me a reset link" flow
  //   'forgotSent' — confirmation message after the forgot-pin POST
  //   'reset'   — landed via ?reset=TOKEN URL, prompts for new PIN
  // 'forgot' / 'forgotSent' / 'reset' added 2026-05-07 (audit-2026-05-07
  // medium bug #5: no Forgot PIN flow). Email delivery is currently
  // STUBBED on the server — token is created and logged but no real
  // email is sent until a Resend/SendGrid key is added to env.
  const [mode, setMode]     = useState('login')
  const [email, setEmail]   = useState('')
  const [name, setName]     = useState('')
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)
  // Reset-flow state. resetToken holds the ?reset=... query param when the
  // page loads on a reset link. Cleared after successful reset.
  const [resetToken, setResetToken] = useState('')

  // Referral code (from a ?ref=CODE link). Captured on mount, persisted
  // through localStorage so it survives the user toggling between Sign
  // In ↔ Create Account or visiting other pages before completing
  // signup. Sent in the signup body as `ref`. (2026-05-07 PM3.)
  const [refCode, setRefCode] = useState('')

  // On mount, parse ?reset=TOKEN and ?ref=CODE from the URL. If reset,
  // switch to reset mode so the user is prompted for their new PIN
  // immediately. If ref, stash it for the signup body. Both params are
  // scrubbed from the URL after parse so they don't linger in browser
  // history or get sent in document.referrer to outbound links.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('reset')
      const ref = params.get('ref')
      let dirty = false
      if (token) {
        setResetToken(token)
        setMode('reset')
        params.delete('reset')
        dirty = true
      }
      if (ref) {
        // Store + persist so the user landing on /?ref=ABC123 → toggling
        // to Create Account → submitting still includes the code.
        const cleaned = ref.trim().toUpperCase()
        if (/^[A-Z0-9]{4,12}$/.test(cleaned)) {
          setRefCode(cleaned)
          try { localStorage.setItem('tm-pending-ref', cleaned) } catch { /* ignore */ }
        }
        params.delete('ref')
        dirty = true
      } else {
        // No ref in URL — restore from localStorage if a previous
        // session captured one (and signup hasn't completed yet).
        try {
          const stored = localStorage.getItem('tm-pending-ref')
          if (stored && /^[A-Z0-9]{4,12}$/.test(stored)) setRefCode(stored)
        } catch { /* ignore */ }
      }
      if (dirty) {
        const newQs = params.toString()
        const newUrl = window.location.pathname + (newQs ? `?${newQs}` : '') + window.location.hash
        window.history.replaceState({}, '', newUrl)
      }
    } catch {
      // Older browsers / private mode — fall through to normal login.
    }
  }, [])

  const submit = async () => {
    setError(''); setLoading(true)
    try {
      if (mode === 'forgot') {
        await post('/api/auth/forgot-pin', { email })
        setMode('forgotSent')
      } else if (mode === 'reset') {
        const res = await post('/api/auth/reset-pin', { token: resetToken, pin })
        localStorage.setItem('tm_token', res.token)
        onLogin(res.user)
      } else {
        // Signup with a captured referral code includes it in the body
        // so the server can record the referral + credit the new user
        // with their 7-day Elite trial. Login ignores ref (only relevant
        // at account creation). After a successful signup we clear the
        // pending ref from localStorage so a later guest signup on the
        // same device doesn't re-attribute. (2026-05-07 PM3.)
        const body = mode === 'signup'
          ? { email, name, pin, ...(refCode ? { ref: refCode } : {}) }
          : { email, pin }
        const res  = await post(`/api/auth/${mode}`, body)
        localStorage.setItem('tm_token', res.token)
        if (mode === 'signup') {
          try { localStorage.removeItem('tm-pending-ref') } catch { /* ignore */ }
        }
        onLogin(res.user)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter') submit() }

  const submitLabel = loading
    ? 'Loading…'
    : mode === 'signup' ? 'Create Account'
    : mode === 'forgot' ? 'Send reset link'
    : mode === 'reset'  ? 'Set new PIN'
    : 'Sign In'

  return (
    <div style={{
      position: 'fixed', inset: 0,
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '40px 0 40px',
    }}>
      {/* Fairway grass photo as its OWN fixed layer behind the content.
          It used to be a `background-attachment: fixed` on this scroll
          container — a documented iOS/WKWebView bug where the first tap
          into an input is consumed priming the fixed-background
          compositing layer instead of focusing the field, so the
          keyboard only appeared on the SECOND tap. Splitting the photo
          into a plain fixed div removes that bug while keeping the exact
          look. (2026-06-27 — Matt: "click username, keyboard didn't pop
          up, then I clicked password and it did.") */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'url("https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=1200&q=90")',
        backgroundSize: 'cover',
        backgroundPosition: 'center 40%',
      }} />

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
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 44, fontWeight: 700, letterSpacing: '-1px',
            background: 'linear-gradient(135deg, #F5D78A 0%, var(--tm-gold-bright) 50%, #C9971E 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            margin: '0 0 6px',
            textShadow: '0 1px 2px rgba(122,88,0,0.10)',
          }}>
            The Match
          </h1>
          <p style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: 'var(--tm-gold-text)', fontSize: 11, fontStyle: 'italic',
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
                ? 'linear-gradient(135deg, #F5D78A, var(--tm-gold-bright), var(--tm-gold))'
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

          {/* Referral hint — shown when a ?ref=CODE was captured at
              page load and the user is in the signup flow. Tells them
              the perk so the link feels meaningful. (2026-05-07 PM3.) */}
          {mode === 'signup' && refCode && (
            <div style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 12, color: '#5A4810', lineHeight: 1.5,
              background: 'rgba(232,192,90,0.18)',
              border: '1px solid rgba(155,120,24,0.40)',
              borderRadius: 8, padding: '8px 10px', marginBottom: 4,
              fontStyle: 'italic',
            }}>
              ★ Invited by a friend (<strong style={{ fontStyle: 'normal' }}>{refCode}</strong>) — your account starts with 7 days of Elite, free.
            </div>
          )}

          {/* Mode-specific helper text for the reset/forgot states. The
              login + signup modes use the toggle pills above as their cue. */}
          {mode === 'forgot' && (
            <div style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 13, color: '#5A4810', lineHeight: 1.5,
              marginBottom: 4,
            }}>
              Enter your email and we'll send a one-time link to reset your PIN.
              The link expires in 30 minutes.
            </div>
          )}
          {mode === 'forgotSent' && (
            <div style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 13, color: '#5A4810', lineHeight: 1.5,
            }}>
              If that email is registered, a reset link is on its way. Check your
              inbox (and spam folder). The link expires in 30 minutes.
            </div>
          )}
          {mode === 'reset' && (
            <div style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 13, color: '#5A4810', lineHeight: 1.5, marginBottom: 4,
            }}>
              Set a new 4-digit PIN. After saving, you'll be signed in.
            </div>
          )}

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
          {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
            <PremiumInput
              label="Email" type="email"
              value={email} onChange={setEmail}
              placeholder="golfer@example.com"
              focused={focusedField === 'email'}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              onKeyDown={handleKeyDown}
            />
          )}
          {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
          <PremiumInput
            label="4-Digit PIN" type="password"
            value={pin} onChange={setPin}
            placeholder="••••" maxLength={4} inputMode="numeric"
            focused={focusedField === 'pin'}
            onFocus={() => setFocusedField('pin')}
            onBlur={() => setFocusedField(null)}
            onKeyDown={handleKeyDown}
          />
          )}

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

          {/* Submit button — gold polish gradient (matches the ProfileHeroCard "Let's Go" button).
              Hidden in 'forgotSent' since there's nothing to submit; the only
              affordance there is the Back-to-sign-in link below. */}
          {mode !== 'forgotSent' && (
          <button
            onClick={submit}
            disabled={loading}
            style={{
              width: '100%', padding: '15px',
              border: '1px solid rgba(155,120,24,0.55)', borderRadius: 12,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
              cursor: loading ? 'default' : 'pointer',
              background: 'linear-gradient(135deg, #F5D78A 0%, var(--tm-gold-bright) 45%, #C9971E 100%)',
              backgroundSize: '200% 100%',
              color: '#3A2A05',
              boxShadow: '0 4px 18px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,253,248,0.55), inset 0 -1px 0 rgba(122,88,0,0.18)',
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 200ms, transform 100ms',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {submitLabel}
          </button>
          )}

          {/* Forgot PIN / back-to-login secondary actions. Subtle row
              under the primary button — matches the existing typography
              vocabulary (Georgia italic in muted brown-gold). */}
          {mode === 'login' && (
            <button
              onClick={() => { setMode('forgot'); setError(''); setPin('') }}
              style={{
                background: 'transparent', border: 'none',
                color: 'rgba(122,88,0,0.70)', fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 12, fontStyle: 'italic', textAlign: 'center',
                cursor: 'pointer', padding: '4px', marginTop: -4,
                textDecoration: 'underline',
              }}
            >
              Forgot your PIN?
            </button>
          )}
          {(mode === 'forgot' || mode === 'forgotSent') && (
            <button
              onClick={() => { setMode('login'); setError(''); setPin('') }}
              style={{
                background: 'transparent', border: 'none',
                color: 'rgba(122,88,0,0.70)', fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 12, fontStyle: 'italic', textAlign: 'center',
                cursor: 'pointer', padding: '4px', marginTop: -4,
                textDecoration: 'underline',
              }}
            >
              ← Back to sign in
            </button>
          )}
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
          color: 'var(--tm-green)', fontSize: 16, outline: 'none',
          fontFamily: 'Georgia, "Times New Roman", serif',
          boxShadow: focused ? '0 0 0 3px rgba(232,192,90,0.18), inset 0 1px 2px rgba(122,88,0,0.06)' : 'inset 0 1px 2px rgba(122,88,0,0.04)',
          transition: 'all 200ms ease',
          caretColor: 'var(--tm-gold)',
        }}
      />
    </div>
  )
}
