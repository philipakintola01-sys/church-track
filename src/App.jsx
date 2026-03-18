// src/App.jsx
import { useState, useEffect, Component } from 'react'

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
import { supabase } from './lib/supabase.js'
import { initSync, syncFromSupabase, onSyncStatus } from './lib/sync.js'
import Login      from './pages/Login.jsx'
import Attendance from './pages/Attendance.jsx'
import Members    from './pages/Members.jsx'
import Analytics  from './pages/Analytics.jsx'

export default function App() {
  const [session,    setSession]    = useState(null)
  const [authReady,  setAuthReady]  = useState(false)
  const [tab,        setTab]        = useState('attendance')
  const [online,     setOnline]     = useState(navigator.onLine)
  const [syncStatus, setSyncStatus] = useState('synced')

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setAuthReady(true)
      })
      .catch(() => {
        setAuthReady(true)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Online / offline ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleOnline  = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // ── Sync status subscription ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSyncStatus(setSyncStatus)
    initSync()
    return unsub
  }, [])

  // ── Initial data fetch when session becomes available ───────────────────────
  useEffect(() => {
    if (session && navigator.onLine) {
      syncFromSupabase()
    }
  }, [session])

  // ── Sign out ────────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
  }

  const syncLabel =
    !online                    ? 'Offline'      :
    syncStatus === 'saving'    ? 'Saving...'    :
    syncStatus === 'failed'    ? 'Sync failed'  :
    'Synced'

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!authReady) {
    return <div className="loading-screen">Loading…</div>
  }

  if (!session) {
    return <Login onLogin={setSession} />
  }

  return (
    <div className="app">
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
