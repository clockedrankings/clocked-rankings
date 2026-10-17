import { db } from '../db.js'
import { TIER_ZONE_NAME, TIER_ENCOUNTER_IDS, ENCOUNTER_SUBRAID, CE_GATE_ENCOUNTER_IDS } from '../config.js'
import { fetchZones } from '../wcl/client.js'

interface ZoneRow {
  id: number
  name: string
}

interface EncounterRow {
  id: number
  zone_id: number
  name: string
  ordinal: number
  sub_raid: string | null
  is_ce_gate: number
}

export function loadZone(): ZoneRow | null {
  return (db.prepare('SELECT id, name FROM zones LIMIT 1').get() as ZoneRow) ?? null
}

export function loadEncounters(): EncounterRow[] {
  return db
    .prepare(
      'SELECT id, zone_id, name, ordinal, sub_raid, is_ce_gate FROM encounters ORDER BY ordinal',
    )
    .all() as EncounterRow[]
}

export async function ensureZones(): Promise<ZoneRow> {
  const cached = loadZone()
  if (cached && cached.name.toLowerCase() !== TIER_ZONE_NAME.toLowerCase()) {
    // Guilds, reports and kills in this DB belong to a previous tier. Mixing
    // them with the new tier would corrupt every stat, so refuse to continue.
    throw new Error(
      `DB holds data for zone "${cached.name}" but the configured tier is "${TIER_ZONE_NAME}". ` +
        'Start from an empty DB (move data.db aside, or bump the Actions cache key).',
    )
  }
  if (cached && loadEncounters().length > 0) return cached

  const all = await fetchZones()
  const zone = all.find(z => z.name.toLowerCase() === TIER_ZONE_NAME.toLowerCase())
  if (!zone) {
    const available = all.map(z => `${z.id}: ${z.name}`).join('\n  ')
    throw new Error(`Zone "${TIER_ZONE_NAME}" not found. Available zones:\n  ${available}`)
  }

  const tierSet = new Set(TIER_ENCOUNTER_IDS)
  const tierEncounters = zone.encounters.filter(e => tierSet.has(e.id))
  if (tierEncounters.length !== tierSet.size) {
    const missing = TIER_ENCOUNTER_IDS.filter(id => !zone.encounters.some(e => e.id === id))
    throw new Error(`Zone "${zone.name}" is missing tier encounters: ${missing.join(', ')}`)
  }

  const ceSet = new Set(CE_GATE_ENCOUNTER_IDS)
  const insertZone = db.prepare('INSERT OR REPLACE INTO zones (id, name) VALUES (?, ?)')
  const insertEnc = db.prepare(
    'INSERT OR REPLACE INTO encounters (id, zone_id, name, ordinal, sub_raid, is_ce_gate) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const tx = db.transaction(() => {
    insertZone.run(zone.id, zone.name)
    tierEncounters.forEach((e, i) => {
      insertEnc.run(e.id, zone.id, e.name, i, ENCOUNTER_SUBRAID[e.id] ?? null, ceSet.has(e.id) ? 1 : 0)
    })
  })
  tx()

  return { id: zone.id, name: zone.name }
}

export function getCEGateEncounterIDs(): number[] {
  return (db.prepare('SELECT id FROM encounters WHERE is_ce_gate = 1').all() as { id: number }[]).map(
    r => r.id,
  )
}

export function getAllEncounterIDs(): number[] {
  return (db.prepare('SELECT id FROM encounters ORDER BY ordinal').all() as { id: number }[]).map(
    r => r.id,
  )
}
