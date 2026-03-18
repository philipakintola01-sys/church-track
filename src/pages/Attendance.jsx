// src/pages/Attendance.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  getCachedMembers,
  getCachedAttendance,
  upsertAttendance,
  deleteAttendance
} from '../lib/sync.js'

// ── Helpers ────────────────────────────────────────────────────────────────────
function todayStr() {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('default', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

function formatTime12(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Derives status from time string "HH:MM" */
function getStatus(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const mins = h * 60 + m
  if (mins < 460) return 'green'   // before 7:40
  if (mins < 480) return 'yellow'  // 7:40 – 7:59
  return 'red'                      // 8:00+
}

function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    green:  { cls: 'badge-green',  label: 'On Time'   },
    yellow: { cls: 'badge-yellow', label: 'Late'      },
    red:    { cls: 'badge-red',    label: 'Very Late' },
    absent: { cls: 'badge-absent', label: 'Absent'    }
  }
  const { cls, label } = map[status] || map.absent
  return <span className={`badge ${cls}`}>{label}</span>
}

// ── CSV export ─────────────────────────────────────────────────────────────────
function exportCsv(members, attendanceMap, viewDate) {
  const statusLabel = s =>
    s === 'green' ? 'On Time' : s === 'yellow' ? 'Late' : s === 'red' ? 'Very Late' : 'Absent'

  const rows = [['Name', 'Group', 'Date', 'Arrival Time', 'Status']]
  members.forEach(m => {
    const rec = attendanceMap[m.id]
    rows.push([
      m.name,
      m.group_name,
      viewDate,
      rec ? rec.arrival_time : '',
      statusLabel(rec ? rec.status : 'absent')
    ])
  })

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `attendance-${viewDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function Attendance() {
  const [viewDate,   setViewDate]   = useState(todayStr)
  const [members,    setMembers]    = useState([])
  const [attendance, setAttendance] = useState([])
  const [search,     setSearch]     = useState('')

  const today  = todayStr()
  const isToday = viewDate === today

  const loadData = useCallback(async () => {
    const [m, a] = await Promise.all([getCachedMembers(), getCachedAttendance()])
    setMembers(m)
    setAttendance(a)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived data ────────────────────────────────────────────────────────────
  // Only show members whose created_at date is on or before viewDate
  const visibleMembers = members.filter(m => m.created_at.slice(0, 10) <= viewDate)

  const filteredMembers = visibleMembers.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.group_name.toLowerCase().includes(search.toLowerCase())
  )

  // Map member_id → attendance record for the current viewDate
  const dayAttendance = attendance.filter(a => a.date === viewDate)
  const attendanceMap = Object.fromEntries(dayAttendance.map(a => [a.member_id, a]))

  // Stats (across all visible members, not just filtered)
  const visibleIds  = new Set(visibleMembers.map(m => m.id))
  const dayPresent  = dayAttendance.filter(a => visibleIds.has(a.member_id))
  const presentCount = dayPresent.length
  const onTimeCount  = dayPresent.filter(a => a.status === 'green').length
  const lateCount    = dayPresent.filter(a => a.status === 'yellow').length
  const veryLateCount= dayPresent.filter(a => a.status === 'red').length
  const total        = visibleMembers.length
  const pct          = total > 0 ? Math.round((presentCount / total) * 100) : 0

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleMark = async (memberId) => {
    const now     = new Date()
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    const status  = getStatus(timeStr)
    await upsertAttendance({ member_id: memberId, date: viewDate, arrival_time: timeStr, status })
    await loadData()
  }

  const handleDelete = async (memberId) => {
    await deleteAttendance(memberId, viewDate)
    await loadData()
  }

  const navigate = (delta) => {
    const next = addDays(viewDate, delta)
    if (next <= today) setViewDate(next)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header row: title + date nav */}
      <div className="page-header">
        <h1 className="page-title">{formatDisplayDate(viewDate)}</h1>

        <div className="date-nav">
          <button className="date-nav-btn" onClick={() => navigate(-1)}>‹</button>

          <input
            type="date"
            className="date-input"
            value={viewDate}
            max={today}
            onChange={e => { if (e.target.value <= today) setViewDate(e.target.value) }}
          />

          <button
            className="date-nav-btn"
            onClick={() => navigate(1)}
            disabled={viewDate >= today}
          >
            ›
          </button>

          {!isToday && (
            <button className="btn-today" onClick={() => setViewDate(today)}>
              Today
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-value">{presentCount}</div>
          <div className="stat-label">Present</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--green)' }}>{onTimeCount}</div>
          <div className="stat-label">On Time</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--yellow)' }}>{lateCount}</div>
          <div className="stat-label">Late</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--red)' }}>{veryLateCount}</div>
          <div className="stat-label">Very Late</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pct}%</div>
          <div className="stat-label">Attendance</div>
        </div>
      </div>

      {/* Live indicator — today only */}
      {isToday && (
        <div className="live-indicator">
          <span className="live-dot" />
          <span>
            <strong>Live</strong> — clicking <strong>Mark</strong> records the current time automatically
          </span>
        </div>
      )}

      {/* Table toolbar: search + CSV */}
      <div className="table-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="Search name or group…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          className="btn-csv"
          onClick={() => exportCsv(filteredMembers, attendanceMap, viewDate)}
          disabled={filteredMembers.length === 0}
        >
          ↓ CSV
        </button>
      </div>

      {/* Roster table */}
      <div className="roster-wrap">
        {filteredMembers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">
              {visibleMembers.length === 0
                ? 'No members for this date'
                : 'No results'}
            </div>
            <div className="empty-state-body">
              {visibleMembers.length === 0
                ? 'Members are only shown from their join date onwards.'
                : 'Try a different search term.'}
            </div>
          </div>
        ) : (
          <table className="roster-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Group</th>
                <th>Arrived</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map(m => {
                const rec = attendanceMap[m.id]
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="member-cell">
                        <div className="avatar">{initials(m.name)}</div>
                        <span className="member-name">{m.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="group-chip">{m.group_name}</span>
                    </td>
                    <td>
                      {rec ? formatTime12(rec.arrival_time) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      <StatusBadge status={rec ? rec.status : 'absent'} />
                    </td>
                    <td>
                      {isToday ? (
                        rec ? (
                          <div className="action-group">
                            <button className="btn-remark" onClick={() => handleMark(m.id)}>
                              ↺ Re-mark
                            </button>
                            <button className="btn-delete" onClick={() => handleDelete(m.id)}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button className="btn-mark" onClick={() => handleMark(m.id)}>
                            ✓ Mark
                          </button>
                        )
                      ) : (
                        rec ? (
                          <button className="btn-delete" onClick={() => handleDelete(m.id)}>
                            ✕
                          </button>
                        ) : null
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
