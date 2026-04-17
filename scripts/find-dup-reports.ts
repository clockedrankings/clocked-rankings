import { db } from '../src/db.js'

// Same-day dupes (already handled by day-grouping in SQL)
const sameDay = db
  .prepare(`
    SELECT guild_id, date(first_pull/1000, 'unixepoch') AS day, COUNT(*) AS n
    FROM reports WHERE first_pull IS NOT NULL
    GROUP BY guild_id, day
    HAVING n > 1
    ORDER BY n DESC
    LIMIT 10
  `)
  .all()
console.log('Same-day duplicates (top 10):')
console.log(sameDay)

// Cross-day overlapping reports — two reports for same guild with pull windows that overlap
// (would indicate real double-counting even after day-grouping)
const overlapping = db
  .prepare(`
    SELECT a.guild_id, a.code AS a_code, b.code AS b_code,
      a.first_pull AS a_first, a.last_pull AS a_last,
      b.first_pull AS b_first, b.last_pull AS b_last
    FROM reports a
    JOIN reports b ON a.guild_id = b.guild_id
      AND a.code < b.code
      AND a.first_pull IS NOT NULL AND b.first_pull IS NOT NULL
      AND a.last_pull > b.first_pull AND b.last_pull > a.first_pull
    LIMIT 10
  `)
  .all()
console.log('\nOverlapping pull windows (not the same day):')
console.log(overlapping)
