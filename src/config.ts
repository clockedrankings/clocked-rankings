import 'dotenv/config'
import path from 'path'
import os from 'os'

export const PORT = parseInt(process.env.PORT ?? '3457', 10)
export const CLIENT_ID = process.env.WCL_CLIENT_ID ?? ''
export const CLIENT_SECRET = process.env.WCL_CLIENT_SECRET ?? ''
export const REDIRECT_URI = `http://localhost:${PORT}/callback`

export const RIO_API_KEY = process.env.RIO_API_KEY ?? ''

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'guild-rankings-by-day')
export const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json')
export const DB_PATH = process.env.DB_PATH ?? path.join(CONFIG_DIR, 'data.db')

export const WCL_AUTHORIZE_URL = 'https://www.warcraftlogs.com/oauth/authorize'
export const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token'
export const WCL_API_URL = 'https://www.warcraftlogs.com/api/v2/client'

export const RIO_API_URL = 'https://raider.io/api/v1'
// Midnight Season 2. Raider.IO tracks the season's three raids as separate
// slugs (the-venomous-abyss, the-tidebound-grotto, the-unbinding-of-kithix);
// only the main raid counts toward the tier, mirroring how Sporefall was
// excluded from Season 1.
export const RIO_TIER_SLUG = 'the-venomous-abyss'

// WCL zone 53. WCL folds Nymrissa Wavecaller (3379) and Kith'ix (3513) into
// this zone, so the tier is narrowed to TIER_ENCOUNTER_IDS below.
export const TIER_ZONE_NAME = 'The Venomous Abyss'

// The encounters that make up the tier, in WCL zone order.
export const TIER_ENCOUNTER_IDS: readonly number[] = [
  3470, // Nek'zali the Soulcoiler
  3445, // Entombed Sentinels
  3455, // Vashnik the Malignant
  3497, // The Lost Explorers
  3420, // Sszorak
  3421, // The Twin Fangs
  3429, // The Coiled Altar
  3492, // Ula'tek
]

// Encounter ID -> sub-raid name. Season 2 has a single tier raid.
export const ENCOUNTER_SUBRAID: Record<number, string> = Object.fromEntries(
  TIER_ENCOUNTER_IDS.map(id => [id, 'The Venomous Abyss']),
)

// CE = Mythic kill of Ula'tek (final boss of The Venomous Abyss).
export const CE_GATE_ENCOUNTER_IDS: readonly number[] = [3492]
