// src/App.jsx
import { useState, useEffect, useRef, Component } from 'react'
import { supabase } from './lib/supabase.js'
import { initSync, syncFromSupabase, onSyncStatus } from './lib/sync.js'
import Login      from './pages/Login.jsx'
import Attendance from './pages/Attendance.jsx'
import Members    from './pages/Members.jsx'
import Analytics  from './pages/Analytics.jsx'

// ── Error boundary for Analytics ─────────────────────────────────────────────
class AnalyticsErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: '#fee2e2', color: '#7f1d1d', borderRadius: 8, margin: 16 }}>
          <strong>Analytics error (send this to developer):</strong>
          <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}{'\n'}{this.state.error?.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: '4px 12px' }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── 2FA Setup Modal ───────────────────────────────────────────────────────────
function MfaModal({ onClose }) {
  const [step,     setStep]     = useState('menu')  // menu | enroll | success
  const [factors,  setFactors]  = useState([])
  const [qrCode,   setQrCode]   = useState('')
  const [secret,   setSecret]   = useState('')
  const [factorId, setFactorId] = useState(null)
  const [code,     setCode]     = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setFactors(data?.totp || [])
    })
  }, [])

  const startEnroll = async () => {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    if (err) { setError(err.message); setLoading(false); return }
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setFactorId(data.id)
    setStep('enroll')
    setLoading(false)
  }

  const verifyEnroll = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s/g, '')
    })
    if (err) { setError(err.message); setLoading(false); return }
    setStep('success')
    setLoading(false)
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors(data?.totp || [])
  }

  const removeFactor = async (id) => {
    setLoading(true)
    await supabase.auth.mfa.unenroll({ factorId: id })
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors(data?.totp || [])
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card mfa-modal" onClick={e => e.stopPropagation()}>

        {step === 'menu' && (
          <>
            <h2 className="modal-title">Two-Factor Authentication</h2>
            {factors.length === 0 ? (
              <>
                <p className="modal-body">
                  Add an extra layer of security. After enabling, you'll need your
                  authenticator app (Google Authenticator, Authy, etc.) each time you sign in.
                </p>
                <div className="mfa-badges">
                  <span className="mfa-badge">🔐 TOTP</span>
                  <span className="mfa-badge">📱 Any authenticator app</span>
                  <span className="mfa-badge">⚡ 30-second codes</span>
                </div>
                <div className="modal-actions">
                  <button className="btn-cancel" onClick={onClose}>Cancel</button>
                  <button className="btn-primary" onClick={startEnroll} disabled={loading}>
                    {loading ? 'Setting up…' : 'Enable 2FA'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-body mfa-enabled-msg">
                  ✅ Two-factor authentication is <strong>active</strong> on your account.
                </p>
                {factors.map(f => (
                  <div key={f.id} className="mfa-factor-row">
                    <span>🔐 TOTP authenticator</span>
                    <button
                      className="btn-confirm-delete"
                      onClick={() => removeFactor(f.id)}
                      disabled={loading}
                    >
                      {loading ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))}
                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="btn-cancel" onClick={onClose}>Close</button>
                </div>
              </>
            )}
            {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
          </>
        )}

        {step === 'enroll' && (
          <>
            <h2 className="modal-title">Scan QR Code</h2>
            <p className="modal-body">
              Open your authenticator app, tap <strong>+</strong> and scan the QR code below.
            </p>
            <div className="mfa-qr-wrap">
              {qrCode
                ? <img src={qrCode} alt="2FA QR Code" className="mfa-qr" />
                : <div className="mfa-qr-placeholder">Loading QR…</div>
              }
            </div>
            <p className="totp-hint" style={{ textAlign: 'center' }}>
              Can't scan? Enter this secret manually:<br />
              <code className="mfa-secret">{secret}</code>
            </p>
            <form onSubmit={verifyEnroll}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="enroll-code">Confirm 6-digit code</label>
                <input
                  id="enroll-code"
                  type="text"
                  inputMode="numeric"
                  className="form-input totp-input"
                  placeholder="000 000"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ''))}
                  maxLength={7}
                  autoFocus
                />
              </div>
              {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-cancel"
                  onClick={() => { setStep('menu'); setCode(''); setError('') }}>
                  Back
                </button>
                <button type="submit" className="btn-primary"
                  disabled={loading || code.replace(/\s/g, '').length < 6}>
                  {loading ? 'Verifying…' : 'Activate 2FA'}
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'success' && (
          <>
            <div className="mfa-success-icon">🎉</div>
            <h2 className="modal-title">2FA Enabled!</h2>
            <p className="modal-body">
              Your account is now protected with two-factor authentication.
              You'll be asked for a code every time you sign in.
            </p>
            <div className="modal-actions">
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session,    setSession]    = useState(null)
  const [authReady,  setAuthReady]  = useState(false)
  const [tab,        setTab]        = useState('attendance')
  const [online,     setOnline]     = useState(navigator.onLine)
  const [syncStatus, setSyncStatus] = useState('synced')
  const [showMfa,    setShowMfa]    = useState(false)

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setAuthReady(true)
      })
      .catch(() => setAuthReady(true))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Online / offline ────────────────────────────────────────────────────────
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // ── Sync ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSyncStatus(setSyncStatus)
    initSync()
    return unsub
  }, [])

  useEffect(() => {
    if (session && navigator.onLine) syncFromSupabase()
  }, [session])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
  }

  const syncLabel =
    !online                 ? 'Offline'     :
    syncStatus === 'saving' ? 'Saving...'   :
    syncStatus === 'failed' ? 'Sync failed' :
    'Synced'

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!authReady) return <div className="loading-screen">Loading…</div>
  if (!session)   return <Login onLogin={setSession} />

  return (
    <div className="app">
      {showMfa && <MfaModal onClose={() => setShowMfa(false)} />}

      <header className="header">
        <span className="header-brand">✝ ChurchTrack</span>

        <nav className="header-nav">
          {['attendance', 'members', 'analytics'].map(t => (
            <button
              key={t}
              className={`nav-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <span className={`status-dot ${online ? 'online' : 'offline'}`} />
          <span className="sync-text">{syncLabel}</span>
          <button className="btn-2fa" onClick={() => setShowMfa(true)} title="Two-Factor Authentication">
            🔐 2FA
          </button>
          <button className="btn-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>

      <main className="main-content">
        {tab === 'attendance' && <Attendance />}
        {tab === 'members'    && <Members    />}
        {tab === 'analytics'  && <AnalyticsErrorBoundary><Analytics /></AnalyticsErrorBoundary>}
      </main>
    </div>
  )
}
