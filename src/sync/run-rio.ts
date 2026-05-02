import { RIO_API_KEY } from '../config.js'
import { syncRio } from './rio.js'
import { RioRateLimitError, RioServerError } from '../rio/client.js'
import { db, setState } from '../db.js'

if (!RIO_API_KEY) {
  console.error('Error: RIO_API_KEY must be set in .env')
  process.exit(1)
}

async function main(): Promise<void> {
  const encCount = (db.prepare('SELECT COUNT(*) as c FROM encounters').get() as { c: number }).c
  if (encCount === 0) {
    console.error('Error: encounters table is empty — run `npm run sync` once first to populate zones/encounters from WCL.')
    process.exit(1)
  }

  console.log('→ Raider.IO sync (standalone)')
  await syncRio({ verbose: true })
  console.log('✓ RIO sync complete')
}

main()
  .then(() => setState('last_sync_at', String(Date.now())))
  .catch(err => {
    if (err instanceof RioRateLimitError) {
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
