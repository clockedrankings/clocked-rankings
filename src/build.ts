import fs from 'fs'
import path from 'path'
import { renderRankingsPage } from './page.js'

const outDir = path.resolve('dist')
fs.mkdirSync(outDir, { recursive: true })

const html = renderRankingsPage()
fs.writeFileSync(path.join(outDir, 'index.html'), html)
console.log(`Built dist/index.html (${html.length} bytes)`)
