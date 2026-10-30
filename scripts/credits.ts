import { getAccessToken } from '../src/auth.js'
import { WCL_API_URL } from '../src/config.js'
import type { RateLimitData } from '../src/wcl/types.js'

// Direct fetch — bypass the gql wrapper's safety margin so we can still
// check status when near the cap.
const token = await getAccessToken()
const res = await fetch(WCL_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query:
      'query { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn databaseLimitPerHour databasePointsSpentThisHour } }',
  }),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`)
  process.exit(1)
}

const json = (await res.json()) as {
  data: { rateLimitData: RateLimitData }
}
const rl = json.data.rateLimitData

const resetMin = Math.floor(rl.pointsResetIn / 60)
const resetSec = rl.pointsResetIn % 60
const reset = '\x1b[0m'

function budget(label: string, spent: number, limit: number): void {
  const remaining = limit - spent
  const pct = (spent / limit) * 100
  const bar = '█'.repeat(Math.min(40, Math.floor(pct / 2.5))).padEnd(40, '░')
  const color = pct > 90 ? '\x1b[31m' : pct > 70 ? '\x1b[33m' : '\x1b[32m'
  console.log(`  ${label}`)
  console.log(`  ${color}${bar}${reset}  ${pct.toFixed(1)}%`)
  console.log(`  spent:     ${spent.toFixed(0)} / ${limit}`)
  console.log(`  remaining: ${color}${remaining.toFixed(0)}${reset}\n`)
}

console.log(`\n  WCL rate limit (resets in ${resetMin}m ${resetSec}s)\n`)
budget('application points', rl.pointsSpentThisHour, rl.limitPerHour)
budget('database points', rl.databasePointsSpentThisHour, rl.databaseLimitPerHour)
