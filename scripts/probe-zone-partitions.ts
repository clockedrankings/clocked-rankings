import { gql } from '../src/wcl/client.js'

const res = await gql<{ worldData: { zone: { partitions: Array<{ id: number; name: string; default: boolean }> } } }>(
  `query { worldData { zone(id: 46) { partitions { id name default compactName } } } }`,
  {},
)
console.log(JSON.stringify(res.worldData.zone.partitions, null, 2))
