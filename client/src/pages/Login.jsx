import { useState, useRef } from 'react'
import { post } from '../lib/api.js'
import { TMEmblem } from '../components/primitives/Icons.jsx'

export default function Login({ onLogin }) {
  const [mode, setMode]     = useState('login')
  const [email, setEmail]   = useState('')
  const [name, setName]     = useState('')
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  // Verification state — set when signup or login returns
  // pending_verification: true. While set, the form switches to the
  // 6-digit code entry view. (2026-05-02 — email verification.)
  const [pendingUserId, setPendingUserId] = useState(null)
  const [pendingEmail, setPendingEmail]   = useState('')
  const [code, setCode]                   = useState('')
  const [info, setInfo]                   = useState('')

  const submit = async () => {
    setError(''); setInfo(''); setLoading(true)
    try {
      const body = mode === 'signup' ? { email, name, pin } : { email, pin }
      const res  = await post(`/api/auth/${mode}`, body)
      // Verified path — token in response, log straight in.
      if (res.token) {
        localStorage.setItem('tm_token', res.token)
        onLogin(res.user)
        return
      }
      // Verification path — both signup AND login (when account is
      // unverified) return pending_verification: true with user_id.
      if (res.pending_verification && res.user_id) {
        setPendingUserId(res.user_id)
        setPendingEmail(res.email || email)
        setMode('verify')
        setCode('')
        setInfo(`We sent a 6-digit code to ${res.email || email}.`)
        return
      }
      // Unexpected shape — surface it so it doesn't fail silently.
      setError('Unexpected response from server. Please try again.')
    } catch (e) {
      // Login may return 403 unverified with payload — flip to verify.
      if (e.status === 403 && e.payload?.pending_verification && e.payload?.user_id) {
        setPendingUserId(e.payload.user_id)
        setPendingEmail(e.payload.email || email)
        setMode('verify')
        setCode('')
        setInfo(e.payload.message || 'Please verify your email to continue.')
      } else {
        setError(e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const submitVerify = async () => {
    setError(''); setInfo(''); setLoading(true)
    try {
      const res = await post('/api/auth/verify', {
        user_id: pendingUserId,
        code: code.trim(),
      })
      if (res.token) {
        localStorage.setItem('tm_token', res.token)
        onLogin(res.user)
      } else {
        setError('Verification did not complete. Please try again.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const resendCode = async () => {
    setError(''); setInfo(''); setLoading(true)
    try {
      await post('/api/auth/resend-code', { user_id: pendingUserId })
      setInfo('A fresh code is on its way.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (mode === 'verify') submitVerify()
      else submit()
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#060E08',
      padding: '40px 0 40px',
    }}>
      {/* Ambient background layers */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(30,80,35,0.35) 0%, transparent 70%)',
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 50% at 50% 90%, rgba(18,50,22,0.4) 0%, transparent 70%)',
      }} />
      {/* Subtle grid texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.025,
        backgroundImage: 'linear-gradient(rgba(94,212,122,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(94,212,122,0.6) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />

      {/* Main content */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 380,
        padding: '0 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>

        {/* Logo lockup */}
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 80, height: 80, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(30,80,35,0.6) 0%, rgba(10,30,14,0.4) 100%)',
            border: '1px solid rgba(94,212,122,0.2)',
            boxShadow: '0 0 40px rgba(94,212,122,0.12), inset 0 1px 0 rgba(255,255,255,0.05)',
            marginBottom: 20,
          }}>
            <TMEmblem size={48} />
          </div>
          <h1 style={{
            fontSize: 38, fontWeight: 800, letterSpacing: '-1.5px',
            background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9971E 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            margin: '0 0 8px',
          }}>
            The Match
          </h1>
          <p style={{
            color: 'rgba(255,255,255,0.35)', fontSize: 13,
            letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
          }}>
            Your golf companion
          </p>
        </div>

        {/* Mode toggle pills — hidden in verify mode (no point letting
            the user navigate AWAY from the verification step they
            were just put into; resend / use-different-account are
            their two real options, surfaced inside the verify card). */}
        {mode !== 'verify' && (
          <div style={{
            display: 'flex', width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12, padding: 3, gap: 3, marginBottom: 24,
          }}>
            {['login', 'signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); setInfo('') }} style={{
                flex: 1, padding: '10px 0', border: 'none', borderRadius: 9,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                transition: 'all 200ms ease',
                background: mode === m
                  ? 'linear-gradient(135deg, rgba(40,110,50,0.9), rgba(25,75,35,0.9))'
                  : 'transparent',
                color: mode === m ? '#5ED47A' : 'rgba(255,255,255,0.35)',
                boxShadow: mode === m ? '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
              }}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>
        )}

        {/* Form card */}
        <div style={{
          width: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 18,
          padding: '24px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {mode === 'verify' ? (
            <>
              {/* Verify view — code entry. The form card swaps body
                  but keeps the same surrounding chrome (logo +
                  emblem above) so the transition reads as a step
                  in the same flow, not a different screen. */}
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <div style={{
                  fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6,
                }}>
                  Check your email
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>
                  We sent a 6-digit code to<br />
                  <span style={{ color: '#5ED47A', fontWeight: 600 }}>{pendingEmail}</span>
                </div>
              </div>

              <PremiumInput
                label="Verification Code"
                value={code}
                onChange={v => setCode(String(v).replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                focused={focusedField === 'code'}
                onFocus={() => setFocusedField('code')}
                onBlur={() => setFocusedField(null)}
                onKeyDown={handleKeyDown}
              />
            </>
          ) : (
            <>
              {mode === 'signup' && (
                <PremiumInput
                  label="Your Name"
                  value={name}
                  onChange={setName}
                  placeholder="Tiger Woods"
                  focused={focusedField === 'name'}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onKeyDown={handleKeyDown}
                />
              )}
              <PremiumInput
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="golfer@example.com"
                type="email"
                focused={focusedField === 'email'}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                onKeyDown={handleKeyDown}
              />
              <PremiumInput
                label="4-Digit PIN"
                value={pin}
                onChange={setPin}
                placeholder="••••"
                type="password"
                maxLength={4}
                inputMode="numeric"
                focused={focusedField === 'pin'}
                onFocus={() => setFocusedField('pin')}
                onBlur={() => setFocusedField(null)}
                onKeyDown={handleKeyDown}
              />

              {/* Sender notice — only on signup. Tells users which
                  address the verification email comes from so they
                  know what to look for + can whitelist if their
                  spam filter snags it. (2026-05-02 — Matt: "notify
                  users who they will be receiving email from to
                  verify on the login screen though") */}
              {mode === 'signup' && (
                <div style={{
                  background: 'rgba(94,212,122,0.05)',
                  border: '1px solid rgba(94,212,122,0.18)',
                  borderRadius: 8, padding: '10px 12px',
                  color: 'rgba(255,255,255,0.65)', fontSize: 11, lineHeight: 1.5,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', color: '#5ED47A', textTransform: 'uppercase', marginBottom: 3 }}>
                    Heads up
                  </div>
                  We'll send a verification code from <strong style={{ color: '#fff' }}>onboarding@resend.dev</strong>. Check your spam folder if you don't see it.
                </div>
              )}
            </>
          )}

          {info && !error && (
            <div style={{
              background: 'rgba(94,212,122,0.08)', border: '1px solid rgba(94,212,122,0.25)',
              borderRadius: 8, padding: '10px 14px',
              color: '#5ED47A', fontSize: 12, textAlign: 'center',
            }}>
              {info}
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(220,50,50,0.1)', border: '1px solid rgba(220,50,50,0.25)',
              borderRadius: 8, padding: '10px 14px',
              color: '#F87171', fontSize: 13, textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={mode === 'verify' ? submitVerify : submit}
            disabled={loading || (mode === 'verify' && code.length !== 6)}
            style={{
              width: '100%', padding: '16px',
              border: 'none', borderRadius: 12,
              fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
              background: mode === 'signup'
                ? 'linear-gradient(135deg, #C9971E, #E8C05A, #C9971E)'
                : 'linear-gradient(135deg, #1A6B28, #2E9E45, #1A6B28)',
              backgroundSize: '200% 100%',
              color: mode === 'signup' ? '#1A0F00' : '#fff',
              boxShadow: mode === 'signup'
                ? '0 4px 20px rgba(232,192,90,0.3), inset 0 1px 0 rgba(255,255,255,0.25)'
                : '0 4px 20px rgba(46,158,69,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
              opacity: loading || (mode === 'verify' && code.length !== 6) ? 0.55 : 1,
              transition: 'opacity 200ms, transform 100ms',
              letterSpacing: '0.02em',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {loading
              ? 'Loading…'
              : mode === 'verify' ? 'Verify & Sign In'
              : mode === 'signup' ? 'Create Account'
              : 'Sign In'}
          </button>

          {/* Verify-mode footer actions — resend + start over. Lives
              inside the form card so it reads as part of the same
              step. Resend is rate-limited server-side (1/min). */}
          {mode === 'verify' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
              <button
                onClick={resendCode}
                disabled={loading}
                style={{
                  flex: 1,
                  background: 'transparent', border: 'none',
                  color: 'rgba(255,255,255,0.45)', fontSize: 12,
                  cursor: loading ? 'default' : 'pointer', textDecoration: 'underline',
                  padding: 8, fontFamily: 'inherit',
                }}
              >
                Resend code
              </button>
              <button
                onClick={() => {
                  setMode('login'); setPendingUserId(null); setPendingEmail('')
                  setCode(''); setError(''); setInfo('')
                }}
                disabled={loading}
                style={{
                  flex: 1,
                  background: 'transparent', border: 'none',
                  color: 'rgba(255,255,255,0.45)', fontSize: 12,
                  cursor: loading ? 'default' : 'pointer', textDecoration: 'underline',
                  padding: 8, fontFamily: 'inherit',
                }}
              >
                Use a different account
              </button>
            </div>
          )}
        </div>

        {/* Footer note */}
        <p style={{
          color: 'rgba(255,255,255,0.2)', fontSize: 12,
          textAlign: 'center', marginTop: 24, lineHeight: 1.6,
        }}>
          By continuing you agree to The Match<br />Terms of Service &amp; Privacy Policy
        </p>
      </div>
    </div>
  )
}

function PremiumInput({ label, value, onChange, placeholder, type = 'text', maxLength, inputMode, autoComplete, focused, onFocus, onBlur, onKeyDown }) {
  return (
    <div>
      <label style={{
        display: 'block', marginBottom: 8,
        fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: focused ? 'rgba(94,212,122,0.8)' : 'rgba(255,255,255,0.35)',
        transition: 'color 200ms',
      }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        style={{
          width: '100%', padding: '14px 16px', boxSizing: 'border-box',
          background: focused ? 'rgba(94,212,122,0.05)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${focused ? 'rgba(94,212,122,0.4)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 10,
          color: '#fff', fontSize: 16, outline: 'none',
          boxShadow: focused ? '0 0 0 3px rgba(94,212,122,0.08)' : 'none',
          transition: 'all 200ms ease',
          caretColor: '#5ED47A',
        }}
      />
    </div>
  )
}
