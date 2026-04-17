import { db } from '../src/db.js'

const name = process.argv[2] ?? 'Death Jesters'
const server = process.argv[3] ?? 'Stormrage'

const guild = db
  .prepare('SELECT * FROM guilds WHERE name = ? AND server_name = ?')
  .get(name, server) as {
    id: number
    name: string
    server_name: string
    region: string
    ce_achieved_at: number | null
    reports_synced_at: number | null
  } | undefined

if (!guild) {
  console.log('Not found. Similar:')
  const like = db
    .prepare('SELECT name, server_name, region FROM guilds WHERE name LIKE ? LIMIT 10')
    .all(`%${name}%`)
  console.log(like)
  process.exit(1)
}

console.log(`${guild.name} — ${guild.region}-${guild.server_name}  (id=${guild.id})`)
console.log(`  CE: ${guild.ce_achieved_at ? new Date(guild.ce_achieved_at).toISOString() : '—'}`)
console.log(`  synced: ${guild.reports_synced_at ? 'yes' : 'no'}`)
console.log('')

const reports = db
  .prepare(`
    SELECT code, zone_id, start_time, end_time, first_pull, last_pull
    FROM reports WHERE guild_id = ?
    ORDER BY start_time
  `)
  .all(guild.id) as Array<{
    code: string
    zone_id: number | null
    start_time: number
    end_time: number
    first_pull: number | null
    last_pull: number | null
  }>

let totalMs = 0
for (const r of reports) {
  const pullMs = r.first_pull && r.last_pull ? r.last_pull - r.first_pull : 0
  totalMs += pullMs
  const dayLabel = r.first_pull ? new Date(r.first_pull).toISOString().replace('T', ' ').slice(0, 16) : '—'
  console.log(
    `  ${dayLabel}  zone=${r.zone_id}  ${r.code}  pull=${(pullMs / 3_600_000).toFixed(2)}h`,
  )
}

const first = Math.min(...reports.map(r => r.first_pull ?? Infinity))
const last = Math.max(...reports.map(r => r.last_pull ?? 0))
const weeks = (last - first) / (7 * 24 * 3_600_000)
console.log('')
console.log(`  total reports: ${reports.length}`)
console.log(`  total pull hours: ${(totalMs / 3_600_000).toFixed(1)}`)
console.log(`  span: ${weeks.toFixed(2)} weeks`)
console.log(`  hours/week: ${(totalMs / 3_600_000 / Math.max(weeks, 1 / 7)).toFixed(2)}`)
