export type RioDifficulty = 'mythic' | 'heroic' | 'normal'
export type RioRegion = 'us' | 'eu' | 'kr' | 'tw'

export interface RioGuildSummary {
  id: number
  name: string
  faction: 'horde' | 'alliance' | null
  realm: { slug: string; name: string }
  region: { slug: string }
}

export interface RioRaidRanking {
  rank: number
  regionRank: number | null
  guild: RioGuildSummary
  encountersDefeated: unknown[]
  encountersPulled: unknown[]
}

export interface RioRaidRankingsResponse {
  raidRankings: RioRaidRanking[]
}

export interface RioPullDetail {
  id: number
  status: string
  is_success: boolean
  is_reset: boolean
  num_members: number
  num_deaths: number
  duration_ms: number
  pull_started_at: string
  pull_ended_at: string
  period: number
}

export interface RioPullEntry {
  count: number
  encounter: {
    encounterId: number      // RIO internal
    wowEncounterId: number   // WCL encounter ID — used for kill matching
    name: string
    slug: string
    ordinal: number
  }
  details: RioPullDetail[]
}

export interface RioRaidPullsResponse {
  guild?: { id: number; name: string }
  raid?: { slug: string }
  pulls: RioPullEntry[]
}
