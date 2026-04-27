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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') submit()
  }

  return (
    <div style={{
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      background: '#060E08',
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

        {/* Mode toggle pills */}
        <div style={{
          display: 'flex', width: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12, padding: 3, gap: 3, marginBottom: 24,
        }}>
          {['login', 'signup'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError('') }} style={{
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
            onClick={submit}
            disabled={loading}
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
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 200ms, transform 100ms',
              letterSpacing: '0.02em',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {loading ? 'Loading…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
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

function PremiumInput({ label, value, onChange, placeholder, type = 'text', maxLength, inputMode, focused, onFocus, onBlur, onKeyDown }) {
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
