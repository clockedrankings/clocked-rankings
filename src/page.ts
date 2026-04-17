import { db, getState } from './db.js'

interface Filters {
  server?: string
  region?: string
  minHours?: number
  maxHours?: number
}

interface RankingRow {
  id: number
  name: string
  server_name: string | null
  region: string
  ce_achieved_at: number | null
  total_ms: number
  raid_nights: number
  raid_weeks: number
  bosses: number
}

interface Interval {
  first: number
  last: number
}

// Merge overlapping pull windows — handles same-day dupes and cross-day overlaps
// (e.g. a log that straddles midnight alongside a separate upload of the same session).
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.first - b.first)
  const merged: Interval[] = []
  for (const iv of sorted) {
    const prev = merged[merged.length - 1]
    if (prev && iv.first <= prev.last) {
      prev.last = Math.max(prev.last, iv.last)
    } else {
      merged.push({ ...iv })
    }
  }
  return merged
}

// Count distinct 7-day buckets anchored to Unix epoch (Thursday 1970-01-01).
// Not ISO-week-aligned, but stable and correct for "how many separate raid weeks".
const WEEK_MS = 7 * 24 * 3_600_000
function bucketKey(ms: number): number {
  return Math.floor(ms / WEEK_MS)
}

function loadRankings(): RankingRow[] {
  const reports = db
    .prepare(`
      SELECT r.guild_id, r.first_pull, r.last_pull
      FROM reports r
      JOIN guilds g ON g.id = r.guild_id
      WHERE r.first_pull IS NOT NULL
        AND r.last_pull IS NOT NULL
        AND (g.ce_achieved_at IS NULL OR r.first_pull <= g.ce_achieved_at)
    `)
    .all() as { guild_id: number; first_pull: number; last_pull: number }[]

  const byGuild = new Map<number, Interval[]>()
  for (const r of reports) {
    const arr = byGuild.get(r.guild_id) ?? []
    arr.push({ first: r.first_pull, last: r.last_pull })
    byGuild.set(r.guild_id, arr)
  }

  const guilds = db
    .prepare(
      'SELECT id, name, server_name, region, ce_achieved_at FROM guilds WHERE reports_synced_at IS NOT NULL',
    )
    .all() as Pick<RankingRow, 'id' | 'name' | 'server_name' | 'region' | 'ce_achieved_at'>[]

  const bossRows = db
    .prepare(`
      SELECT guild_id, COUNT(DISTINCT encounter_id) AS n
      FROM mythic_kills
      WHERE encounter_id IN (SELECT id FROM encounters)
      GROUP BY guild_id
    `)
    .all() as { guild_id: number; n: number }[]
  const bossByGuild = new Map(bossRows.map(r => [r.guild_id, r.n]))

  const out: RankingRow[] = []
  for (const g of guilds) {
    const intervals = byGuild.get(g.id) ?? []
    const merged = mergeIntervals(intervals)
    const total_ms = merged.reduce((s, iv) => s + (iv.last - iv.first), 0)
    if (total_ms === 0) continue
    const raid_nights = merged.length
    const raid_weeks = new Set(merged.map(iv => bucketKey(iv.first))).size
    out.push({
      ...g,
      total_ms,
      raid_nights,
      raid_weeks,
      bosses: bossByGuild.get(g.id) ?? 0,
    })
  }
  return out
}

interface RankedGuild extends RankingRow {
  hours_per_week: number
  total_hours: number
}

function rank(rows: RankingRow[]): RankedGuild[] {
  return rows
    .map(r => {
      const total_hours = r.total_ms / 3_600_000
      const weeks = Math.max(r.raid_weeks, 1)
      return { ...r, total_hours, hours_per_week: total_hours / weeks }
    })
    .sort((a, b) => b.bosses - a.bosses || b.hours_per_week - a.hours_per_week)
}

function applyFilters(rows: RankedGuild[], f: Filters): RankedGuild[] {
  return rows.filter(r => {
    if (f.server && !r.server_name?.toLowerCase().includes(f.server.toLowerCase())) return false
    if (f.region && r.region !== f.region) return false
    if (f.minHours !== undefined && r.hours_per_week < f.minHours) return false
    if (f.maxHours !== undefined && r.hours_per_week > f.maxHours) return false
    return true
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function fmtHours(h: number): string {
  return h.toFixed(1)
}

function fmtDate(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toISOString().slice(0, 10)
}

function rateLimitBadge(): string {
  const raw = getState('last_rate_limit')
  if (!raw) return ''
  const rl = JSON.parse(raw) as {
    limitPerHour: number
    pointsSpentThisHour: number
    pointsResetIn: number
    capturedAt: number
  }
  const elapsed = (Date.now() - rl.capturedAt) / 1000
  const resetInSec = Math.max(rl.pointsResetIn - elapsed, 0)
  const remaining = (rl.limitPerHour - rl.pointsSpentThisHour).toFixed(0)
  const pct = (rl.pointsSpentThisHour / rl.limitPerHour) * 100
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#d4a017' : '#10b981'
  const mins = Math.ceil(resetInSec / 60)
  return `<span class="rl-badge" style="color: ${color};">${remaining} credits left · resets in ${mins}m</span>`
}

export function renderRankingsPage(filters: Filters = {}): string {
  const rows = applyFilters(rank(loadRankings()), filters)
  const totalGuilds = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  const ceGuilds = (db
    .prepare('SELECT COUNT(*) as c FROM guilds WHERE ce_achieved_at IS NOT NULL')
    .get() as { c: number }).c
  const regions = (db
    .prepare('SELECT DISTINCT region FROM guilds ORDER BY region')
    .all() as { region: string }[]).map(r => r.region)

  const servers = (db
    .prepare(
      `SELECT DISTINCT server_name, region FROM guilds
       WHERE server_name IS NOT NULL
       ORDER BY region, server_name`,
    )
    .all() as { server_name: string; region: string }[])

  const regionOpts = regions
    .map(r => `<option value="${r}"${filters.region === r ? ' selected' : ''}>${r}</option>`)
    .join('')

  const serverOpts = servers
    .map(
      s =>
        `<option value="${escapeHtml(s.server_name)}"${filters.server === s.server_name ? ' selected' : ''}>${escapeHtml(s.server_name)} (${escapeHtml(s.region)})</option>`,
    )
    .join('')

  const tbody = rows
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.server_name ?? '')} <span class="muted">${escapeHtml(r.region)}</span></td>
      <td class="num">${r.bosses}/9</td>
      <td class="num">${fmtHours(r.hours_per_week)}</td>
      <td class="num">${fmtHours(r.total_hours)}</td>
      <td class="num">${r.raid_nights}</td>
      <td class="num">${r.raid_weeks}</td>
      <td>${r.ce_achieved_at !== null ? fmtDate(r.ce_achieved_at) : '<span class="progress">—</span>'}</td>
    </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Guild Rankings — Hours Per Week Before CE</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #e5e7eb; background: #0f1115; }
    .header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
    .rl-badge { font-size: 13px; font-variant-numeric: tabular-nums; }
    h1 { margin-bottom: 0.25rem; color: #f3f4f6; }
    .sub { color: #9ca3af; margin-bottom: 1.5rem; }
    form.filters { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; margin-bottom: 1rem;
      padding: 0.75rem; background: #161b22; border-radius: 6px; }
    form.filters label { display: flex; flex-direction: column; font-size: 12px; color: #9ca3af; gap: 4px; }
    form.filters input, form.filters select {
      background: #0f1115; color: #e5e7eb; border: 1px solid #2d3748; border-radius: 4px;
      padding: 4px 8px; font-size: 14px;
    }
    form.filters button, form.filters a.clear {
      background: #2d3748; color: #e5e7eb; border: none; border-radius: 4px;
      padding: 6px 12px; font-size: 14px; cursor: pointer; text-decoration: none;
      line-height: 1.5;
    }
    form.filters button:hover, form.filters a.clear:hover { background: #3a4557; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { padding: 6px 10px; border-bottom: 1px solid #1f2430; text-align: left; }
    th { background: #161b22; position: sticky; top: 0; color: #cbd5e1; }
    tbody tr:hover { background: #161b22; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #6b7280; font-size: 12px; }
    .progress { color: #6b7280; }
    .empty { padding: 2rem; text-align: center; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Guild Rankings</h1>
    ${rateLimitBadge()}
  </div>
  <div class="sub">
    Ranked by Mythic bosses killed, tiebroken by hours raided per week before Cutting Edge.
    ${totalGuilds} guilds tracked · ${ceGuilds} with CE · ${rows.length} shown.
  </div>
  <form class="filters" method="get">
    <label>Server
      <select name="server">
        <option value="">All</option>
        ${serverOpts}
      </select>
    </label>
    <label>Region
      <select name="region">
        <option value="">All</option>
        ${regionOpts}
      </select>
    </label>
    <label>Min hours/week
      <input type="number" step="0.1" name="min_hours" value="${filters.minHours ?? ''}" style="width: 90px;">
    </label>
    <label>Max hours/week
      <input type="number" step="0.1" name="max_hours" value="${filters.maxHours ?? ''}" style="width: 90px;">
    </label>
    <button type="submit">Apply</button>
    <a class="clear" href="/">Clear</a>
  </form>
  ${
    rows.length === 0
      ? '<div class="empty">No guilds match. Run <code>npm run sync</code> or relax filters.</div>'
      : `<table>
    <thead>
      <tr>
        <th>#</th>
        <th>Guild</th>
        <th>Server</th>
        <th class="num">Bosses</th>
        <th class="num">Hours/week</th>
        <th class="num">Total hours</th>
        <th class="num">Nights</th>
        <th class="num">Weeks</th>
        <th>CE</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>`
  }
  <script>
    (function () {
      let boot = null
      const es = new EventSource('/__reload')
      es.onmessage = function (e) {
        if (boot !== null && boot !== e.data) location.reload()
        boot = e.data
      }
    })()
  </script>
</body>
</html>`
}
