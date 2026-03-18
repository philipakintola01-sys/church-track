// src/pages/Analytics.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  Tooltip,
  Legend as ChartJSLegend,
  Filler
} from 'chart.js'
import { getCachedMembers, getCachedAttendance } from '../lib/sync.js'

Chart.register(
  CategoryScale, LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  Tooltip, ChartJSLegend, Filler
)

// ─── Palettes ─────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  green:  '#16a34a',
  yellow: '#ca8a04',
  red:    '#dc2626',
  absent: '#9ca3af'
}
const COMPARE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
const GROUP_COLORS   = [
  '#6366f1','#10b981','#f59e0b','#ec4899','#8b5cf6',
  '#14b8a6','#f97316','#3b82f6','#ef4444','#84cc16'
]
const SCORE_LABELS = { 0: 'Absent', 1: 'Very Late', 2: 'Late', 3: 'On Time' }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexAlpha(hex, a) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

/** Returns a Chart.js backgroundColor function that renders a vertical gradient */
function gradFill(color, topAlpha = 0.4, bottomAlpha = 0.02) {
  return (context) => {
    const { chart } = context
    const { ctx, chartArea } = chart
    if (!chartArea) return hexAlpha(color, topAlpha)
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
    gradient.addColorStop(0, hexAlpha(color, topAlpha))
    gradient.addColorStop(1, hexAlpha(color, bottomAlpha))
    return gradient
  }
}

function shortDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('default', { month: 'short', day: 'numeric' })
}

function lastDayStr(year, month) {
  const d = new Date(year, month, 0)
  return `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function statusToScore(status) {
  if (status === 'green')  return 3
  if (status === 'yellow') return 2
  if (status === 'red')    return 1
  return 0
}

function scoreToColor(s) {
  if (s === 3) return STATUS_COLORS.green
  if (s === 2) return STATUS_COLORS.yellow
  if (s === 1) return STATUS_COLORS.red
  return STATUS_COLORS.absent
}

function chartTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return {
    grid:   dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    tick:   dark ? '#6b7280'                : '#9ca3af',
    ttBg:   dark ? 'rgba(15,23,42,0.97)'   : 'rgba(255,255,255,0.97)',
    ttBord: dark ? 'rgba(99,102,241,0.35)'  : 'rgba(99,102,241,0.25)',
    ttText: dark ? '#f1f5f9'               : '#0f172a',
  }
}

function ttCfg(T) {
  return {
    backgroundColor: T.ttBg,
    borderColor:     T.ttBord,
    borderWidth:     1,
    titleColor:      T.ttText,
    bodyColor:       T.tick,
    padding:         12,
    cornerRadius:    10,
    boxPadding:      4,
  }
}

function xScale(T, extra = {}) {
  return { grid: { color: T.grid }, ticks: { color: T.tick, font: { size: 11 } }, ...extra }
}
function yScale(T, extra = {}) {
  return { grid: { color: T.grid }, ticks: { color: T.tick, font: { size: 11 } }, ...extra }
}
function yScoreAxis(T) {
  return {
    min: -0.5, max: 3.5,
    grid:  { color: T.grid },
    ticks: { stepSize: 1, color: T.tick, font: { size: 11 }, callback: v => SCORE_LABELS[v] ?? '' }
  }
}

// ── Custom HTML legend — safe name (not 'Legend') ─────────────────────────────
function ChartLegend({ items }) {
  return (
    <div className="chart-legend">
      {items.map(it => (
        <div key={it.label} className="legend-item">
          <span className="legend-swatch" style={{ backgroundColor: it.color }} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Analytics() {
  const now = new Date()
  const [year,            setYear]            = useState(now.getFullYear())
  const [month,           setMonth]           = useState(now.getMonth() + 1)
  const [subTab,          setSubTab]          = useState('overview')
  const [members,         setMembers]         = useState([])
  const [attendance,      setAttendance]      = useState([])
  const [selectedMembers, setSelectedMembers] = useState([])  // Compare chip state

  // Canvas refs
  const trendRef    = useRef(null)
  const stackRef    = useRef(null)
  const doughRef    = useRef(null)
  const cmpLineRef  = useRef(null)
  const cmpBarRef   = useRef(null)
  const grpLineRef  = useRef(null)
  const grpBarRef   = useRef(null)

  // Active chart instances — keyed by name for safe cleanup
  const chartsRef = useRef({})

  // ── Data loading ─────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [m, a] = await Promise.all([getCachedMembers(), getCachedAttendance()])
    setMembers(m)
    setAttendance(a)
  }, [])
  useEffect(() => { loadData() }, [loadData])

  // ── Month navigation ──────────────────────────────────────────────────────
  const curYear  = now.getFullYear()
  const curMonth = now.getMonth() + 1

  const goPrev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else { setMonth(m => m - 1) }
  }
  const goNext = () => {
    if (year === curYear && month === curMonth) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else { setMonth(m => m + 1) }
  }
  const canGoNext = !(year === curYear && month === curMonth)
  const monthLabel = new Date(year, month - 1)
    .toLocaleString('default', { month: 'long', year: 'numeric' })

  // ── Derived month data (used by render + build functions) ─────────────────
  const prefix        = `${year}-${String(month).padStart(2, '0')}`
  const lastDay       = lastDayStr(year, month)
  const activeMembers = members.filter(m => m.created_at?.slice(0, 10) <= lastDay)
  const monthAtt      = attendance.filter(a => a.date.startsWith(prefix))
  const serviceDates  = [...new Set(monthAtt.map(a => a.date))].sort()

  // ── Chart lifecycle helpers ───────────────────────────────────────────────
  function destroyAll() {
    Object.values(chartsRef.current).forEach(c => { try { c.destroy() } catch {} })
    chartsRef.current = {}
  }

  function mk(key, ref, config) {
    if (chartsRef.current[key]) {
      try { chartsRef.current[key].destroy() } catch {}
      delete chartsRef.current[key]
    }
    if (!ref.current) return
    // Destroy any Chart.js instance on this canvas that we don't track
    // (happens in React StrictMode where effects run twice)
    const orphan = Chart.getChart(ref.current)
    if (orphan) { try { orphan.destroy() } catch {} }
    chartsRef.current[key] = new Chart(ref.current, config)
  }

  // ── Rebuild charts whenever relevant state changes ────────────────────────
  useEffect(() => {
    destroyAll()
    if      (subTab === 'overview')                           buildOverview()
    else if (subTab === 'compare' && selectedMembers.length)  buildCompare()
    else if (subTab === 'groups')                             buildGroups()
    return destroyAll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, year, month, members, attendance, selectedMembers])

  // ── BUILD: Overview ───────────────────────────────────────────────────────
  function buildOverview() {
    if (!serviceDates.length) return
    const T      = chartTheme()
    const labels = serviceDates.map(shortDate)

    // Per-service-date breakdown
    const perDate = serviceDates.map(date => {
      const act  = members.filter(m => m.created_at?.slice(0, 10) <= date)
      const recs = monthAtt.filter(a => a.date === date && act.some(m => m.id === a.member_id))
      const on   = recs.filter(r => r.status === 'green').length
      const la   = recs.filter(r => r.status === 'yellow').length
      const vl   = recs.filter(r => r.status === 'red').length
      const ab   = act.length - recs.length
      const pct  = act.length > 0 ? Math.round(recs.length / act.length * 100) : 0
      return { on, la, vl, ab, present: recs.length, total: act.length, pct }
    })

    // Trend line (dual-axis): present count + attendance %
    const ptColors = perDate.map(d =>
      d.pct >= 80 ? STATUS_COLORS.green : d.pct >= 50 ? STATUS_COLORS.yellow : STATUS_COLORS.red
    )
    mk('trend', trendRef, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Present',
            data: perDate.map(d => d.present),
            borderColor: '#6366f1',
            backgroundColor: gradFill('#6366f1', 0.35, 0.02),
            fill: true, tension: 0.4, borderWidth: 3,
            pointBackgroundColor: '#6366f1', pointRadius: 5, pointHoverRadius: 8,
            yAxisID: 'y'
          },
          {
            label: 'Attendance %',
            data: perDate.map(d => d.pct),
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            fill: false, tension: 0.4, borderWidth: 2.5, borderDash: [6, 4],
            pointBackgroundColor: ptColors, pointRadius: 5, pointHoverRadius: 8,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: ttCfg(T) },
        scales: {
          x:  xScale(T),
          y:  { position: 'left',  ...yScale(T) },
          y1: {
            position: 'right', min: 0, max: 100,
            grid: { drawOnChartArea: false },
            ticks: { color: T.tick, font: { size: 11 }, callback: v => `${v}%` }
          }
        }
      }
    })

    // Stacked bar — composition per service
    mk('stack', stackRef, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'On Time',   data: perDate.map(d => d.on), backgroundColor: STATUS_COLORS.green,  borderRadius: 3 },
          { label: 'Late',      data: perDate.map(d => d.la), backgroundColor: STATUS_COLORS.yellow, borderRadius: 0 },
          { label: 'Very Late', data: perDate.map(d => d.vl), backgroundColor: STATUS_COLORS.red,    borderRadius: 0 },
          { label: 'Absent',    data: perDate.map(d => d.ab), backgroundColor: STATUS_COLORS.absent, borderRadius: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: ttCfg(T) },
        scales: {
          x: { ...xScale(T), stacked: true },
          y: { ...yScale(T), stacked: true }
        }
      }
    })

    // Doughnut — aggregate for the month
    let tOn = 0, tLa = 0, tVl = 0, tAb = 0
    perDate.forEach(d => { tOn += d.on; tLa += d.la; tVl += d.vl; tAb += d.ab })
    mk('dough', doughRef, {
      type: 'doughnut',
      data: {
        labels: ['On Time', 'Late', 'Very Late', 'Absent'],
        datasets: [{
          data: [tOn, tLa, tVl, tAb],
          backgroundColor: [STATUS_COLORS.green, STATUS_COLORS.yellow, STATUS_COLORS.red, STATUS_COLORS.absent],
          borderWidth: 0, hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: {
          legend: {
            display: true, position: 'bottom',
            labels: { color: T.tick, padding: 14, font: { size: 12 }, boxWidth: 12 }
          },
          tooltip: ttCfg(T)
        }
      }
    })
  }

  // ── BUILD: Compare (individual when 1, multi-line when 2–5) ──────────────
  function buildCompare() {
    if (!serviceDates.length) return
    const T      = chartTheme()
    const labels = serviceDates.map(shortDate)

    if (selectedMembers.length === 1) {
      // ── Individual view ────────────────────────────────────────────────
      const mid    = selectedMembers[0]
      const color  = COMPARE_COLORS[0]
      const scores = serviceDates.map(date => {
        const rec = monthAtt.find(a => a.date === date && a.member_id === mid)
        return rec ? statusToScore(rec.status) : 0
      })
      const ptCols = scores.map(scoreToColor)

      mk('cmpLine', cmpLineRef, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: members.find(m => m.id === mid)?.name || 'Member',
            data: scores,
            borderColor: color,
            backgroundColor: gradFill(color, 0.3, 0.02),
            fill: true, tension: 0.4, borderWidth: 3,
            pointBackgroundColor: ptCols, pointRadius: 6, pointHoverRadius: 9
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { ...ttCfg(T), callbacks: { label: ctx => SCORE_LABELS[ctx.raw] ?? ctx.raw } }
          },
          scales: { x: xScale(T), y: yScoreAxis(T) }
        }
      })

      mk('cmpBar', cmpBarRef, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: members.find(m => m.id === mid)?.name || 'Member',
            data: scores,
            backgroundColor: ptCols,
            borderRadius: 5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { ...ttCfg(T), callbacks: { label: ctx => SCORE_LABELS[ctx.raw] ?? ctx.raw } }
          },
          scales: { x: xScale(T), y: yScoreAxis(T) }
        }
      })

    } else {
      // ── Multi-member comparison ────────────────────────────────────────
      const lineDatasets = selectedMembers.map((mid, i) => {
        const color  = COMPARE_COLORS[i]
        const scores = serviceDates.map(date => {
          const rec = monthAtt.find(a => a.date === date && a.member_id === mid)
          return rec ? statusToScore(rec.status) : 0
        })
        return {
          label: members.find(m => m.id === mid)?.name || mid,
          data: scores,
          borderColor: color,
          backgroundColor: gradFill(color, 0.18, 0.01),
          fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: color, pointRadius: 5, pointHoverRadius: 8
        }
      })

      mk('cmpLine', cmpLineRef, {
        type: 'line',
        data: { labels, datasets: lineDatasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true, position: 'top',
              labels: { color: chartTheme().tick, font: { size: 12 }, padding: 16, boxWidth: 12, usePointStyle: true }
            },
            tooltip: {
              ...ttCfg(T),
              callbacks: { label: ctx => `${ctx.dataset.label}: ${SCORE_LABELS[ctx.raw] ?? ctx.raw}` }
            }
          },
          scales: { x: xScale(T), y: yScoreAxis(T) }
        }
      })

      // Average score horizontal bar
      mk('cmpBar', cmpBarRef, {
        type: 'bar',
        data: {
          labels: selectedMembers.map(mid => members.find(m => m.id === mid)?.name || mid),
          datasets: [{
            label: 'Avg Score',
            data: selectedMembers.map(mid => {
              const scores = serviceDates.map(date => {
                const rec = monthAtt.find(a => a.date === date && a.member_id === mid)
                return rec ? statusToScore(rec.status) : 0
              })
              return scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0
            }),
            backgroundColor: selectedMembers.map((_, i) => hexAlpha(COMPARE_COLORS[i], 0.8)),
            borderColor: selectedMembers.map((_, i) => COMPARE_COLORS[i]),
            borderWidth: 2, borderRadius: 6
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...ttCfg(T),
              callbacks: { label: ctx => `Avg: ${ctx.raw} / 3.0` }
            }
          },
          scales: {
            x: { ...yScoreAxis(T), min: 0, max: 3.5 },
            y: { grid: { color: 'transparent' }, ticks: { color: T.tick, font: { size: 12 } } }
          }
        }
      })
    }
  }

  // ── BUILD: Groups ─────────────────────────────────────────────────────────
  function buildGroups() {
    if (!serviceDates.length) return
    const T           = chartTheme()
    const labels      = serviceDates.map(shortDate)
    const allGroups   = [...new Set(activeMembers.map(m => m.group_name))].sort()
    if (!allGroups.length) return

    // Per-group trend lines
    const gDatasets = allGroups.map((group, gi) => {
      const color   = GROUP_COLORS[gi % GROUP_COLORS.length]
      const gmembs  = activeMembers.filter(m => m.group_name === group)
      const pcts    = serviceDates.map(date => {
        const act  = gmembs.filter(m => m.created_at?.slice(0, 10) <= date)
        const recs = monthAtt.filter(a => a.date === date && act.some(m => m.id === a.member_id))
        return act.length > 0 ? Math.round(recs.length / act.length * 100) : 0
      })
      return {
        label: group,
        data: pcts,
        borderColor: color,
        backgroundColor: gradFill(color, 0.15, 0.01),
        fill: true, tension: 0.4, borderWidth: 2.5,
        pointBackgroundColor: color, pointRadius: 4, pointHoverRadius: 7
      }
    })

    mk('grpLine', grpLineRef, {
      type: 'line',
      data: { labels, datasets: gDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true, position: 'top',
            labels: { color: T.tick, font: { size: 12 }, padding: 16, boxWidth: 12, usePointStyle: true }
          },
          tooltip: { ...ttCfg(T), callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } }
        },
        scales: {
          x: xScale(T),
          y: yScale(T, { min: 0, max: 100, ticks: { ...yScale(T).ticks, callback: v => `${v}%` } })
        }
      }
    })

    // Horizontal bar — average attendance % per group
    const avgPcts = allGroups.map((group, gi) => {
      const gmembs = activeMembers.filter(m => m.group_name === group)
      const total  = serviceDates.reduce((acc, date) => {
        const act  = gmembs.filter(m => m.created_at?.slice(0, 10) <= date)
        const recs = monthAtt.filter(a => a.date === date && act.some(m => m.id === a.member_id))
        return acc + (act.length > 0 ? recs.length / act.length * 100 : 0)
      }, 0)
      return serviceDates.length > 0 ? Math.round(total / serviceDates.length) : 0
    })

    mk('grpBar', grpBarRef, {
      type: 'bar',
      data: {
        labels: allGroups,
        datasets: [{
          label: 'Avg Attendance %',
          data: avgPcts,
          backgroundColor: allGroups.map((_, i) => hexAlpha(GROUP_COLORS[i % GROUP_COLORS.length], 0.8)),
          borderColor: allGroups.map((_, i) => GROUP_COLORS[i % GROUP_COLORS.length]),
          borderWidth: 2, borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...ttCfg(T), callbacks: { label: ctx => `${ctx.raw}% avg attendance` } }
        },
        scales: {
          x: yScale(T, { min: 0, max: 100, ticks: { ...yScale(T).ticks, callback: v => `${v}%` } }),
          y: { grid: { color: 'transparent' }, ticks: { color: T.tick, font: { size: 12 } } }
        }
      }
    })
  }

  // ── Derived stats for render ──────────────────────────────────────────────
  const pctPerDate = serviceDates.map(date => {
    const act = members.filter(m => m.created_at?.slice(0, 10) <= date)
    if (!act.length) return 0
    const recs = monthAtt.filter(a => a.date === date && act.some(m => m.id === a.member_id))
    return Math.round(recs.length / act.length * 100)
  })
  const avgPct  = pctPerDate.length ? Math.round(pctPerDate.reduce((a, b) => a + b, 0) / pctPerDate.length) : 0
  const lastPct = pctPerDate.length ? pctPerDate[pctPerDate.length - 1] : 0

  // Individual stats when one member selected
  const indMid    = selectedMembers.length === 1 ? selectedMembers[0] : null
  const indRecs   = indMid ? monthAtt.filter(a => a.member_id === indMid) : []
  const indOnTime = indRecs.filter(r => r.status === 'green').length
  const indPct    = serviceDates.length ? Math.round(indRecs.length / serviceDates.length * 100) : 0

  // Group stat cards
  const allGroups   = [...new Set(activeMembers.map(m => m.group_name))].sort()
  const groupCards  = allGroups.map((group, gi) => {
    const color   = GROUP_COLORS[gi % GROUP_COLORS.length]
    const gmembs  = activeMembers.filter(m => m.group_name === group)
    const totalSlots = serviceDates.reduce((acc, date) =>
      acc + gmembs.filter(m => m.created_at?.slice(0, 10) <= date).length, 0)
    const totalPresent = monthAtt.filter(a => gmembs.some(m => m.id === a.member_id)).length
    const avgPct = totalSlots > 0 ? Math.round(totalPresent / totalSlots * 100) : 0
    return { group, color, memberCount: gmembs.length, avgPct }
  })

  // Chip toggle — max 5
  const toggleChip = (mid) => {
    setSelectedMembers(prev =>
      prev.includes(mid) ? prev.filter(id => id !== mid)
        : prev.length < 5 ? [...prev, mid]
        : prev
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="analytics-page">

      {/* Month navigation */}
      <div className="month-nav">
        <button className="month-nav-btn" onClick={goPrev}>‹</button>
        <span className="month-label">{monthLabel}</span>
        <button className="month-nav-btn" onClick={goNext} disabled={!canGoNext}>›</button>
      </div>
      <p className="analytics-subtitle">
        {activeMembers.length} active member{activeMembers.length !== 1 ? 's' : ''}
        &nbsp;&middot;&nbsp;
        {serviceDates.length} service{serviceDates.length !== 1 ? 's' : ''} recorded
      </p>

      {/* Sub-tabs */}
      <div className="subtabs">
        {[
          ['overview', 'Overview'],
          ['compare',  'Compare Members'],
          ['groups',   'Groups']
        ].map(([key, label]) => (
          <button
            key={key}
            className={`subtab-btn ${subTab === key ? 'active' : ''}`}
            onClick={() => setSubTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
      {subTab === 'overview' && (
        <>
          <div className="analytics-stats">
            <div className="stat-card">
              <div className="stat-value">{serviceDates.length}</div>
              <div className="stat-label">Services</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{avgPct}%</div>
              <div className="stat-label">Avg Attendance</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{lastPct}%</div>
              <div className="stat-label">Last Service</div>
            </div>
          </div>

          {!serviceDates.length ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">No data for {monthLabel}</div>
              <div className="empty-state-body">
                Mark attendance on the Attendance tab to populate these charts.
              </div>
            </div>
          ) : (
            <>
              {/* Full-width trend line */}
              <div className="chart-section">
                <div className="chart-title">Attendance Trend</div>
                <ChartLegend items={[
                  { label: 'Present count',  color: '#6366f1' },
                  { label: 'Attendance %',   color: '#10b981' }
                ]} />
                <div className="chart-canvas-wrap-lg">
                  <canvas ref={trendRef} />
                </div>
              </div>

              {/* Stacked bar + Doughnut */}
              <div className="charts-row">
                <div className="chart-section">
                  <div className="chart-title">Composition per Service</div>
                  <ChartLegend items={[
                    { label: 'On Time',   color: STATUS_COLORS.green  },
                    { label: 'Late',      color: STATUS_COLORS.yellow },
                    { label: 'Very Late', color: STATUS_COLORS.red    },
                    { label: 'Absent',    color: STATUS_COLORS.absent }
                  ]} />
                  <div className="chart-canvas-wrap">
                    <canvas ref={stackRef} />
                  </div>
                </div>

                <div className="chart-section">
                  <div className="chart-title">Overall Breakdown</div>
                  <div className="chart-canvas-wrap">
                    <canvas ref={doughRef} />
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── COMPARE ──────────────────────────────────────────────────────── */}
      {subTab === 'compare' && (
        <>
          <p className="compare-hint">
            Select up to 5 members — pick <strong>1</strong> for individual analysis,
            <strong> 2–5</strong> to compare side by side
          </p>

          {activeMembers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">👥</div>
              <div className="empty-state-title">No members active in {monthLabel}</div>
              <div className="empty-state-body">Add members on the Members tab first.</div>
            </div>
          ) : (
            <>
              <div className="chip-selector">
                {activeMembers.map(m => {
                  const idx = selectedMembers.indexOf(m.id)
                  const sel = idx !== -1
                  const col = sel ? COMPARE_COLORS[idx] : undefined
                  return (
                    <button
                      key={m.id}
                      className="chip"
                      onClick={() => toggleChip(m.id)}
                      style={sel ? {
                        borderColor: col,
                        backgroundColor: hexAlpha(col, 0.12),
                        color: col,
                        fontWeight: 600
                      } : undefined}
                    >
                      {m.name}
                      {sel && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>✓{idx + 1}</span>}
                    </button>
                  )
                })}
              </div>

              {!selectedMembers.length ? (
                <div className="empty-state">
                  <div className="empty-state-icon">👆</div>
                  <div className="empty-state-title">No members selected</div>
                  <div className="empty-state-body">
                    Click chips above to select members for comparison.
                  </div>
                </div>
              ) : !serviceDates.length ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📊</div>
                  <div className="empty-state-title">No services in {monthLabel}</div>
                  <div className="empty-state-body">Track attendance to see charts.</div>
                </div>
              ) : (
                <>
                  {/* Individual stat cards when 1 selected */}
                  {indMid && (
                    <div className="analytics-stats-4">
                      <div className="stat-card">
                        <div className="stat-value">{serviceDates.length}</div>
                        <div className="stat-label">Services</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{indRecs.length}</div>
                        <div className="stat-label">Present</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value" style={{ color: 'var(--green)' }}>{indOnTime}</div>
                        <div className="stat-label">On Time</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{indPct}%</div>
                        <div className="stat-label">Attendance</div>
                      </div>
                    </div>
                  )}

                  <div className="charts-row">
                    <div className="chart-section">
                      <div className="chart-title">
                        {selectedMembers.length === 1 ? 'Punctuality Over Month' : 'Punctuality Comparison'}
                      </div>
                      <div className="chart-canvas-wrap-lg">
                        <canvas ref={cmpLineRef} />
                      </div>
                    </div>
                    <div className="chart-section">
                      <div className="chart-title">
                        {selectedMembers.length === 1 ? 'Status per Service' : 'Average Score'}
                      </div>
                      <div className="chart-canvas-wrap-lg">
                        <canvas ref={cmpBarRef} />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ── GROUPS ───────────────────────────────────────────────────────── */}
      {subTab === 'groups' && (
        <>
          {allGroups.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏷️</div>
              <div className="empty-state-title">No groups active in {monthLabel}</div>
              <div className="empty-state-body">
                Assign group names when adding members to use group comparison.
              </div>
            </div>
          ) : (
            <>
              {/* Group stat cards */}
              <div className="groups-grid">
                {groupCards.map(gc => (
                  <div
                    key={gc.group}
                    className="group-card"
                    style={{ '--gcolor': gc.color }}
                  >
                    <div className="group-card-name">{gc.group}</div>
                    <div className="group-card-value">{gc.avgPct}%</div>
                    <div className="group-card-sub">
                      {gc.memberCount} member{gc.memberCount !== 1 ? 's' : ''} · avg attendance
                    </div>
                  </div>
                ))}
              </div>

              {!serviceDates.length ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📊</div>
                  <div className="empty-state-title">No services recorded for {monthLabel}</div>
                  <div className="empty-state-body">Mark attendance to see group charts.</div>
                </div>
              ) : (
                <div className="charts-row">
                  <div className="chart-section">
                    <div className="chart-title">Attendance % by Group — Trend</div>
                    <div className="chart-canvas-wrap-lg">
                      <canvas ref={grpLineRef} />
                    </div>
                  </div>
                  <div className="chart-section">
                    <div className="chart-title">Average Attendance % per Group</div>
                    <div className="chart-canvas-wrap-lg">
                      <canvas ref={grpBarRef} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
