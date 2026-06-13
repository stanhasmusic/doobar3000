// Cover art: embedded art is handled by get-art in index.ts; this module fills
// the gaps via MusicBrainz release-group search → Cover Art Archive, caching
// fetched images on disk under userData/art/<sha1 of album key>.

import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// MusicBrainz requires a meaningful User-Agent and ≤1 request/second
const UA = 'Doobar3000/0.3 (stanhasmusic@gmail.com)'

const artDir = () => path.join(app.getPath('userData'), 'art')
const artFile = (key: string) =>
  path.join(artDir(), createHash('sha1').update(key).digest('hex') + '.img')

const toDataUrl = (buf: Buffer): string => {
  const mime = buf[0] === 0x89 ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

export async function getCachedArt(albumKey: string): Promise<string | null> {
  try {
    return toDataUrl(await fs.readFile(artFile(albumKey)))
  } catch {
    return null
  }
}

// serialize MusicBrainz hits to respect their rate limit
let mbQueue: Promise<unknown> = Promise.resolve()
const throttled = <T>(job: () => Promise<T>): Promise<T> => {
  const run = mbQueue.then(job)
  mbQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)))
  return run
}

const misses = new Set<string>() // per-session negative cache
const inFlight = new Map<string, Promise<string | null>>()

export function fetchArt(albumArtist: string, album: string): Promise<string | null> {
  const key = `${albumArtist}|${album}`
  if (misses.has(key)) return Promise.resolve(null)
  if (inFlight.has(key)) return inFlight.get(key)!
  const job = (async (): Promise<string | null> => {
    try {
      const cached = await getCachedArt(key)
      if (cached) return cached
      const lucene = (s: string) => s.replace(/["\\]/g, ' ').trim()
      const query = `releasegroup:"${lucene(album)}" AND artist:"${lucene(albumArtist)}"`
      const mbRes = await throttled(() =>
        net.fetch(
          `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
          { headers: { 'User-Agent': UA } }
        )
      )
      if (!mbRes.ok) return null
      const mb = (await mbRes.json()) as {
        'release-groups'?: { id: string; score: number }[]
      }
      const rg = mb['release-groups']?.[0]
      if (!rg || rg.score < 70) {
        misses.add(key)
        return null
      }
      const caaRes = await net.fetch(`https://coverartarchive.org/release-group/${rg.id}/front-500`, {
        headers: { 'User-Agent': UA }
      })
      if (!caaRes.ok) {
        misses.add(key)
        return null
      }
      const buf = Buffer.from(await caaRes.arrayBuffer())
      await fs.mkdir(artDir(), { recursive: true })
      await fs.writeFile(artFile(key), buf)
      return toDataUrl(buf)
    } catch (err) {
      console.error('art fetch failed:', albumArtist, album, err)
      return null
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, job)
  return job
}
