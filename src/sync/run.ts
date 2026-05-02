import { CLIENT_ID, CLIENT_SECRET, RIO_API_KEY } from '../config.js'
import { ensureZones, getAllEncounterIDs } from './zones.js'
import { syncGuilds } from './guilds.js'
import { syncReports } from './reports.js'
import { syncRio } from './rio.js'
import { RateLimitError, WCLServerError, getLastRateLimit } from '../wcl/client.js'
import { RioRateLimitError, RioServerError } from '../rio/client.js'
import { db, setState } from '../db.js'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set in .env')
  process.exit(1)
}

function logRateLimit(): void {
  const rl = getLastRateLimit()
  if (!rl) return
  const remaining = rl.limitPerHour - rl.pointsSpentThisHour
  console.log(`  Rate limit: ${rl.pointsSpentThisHour}/${rl.limitPerHour} (${remaining} left, resets in ${rl.pointsResetIn}s)`)
}

async function main(): Promise<void> {
  console.log('→ Ensuring zones...')
  const zone = await ensureZones()
  console.log(`  zone ${zone.id}: ${zone.name}`)

  console.log('→ Discovering guilds with ≥1 Mythic kill...')
  const before = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  await syncGuilds(getAllEncounterIDs())
  const after = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  console.log(`  ${after} total guilds (+${after - before} new)`)
  logRateLimit()

  console.log('→ Syncing reports for non-CE guilds...')
  await syncReports()
  const ceCount = (db.prepare('SELECT COUNT(*) as c FROM guilds WHERE ce_achieved_at IS NOT NULL').get() as { c: number }).c
  console.log(`  ${ceCount} guilds now have CE`)
  logRateLimit()

  if (RIO_API_KEY) {
    console.log('→ Supplementing with Raider.IO data for guilds without public WCL logs...')
    await syncRio()
  } else {
    console.log('→ Skipping Raider.IO sync (RIO_API_KEY not set)')
  }

  console.log('✓ Sync complete')
}

function touchLastSync(): void {
  setState('last_sync_at', String(Date.now()))
}

main()
  .then(() => touchLastSync())
  .catch(err => {
    if (err instanceof RateLimitError) {
      touchLastSync() // rate-limited runs still make forward progress
      console.error(`\n⚠ Hit rate limit. Progress saved — rerun \`npm run sync\` after ${err.resetIn}s.`)
      logRateLimit()
      process.exit(2)
    }
    if (err instanceof WCLServerError) {
      console.error(`\n⚠ WCL server returned ${err.status}. Progress saved — will retry next run.`)
      process.exit(3)
    }
    if (err instanceof RioRateLimitError) {
      touchLastSync()
      console.error(`\n⚠ Raider.IO rate limit. Progress saved — rerun after ${err.retryAfter}s.`)
      process.exit(2)
    }
    if (err instanceof RioServerError) {
      console.error(`\n⚠ Raider.IO server returned ${err.status}. Progress saved — will retry next run.`)
      process.exit(3)
    }
    console.error(err)
    process.exit(1)
  })
