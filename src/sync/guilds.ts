import { db, getState, setState, clearState } from '../db.js'
import { fetchEncounterRankings, fetchZonePartitions } from '../wcl/client.js'
import { loadZone } from './zones.js'

interface DiscoveryCheckpoint {
  partitionIdx: number
  encounterIdx: number
  page: number
}

const STATE_KEY = 'guild_discovery_checkpoint'

function loadCheckpoint(): DiscoveryCheckpoint {
  const raw = getState(STATE_KEY)
  if (!raw) return { partitionIdx: 0, encounterIdx: 0, page: 1 }
  return JSON.parse(raw) as DiscoveryCheckpoint
}

function saveCheckpoint(cp: DiscoveryCheckpoint): void {
  setState(STATE_KEY, JSON.stringify(cp))
}

// Iterate Mythic guild rankings across every partition × encounter in the tier.
// Partitions reflect balance patches; they don't affect guild rankings semantically,
// but WCL buckets them separately so we have to visit each.
// A guild appearing on ANY encounter's Mythic rankings has ≥1 Mythic kill.
export async function syncGuilds(encounterIDs: number[]): Promise<void> {
  const zone = loadZone()
  if (!zone) throw new Error('Zone not loaded — run ensureZones first')

  const partitions = await fetchZonePartitions(zone.id)
  const partitionIDs = partitions.map(p => p.id)

  const cp = loadCheckpoint()

  const insertGuild = db.prepare(`
    INSERT INTO guilds (id, name, server_slug, server_name, region, faction)
    VALUES (@id, @name, @server_slug, @server_name, @region, @faction)
    ON CONFLICT(id) DO NOTHING
  `)

  for (let pi = cp.partitionIdx; pi < partitionIDs.length; pi++) {
    const partition = partitionIDs[pi]
    const startEnc = pi === cp.partitionIdx ? cp.encounterIdx : 0

    for (let ei = startEnc; ei < encounterIDs.length; ei++) {
      const encounterID = encounterIDs[ei]
      let page = pi === cp.partitionIdx && ei === cp.encounterIdx ? cp.page : 1

      while (true) {
        saveCheckpoint({ partitionIdx: pi, encounterIdx: ei, page })
        const rankings = await fetchEncounterRankings(encounterID, page, partition)

        const tx = db.transaction(() => {
          for (const entry of rankings.rankings) {
            if (!entry.guild?.id) continue
            insertGuild.run({
              id: entry.guild.id,
              name: entry.guild.name,
              server_slug: entry.server.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              server_name: entry.server.name,
              region: entry.server.region,
              faction:
                entry.guild.faction === 1 ? 'Alliance' : entry.guild.faction === 2 ? 'Horde' : null,
            })
          }
        })
        tx()

        if (!rankings.hasMorePages) break
        page += 1
      }
    }
  }

  clearState(STATE_KEY)
}
