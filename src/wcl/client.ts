import { getAccessToken } from '../auth.js'
import { WCL_API_URL } from '../config.js'
import { getState, setState } from '../db.js'
import {
  GET_ZONES,
  GET_ZONE_PARTITIONS,
  GET_ENCOUNTER_GUILD_RANKINGS,
  GET_GUILD_REPORTS,
  GET_REPORT_FIGHTS,
} from './queries.js'
import type {
  RateLimitData,
  WorldDataResponse,
  EncounterRankingsJSON,
  GuildReportsPage,
  ReportFightsData,
} from './types.js'

export class RateLimitError extends Error {
  constructor(public resetIn: number, detail: string) {
    super(`WCL rate limit hit: ${detail}, resets in ${resetIn}s`)
    this.name = 'RateLimitError'
  }
}

export class WCLServerError extends Error {
  constructor(public status: number, body: string) {
    super(`WCL server error: ${status} ${body.slice(0, 200)}`)
    this.name = 'WCLServerError'
  }
}

const RATE_LIMIT_STATE_KEY = 'last_rate_limit'

// A reading persisted by an earlier run still holds until its hour resets, so
// a run can stop before spending a request it already knows will be refused.
function loadPersistedRateLimit(): RateLimitData | null {
  const raw = getState(RATE_LIMIT_STATE_KEY)
  if (!raw) return null
  const { capturedAt, ...rl } = JSON.parse(raw) as RateLimitData & { capturedAt: number }
  const resetIn = Math.round((capturedAt + rl.pointsResetIn * 1000 - Date.now()) / 1000)
  // Readings from before the database-points split lack those fields.
  if (resetIn <= 0 || rl.databaseLimitPerHour === undefined) return null
  return { ...rl, pointsResetIn: resetIn }
}

let lastRateLimit: RateLimitData | null = loadPersistedRateLimit()
export function getLastRateLimit(): RateLimitData | null {
  return lastRateLimit
}

// WCL meters two budgets per hour: application points (1000) and database
// points (250), a subset of application points charged by rankings and report
// listing. Database points run out first, so they're the one that bounds a run.
// Safety margins — stop before hitting either cap so we can checkpoint cleanly.
const RATE_LIMIT_SAFETY = 50
const DATABASE_POINTS_SAFETY = 5

function checkBudget(rl: RateLimitData, databasePoints: boolean): void {
  if (rl.limitPerHour - rl.pointsSpentThisHour < RATE_LIMIT_SAFETY) {
    throw new RateLimitError(rl.pointsResetIn, `${rl.pointsSpentThisHour}/${rl.limitPerHour} points`)
  }
  if (databasePoints && rl.databaseLimitPerHour - rl.databasePointsSpentThisHour < DATABASE_POINTS_SAFETY) {
    throw new RateLimitError(
      rl.pointsResetIn,
      `${rl.databasePointsSpentThisHour}/${rl.databaseLimitPerHour} database points`,
    )
  }
}

function withRateLimit(query: string): string {
  return query
    .trimEnd()
    .replace(
      /}(\s*)$/,
      `  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn databaseLimitPerHour databasePointsSpentThisHour }\n}$1`,
    )
}

// Pass databasePoints: false for queries WCL doesn't charge database points
// for, so they keep running on application points after that budget is gone.
export async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  { databasePoints = true }: { databasePoints?: boolean } = {},
): Promise<T> {
  if (lastRateLimit) checkBudget(lastRateLimit, databasePoints)

  const token = await getAccessToken()

  const res = await fetch(WCL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: withRateLimit(query), variables }),
  })

  if (res.status === 429) {
    const reset = parseInt(res.headers.get('retry-after') ?? '3600', 10)
    throw new RateLimitError(reset, 'HTTP 429')
  }

  if (res.status >= 500 && res.status < 600) {
    throw new WCLServerError(res.status, await res.text())
  }
  if (!res.ok) throw new Error(`WCL API error: ${res.status} ${await res.text()}`)

  const json = (await res.json()) as {
    data?: T & { rateLimitData?: RateLimitData }
    errors?: Array<{ message: string }>
  }

  // rateLimitData comes back even when another field errors, so record it first.
  if (json.data?.rateLimitData) {
    lastRateLimit = json.data.rateLimitData
    setState(RATE_LIMIT_STATE_KEY, JSON.stringify({ ...lastRateLimit, capturedAt: Date.now() }))
  }

  if (json.errors?.length) {
    // An exhausted database budget is a 200 with a per-field error, not a 429.
    if (json.errors.some(e => e.message.includes('no database points remaining'))) {
      throw new RateLimitError(lastRateLimit?.pointsResetIn ?? 3600, 'no database points remaining')
    }
    throw new Error(`GraphQL: ${json.errors.map(e => e.message).join(', ')}`)
  }

  return json.data as T
}

export async function fetchZones(): Promise<WorldDataResponse['worldData']['zones']> {
  const data = await gql<WorldDataResponse>(GET_ZONES, {}, { databasePoints: false })
  return data.worldData.zones
}

export async function fetchEncounterRankings(
  encounterID: number,
  page: number,
  partition: number,
): Promise<EncounterRankingsJSON> {
  const data = await gql<{
    worldData: { encounter: { fightRankings: EncounterRankingsJSON | { error: string } } }
  }>(GET_ENCOUNTER_GUILD_RANKINGS, { encounterID, page, partition })
  const raw = data.worldData.encounter.fightRankings
  // WCL returns { error: "..." } when page > 20 (hard cap) or invalid partition
  if ('error' in raw) return { page, hasMorePages: false, count: 0, rankings: [] }
  return raw
}

export interface ZonePartition {
  id: number
  name: string
  compactName: string
  default: boolean
}

export async function fetchZonePartitions(zoneID: number): Promise<ZonePartition[]> {
  const data = await gql<{ worldData: { zone: { partitions: ZonePartition[] } } }>(
    GET_ZONE_PARTITIONS,
    { zoneID },
  )
  return data.worldData.zone.partitions
}

export async function fetchGuildReports(
  guildID: number,
  page: number,
  zoneID: number | null = null,
): Promise<GuildReportsPage | null> {
  try {
    const data = await gql<{ reportData: { reports: GuildReportsPage } }>(GET_GUILD_REPORTS, {
      guildID,
      page,
      zoneID: zoneID ?? undefined,
    })
    return data.reportData.reports
  } catch (err) {
    // Guild was deleted/merged on WCL after we discovered it
    if (err instanceof Error && err.message.includes('No guild exists for this id')) return null
    throw err
  }
}

export async function fetchReportFights(code: string): Promise<ReportFightsData> {
  const data = await gql<{ reportData: { report: ReportFightsData } }>(GET_REPORT_FIGHTS, { code }, { databasePoints: false })
  return data.reportData.report
}
