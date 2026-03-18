// src/pages/Login.jsx
import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

// ── Brute-force protection (DEFCON #3) ────────────────────────────────────────
const MAX_ATTEMPTS  = 5
const LOCKOUT_MS    = 15 * 60 * 1000   // 15 minutes
const LOCKOUT_KEY   = 'ct_login_lockout'

function getLockout() {
  try { return JSON.parse(localStorage.getItem(LOCKOUT_KEY)) || { attempts: 0, lockedUntil: 0 } }
  catch { return { attempts: 0, lockedUntil: 0 } }
}
function saveLockout(d) { localStorage.setItem(LOCKOUT_KEY, JSON.stringify(d)) }

// ─────────────────────────────────────────────────────────────────────────────
export default function Login({ onLogin }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [code,     setCode]     = useState('')
  const [stage,    setStage]    = useState('password') // 'password' | 'totp'
  const [factorId, setFactorId] = useState(null)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const lk          = getLockout()
  const isLocked    = lk.lockedUntil > Date.now()
  const minutesLeft = Math.ceil((lk.lockedUntil - Date.now()) / 60000)

  // ── Stage 1: email + password ─────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault()
    if (isLocked) return
    setError('')
    setLoading(true)

    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password })

    if (authErr) {
      const state    = getLockout()
      const attempts = state.attempts + 1
      const lockedUntil = attempts >= MAX_ATTEMPTS
        ? Date.now() + LOCKOUT_MS
        : state.lockedUntil
      saveLockout({ attempts, lockedUntil })
      setError(
        attempts >= MAX_ATTEMPTS
          ? 'Too many failed attempts. Account locked for 15 minutes.'
          : `${authErr.message} — ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts !== 1 ? 's' : ''} left`
      )
      setLoading(false)
      return
    }

    // Reset lockout on success
    saveLockout({ attempts: 0, lockedUntil: 0 })

    // ── Check if MFA is required ───────────────────────────────────────────
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const { data: fData } = await supabase.auth.mfa.listFactors()
      const totp = fData?.totp?.[0]
      if (totp) {
        setFactorId(totp.id)
        setStage('totp')
        setLoading(false)
        return
      }
    }

    onLogin(data.session)
  }

  // ── Stage 2: TOTP verification ────────────────────────────────────────────
  const handleTotp = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: mfaErr } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s/g, '')
    })
    if (mfaErr) {
      setError(mfaErr.message)
      setLoading(false)
      return
    }
    onLogin(data.session)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">✝</div>
        <h1 className="login-title">ChurchTrack</h1>
        <p className="login-subtitle">
          {stage === 'totp' ? 'Enter your 6-digit authenticator code' : 'Sign in to manage attendance'}
        </p>

        {isLocked && (
          <div className="form-error security-lockout">
            🔒 Account locked — too many failed attempts.<br />
            Try again in <strong>{minutesLeft} minute{minutesLeft !== 1 ? 's' : ''}</strong>.
          </div>
        )}
        {error && !isLocked && <div className="form-error">{error}</div>}

        {stage === 'password' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="admin@church.org"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLocked}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={isLocked}
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !email || !password || isLocked}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleTotp}>
            <div className="form-group">
              <label className="form-label" htmlFor="totp-code">Authenticator Code</label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                className="form-input totp-input"
                placeholder="000 000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))}
                required
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
              />
              <p className="totp-hint">Open your authenticator app and enter the 6-digit code.</p>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || code.replace(/\s/g, '').length < 6}
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn-text-link"
              onClick={() => { setStage('password'); setCode(''); setError('') }}
            >
              ← Back to sign in
            </button>
          </form>
        )}

        <div className="login-security-badge">
          🛡️ Protected by 2FA &amp; brute-force lockout
        </div>
      </div>
    </div>
  )
}
