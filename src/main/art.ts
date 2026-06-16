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

// File tags carry edition/disc qualifiers ("Legend Remastered [Disc 1]") that
// MusicBrainz release-group titles ("Legend") don't, and brackets/parens are
// Lucene specials. Strip the noise so the search has a fighting chance.
function cleanAlbum(album: string): string {
  return album
    .replace(/[[(]\s*(disc|cd|disk|vol(ume)?)\.?\s*\d+.*?[)\]]/gi, ' ') // [Disc 1], (CD 2)
    .replace(/[[(][^)\]]*\b(remaster(ed)?|deluxe|expanded|anniversary|edition|bonus|mono|stereo|reissue|version|explicit)\b[^)\]]*[)\]]/gi, ' ')
    .replace(/\b(disc|cd|disk|vol(ume)?)\.?\s*\d+\b/gi, ' ') // trailing "Disc 1"
    .replace(/\b(remaster(ed)?|deluxe edition|expanded edition|anniversary edition|reissue)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// loose comparison key for "is this candidate the same album?"
const norm = (s: string): string =>
  cleanAlbum(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// escape Lucene query specials so brackets/quotes/etc. can't malform the search
const lucene = (s: string): string => s.replace(/(["\\[\](){}^~*?:!/]|&&|\|\|)/g, ' ').trim()

type ReleaseGroup = { id: string; title: string; score: number }

// try the release group's front cover; null if CAA has none for it
async function caaFront(rgId: string): Promise<string | null> {
  try {
    const res = await net.fetch(`https://coverartarchive.org/release-group/${rgId}/front-500`, {
      headers: { 'User-Agent': UA }
    })
    if (!res.ok) return null
    return toDataUrl(Buffer.from(await res.arrayBuffer()))
  } catch {
    return null
  }
}

export function fetchArt(albumArtist: string, album: string): Promise<string | null> {
  const key = `${albumArtist}|${album}`
  if (misses.has(key)) return Promise.resolve(null)
  if (inFlight.has(key)) return inFlight.get(key)!
  const job = (async (): Promise<string | null> => {
    try {
      const cached = await getCachedArt(key)
      if (cached) return cached
      const query = `releasegroup:"${lucene(cleanAlbum(album))}" AND artist:"${lucene(albumArtist)}"`
      const mbRes = await throttled(() =>
        net.fetch(
          `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
          { headers: { 'User-Agent': UA } }
        )
      )
      if (!mbRes.ok) return null
      const mb = (await mbRes.json()) as { 'release-groups'?: ReleaseGroup[] }
      const target = norm(album)
      // Only trust an exact title match. A bare common word like "Legend"
      // scores a dozen unrelated albums at 100, so a fuzzy "best" would happily
      // cache the wrong cover — worse than showing none. Several exact matches
      // can exist (re-releases); try each in score order until one has a CAA image.
      const exact = (mb['release-groups'] ?? [])
        .filter((g) => g.score >= 70 && norm(g.title) === target)
        .sort((a, b) => b.score - a.score)
      for (const rg of exact.slice(0, 4)) {
        const art = await caaFront(rg.id)
        if (art) {
          const buf = Buffer.from(art.split(',')[1], 'base64')
          await fs.mkdir(artDir(), { recursive: true })
          await fs.writeFile(artFile(key), buf)
          return art
        }
      }
      misses.add(key)
      return null
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

// manual override: persist a user-chosen image as the album's cached art
export async function setArt(albumKey: string, imageBytes: Uint8Array): Promise<string> {
  const buf = Buffer.from(imageBytes)
  await fs.mkdir(artDir(), { recursive: true })
  await fs.writeFile(artFile(albumKey), buf)
  misses.delete(albumKey)
  return toDataUrl(buf)
}

// manual override: forget any cached/fetched art for an album
export async function clearArt(albumKey: string): Promise<void> {
  try {
    await fs.unlink(artFile(albumKey))
  } catch {
    /* nothing cached */
  }
  misses.delete(albumKey)
}
