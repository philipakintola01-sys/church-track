// src/pages/Members.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  getCachedMembers,
  getCachedAttendance,
  addMember,
  removeMember
} from '../lib/sync.js'

function formatDate(isoString) {
  const d = new Date(isoString)
  return d.toLocaleDateString('default', { year: 'numeric', month: 'short', day: 'numeric' })
}

function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

// ── Confirmation modal ────────────────────────────────────────────────────────
function ConfirmModal({ member, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Remove member?</h2>
        <p className="modal-body">
          Remove <strong>{member.name}</strong>? This will permanently delete
          all their attendance history and cannot be undone.
        </p>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn-confirm-delete" onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  )
}

export default function Members() {
  const [members,       setMembers]       = useState([])
  const [attendance,    setAttendance]    = useState([])
  const [search,        setSearch]        = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)

  // Add-member form
  const [name,      setName]      = useState('')
  const [groupName, setGroupName] = useState('')
  const [phone,     setPhone]     = useState('')
  const [adding,    setAdding]    = useState(false)

  const loadData = useCallback(async () => {
    const [m, a] = await Promise.all([getCachedMembers(), getCachedAttendance()])
    setMembers(m)
    setAttendance(a)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.group_name.toLowerCase().includes(search.toLowerCase())
  )

  function servicesAttended(memberId) {
    return attendance.filter(a => a.member_id === memberId).length
  }

  function onTimeCount(memberId) {
    return attendance.filter(a => a.member_id === memberId && a.status === 'green').length
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setAdding(true)
    await addMember({ name: name.trim(), group_name: groupName.trim() || 'General', phone: phone.trim() || null })
    setName('')
    setGroupName('')
    setPhone('')
    setAdding(false)
    await loadData()
  }

  const handleRemoveConfirm = async () => {
    if (!confirmTarget) return
    await removeMember(confirmTarget.id)
    setConfirmTarget(null)
    await loadData()
  }

  return (
    <div>
      {confirmTarget && (
        <ConfirmModal
          member={confirmTarget}
          onConfirm={handleRemoveConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      <div className="page-header">
        <h1 className="page-title">Members</h1>
      </div>

      <div className="members-layout">
        {/* ── Member list ─────────────────────────────────────────────────── */}
        <div className="members-list-card">
          <div className="members-list-header">
            <input
              type="text"
              className="search-input"
              placeholder="Search name or group…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className="members-count">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">👥</div>
              <div className="empty-state-title">
                {members.length === 0 ? 'No members yet' : 'No results'}
              </div>
              <div className="empty-state-body">
                {members.length === 0
                  ? 'Add your first member using the form on the right.'
                  : 'Try a different search term.'}
              </div>
            </div>
          ) : (
            filtered.map(m => (
              <div key={m.id} className="member-row">
                <div className="avatar">{initials(m.name)}</div>

                <div className="member-info">
                  <div className="member-row-name">{m.name}</div>
                  <div className="member-row-meta">
                    {m.group_name} · Added {formatDate(m.created_at)}
                    {m.phone && <> · <span style={{ color: 'var(--accent)' }}>{m.phone}</span></>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="member-stats">
                    <div className="mstat">
                      <span className="mstat-value">{servicesAttended(m.id)}</span>
                      <span className="mstat-label">Services</span>
                    </div>
                    <div className="mstat">
                      <span className="mstat-value" style={{ color: 'var(--green)' }}>
                        {onTimeCount(m.id)}
                      </span>
                      <span className="mstat-label">On Time</span>
                    </div>
                  </div>
                  <button className="btn-remove" onClick={() => setConfirmTarget(m)}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div>
          {/* Add member card */}
          <div className="add-member-card">
            <h2 className="section-title">Add Member</h2>
            <form className="add-member-form" onSubmit={handleAdd}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="member-name">Name *</label>
                <input
                  id="member-name"
                  type="text"
                  className="form-input"
                  placeholder="Full name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="member-group">Group</label>
                <input
                  id="member-group"
                  type="text"
                  className="form-input"
                  placeholder="General"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="member-phone">Phone</label>
                <input
                  id="member-phone"
                  type="tel"
                  className="form-input"
                  placeholder="+1 234 567 8900"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn-add"
                disabled={!name.trim() || adding}
              >
                {adding ? 'Adding…' : '+ Add Member'}
              </button>
            </form>

            {/* Arrival time thresholds reference */}
            <div className="ref-box">
              <strong>Arrival time thresholds</strong><br />
              <div className="threshold-row">
                <span className="badge badge-green">On Time</span>
                <span>Before 7:40 AM</span>
              </div>
              <div className="threshold-row">
                <span className="badge badge-yellow">Late</span>
                <span>7:40 – 7:59 AM</span>
              </div>
              <div className="threshold-row">
                <span className="badge badge-red">Very Late</span>
                <span>8:00 AM or after</span>
              </div>
            </div>

            {/* Tracking note */}
            <div className="ref-box" style={{ marginTop: 10 }}>
              <strong>Note:</strong> Members are tracked from the date they are
              added. They will not appear on dates prior to joining.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
