// Rasterizes build/icon.svg into a multi-resolution build/icon.ico for
// electron-builder (the Windows app/exe icon). Run: node scripts/make-icon.mjs
// Build-time only (sharp + png-to-ico are devDependencies).
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const svgPath = path.join(root, 'build', 'icon.svg')
const icoPath = path.join(root, 'build', 'icon.ico')
const pngPath = path.join(root, 'build', 'icon.png')

// Windows .ico wants several sizes so it looks crisp from taskbar to large tiles.
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const svg = await readFile(svgPath)
const pngs = await Promise.all(
  SIZES.map((s) => sharp(svg).resize(s, s, { fit: 'contain' }).png().toBuffer())
)

await writeFile(icoPath, await pngToIco(pngs))
// also keep a 256px PNG around (handy for docs / other platforms later)
await writeFile(pngPath, pngs[pngs.length - 1])

console.log(`Wrote ${icoPath} (${SIZES.join(', ')} px) and ${pngPath}`)
