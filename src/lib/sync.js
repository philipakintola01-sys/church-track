// src/lib/sync.js
// Single module that owns all local-cache reads/writes and the offline queue.

import localforage from 'localforage'
import { supabase } from './supabase.js'

// ─── Storage keys ────────────────────────────────────────────────────────────
const MEMBERS_KEY    = 'ct_members'
const ATTENDANCE_KEY = 'ct_attendance'
const QUEUE_KEY      = 'ct_queue'

// ─── Sync-status pub/sub ─────────────────────────────────────────────────────
// Possible values: 'synced' | 'saving' | 'failed'
// 'offline' is handled in App.jsx by watching navigator.onLine separately.
let _currentStatus = 'synced'
const _listeners   = new Set()

function _setStatus(status) {
  _currentStatus = status
  _listeners.forEach(fn => fn(status))
}

export function getSyncStatus() {
  return _currentStatus
}

/** Subscribe to sync status changes. Returns an unsubscribe function. */
export function onSyncStatus(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
export async function getCachedMembers() {
  return (await localforage.getItem(MEMBERS_KEY)) || []
}

export async function getCachedAttendance() {
  return (await localforage.getItem(ATTENDANCE_KEY)) || []
}

async function _saveMembers(members) {
  await localforage.setItem(MEMBERS_KEY, members)
}

async function _saveAttendance(attendance) {
  await localforage.setItem(ATTENDANCE_KEY, attendance)
}

// ─── Queue helpers ────────────────────────────────────────────────────────────
async function _getQueue() {
  return (await localforage.getItem(QUEUE_KEY)) || []
}

async function _pushToQueue(action) {
  const q = await _getQueue()
  q.push(action)
  await localforage.setItem(QUEUE_KEY, q)
}

// ─── Execute a single queue action against Supabase ──────────────────────────
async function _executeAction(action) {
  switch (action.type) {
    case 'upsert_attendance':
      await supabase
        .from('attendance')
        .upsert(action.data, { onConflict: 'member_id,date' })
      break
    case 'delete_attendance':
      await supabase
        .from('attendance')
        .delete()
        .eq('member_id', action.member_id)
        .eq('date', action.date)
      break
    case 'add_member':
      await supabase.from('members').insert(action.data)
      break
    case 'remove_member':
      await supabase.from('members').delete().eq('id', action.id)
      break
    default:
      break
  }
}

// ─── Flush the offline queue ──────────────────────────────────────────────────
export async function flushQueue() {
  const queue = await _getQueue()
  if (!queue.length) return

  _setStatus('saving')
  const failed = []

  for (const action of queue) {
    try {
      await _executeAction(action)
    } catch {
      failed.push(action)
    }
  }

  await localforage.setItem(QUEUE_KEY, failed)

  if (failed.length) {
    _setStatus('failed')
  } else {
    await syncFromSupabase()
  }
}

// ─── Full re-fetch from Supabase, overwrite cache ─────────────────────────────
export async function syncFromSupabase() {
  if (!navigator.onLine) return
  _setStatus('saving')
  try {
    const [{ data: members, error: me }, { data: attendance, error: ae }] =
      await Promise.all([
        supabase.from('members').select('*').order('name'),
        supabase.from('attendance').select('*')
      ])
    if (me || ae) throw me || ae
    await _saveMembers(members   || [])
    await _saveAttendance(attendance || [])
    _setStatus('synced')
  } catch {
    _setStatus('failed')
  }
}

// ─── Optimistic writes ────────────────────────────────────────────────────────

/**
 * Upsert an attendance record.
 * record: { member_id, date, arrival_time, status }
 */
export async function upsertAttendance({ member_id, date, arrival_time, status }) {
  const attendance = await getCachedAttendance()
  const existing   = attendance.find(a => a.member_id === member_id && a.date === date)
  const id         = existing ? existing.id : crypto.randomUUID()
  const created_at = existing ? existing.created_at : new Date().toISOString()
  const record     = { id, member_id, date, arrival_time, status, created_at }

  // Optimistic cache update
  if (existing) {
    const idx = attendance.indexOf(existing)
    attendance[idx] = record
  } else {
    attendance.push(record)
  }
  await _saveAttendance(attendance)

  const action = { type: 'upsert_attendance', data: record }
  if (navigator.onLine) {
    _setStatus('saving')
    try {
      await _executeAction(action)
      _setStatus('synced')
    } catch {
      await _pushToQueue(action)
      _setStatus('failed')
    }
  } else {
    await _pushToQueue(action)
  }
}

/**
 * Delete an attendance record by member_id + date.
 */
export async function deleteAttendance(member_id, date) {
  const attendance = await getCachedAttendance()
  await _saveAttendance(attendance.filter(a => !(a.member_id === member_id && a.date === date)))

  const action = { type: 'delete_attendance', member_id, date }
  if (navigator.onLine) {
    _setStatus('saving')
    try {
      await _executeAction(action)
      _setStatus('synced')
    } catch {
      await _pushToQueue(action)
      _setStatus('failed')
    }
  } else {
    await _pushToQueue(action)
  }
}

/**
 * Add a new member.
 * memberData: { name, group_name, phone }
 * Returns the full member object (with id + created_at).
 */
export async function addMember({ name, group_name, phone }) {
  const members   = await getCachedMembers()
  const newMember = {
    id:         crypto.randomUUID(),
    name,
    group_name: group_name || 'General',
    phone:      phone || null,
    created_at: new Date().toISOString()
  }
  members.push(newMember)
  members.sort((a, b) => a.name.localeCompare(b.name))
  await _saveMembers(members)

  const action = { type: 'add_member', data: newMember }
  if (navigator.onLine) {
    _setStatus('saving')
    try {
      await _executeAction(action)
      _setStatus('synced')
    } catch {
      await _pushToQueue(action)
      _setStatus('failed')
    }
  } else {
    await _pushToQueue(action)
  }

  return newMember
}

/**
 * Remove a member and all their local attendance records.
 */
export async function removeMember(id) {
  const members    = await getCachedMembers()
  const attendance = await getCachedAttendance()
  await _saveMembers(members.filter(m => m.id !== id))
  await _saveAttendance(attendance.filter(a => a.member_id !== id))

  const action = { type: 'remove_member', id }
  if (navigator.onLine) {
    _setStatus('saving')
    try {
      await _executeAction(action)
      _setStatus('synced')
    } catch {
      await _pushToQueue(action)
      _setStatus('failed')
    }
  } else {
    await _pushToQueue(action)
  }
}

// ─── Initialise: listen for coming back online ────────────────────────────────
export function initSync() {
  window.addEventListener('online', async () => {
    await flushQueue()
  })
}
