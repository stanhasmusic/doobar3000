// Track identification: chromaprint fingerprint (fpcalc) → AcoustID lookup →
// tag candidates, plus tag writing via ffmpeg stream-copy (no re-encode).

import { app, net } from 'electron'
import { execFile } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { findFfmpeg } from './ffmpeg'
import type { IdentifyResult, TagCandidate } from '../shared/types'

const execFileP = promisify(execFile)

// fpcalc is AcoustID's own fingerprinter (~1.5 MB); the ffmpeg essentials build
// we ship as the decoder pack is not compiled with chromaprint, so it can't do this
const FPCALC_URL =
  'https://github.com/acoustid/chromaprint/releases/download/v1.5.1/chromaprint-fpcalc-1.5.1-windows-x86_64.zip'

const fpcalcBinary = () => path.join(app.getPath('userData'), 'bin', 'fpcalc.exe')

let fpcalcCached: string | null = null

export async function findFpcalc(): Promise<string | null> {
  if (fpcalcCached) return fpcalcCached
  for (const binary of [fpcalcBinary(), 'fpcalc']) {
    try {
      await execFileP(binary, ['-version'])
      fpcalcCached = binary
      return binary
    } catch {
      /* keep looking */
    }
  }
  return null
}

export async function downloadFpcalc(): Promise<boolean> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doobar-fpcalc-'))
  const zipPath = path.join(tmpDir, 'fpcalc.zip')
  try {
    const res = await net.fetch(FPCALC_URL)
    if (!res.ok || !res.body) return false
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath))
    await execFileP('tar', ['-xf', zipPath, '-C', tmpDir], { maxBuffer: 1024 * 1024 })
    let found: string | null = null
    const search = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (found) return
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await search(full)
        else if (e.name.toLowerCase() === 'fpcalc.exe') found = full
      }
    }
    await search(tmpDir)
    if (!found) return false
    await fs.mkdir(path.dirname(fpcalcBinary()), { recursive: true })
    await fs.copyFile(found, fpcalcBinary())
    fpcalcCached = null
    return (await findFpcalc()) !== null
  } catch (err) {
    console.error('fpcalc download failed:', err)
    return false
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

interface AcoustidArtist {
  name: string
  joinphrase?: string
}
const joinArtists = (artists?: AcoustidArtist[]): string =>
  artists?.map((a) => a.name + (a.joinphrase ?? '')).join('') ?? ''

export async function identify(trackPath: string, apiKey: string): Promise<IdentifyResult> {
  const fpcalc = await findFpcalc()
  if (!fpcalc) return { ok: false, error: 'fpcalc not installed' }
  let fp: { duration: number; fingerprint: string }
  try {
    const { stdout } = await execFileP(fpcalc, ['-json', trackPath], {
      maxBuffer: 4 * 1024 * 1024
    })
    fp = JSON.parse(stdout)
  } catch (err) {
    console.error('fpcalc failed:', err)
    return { ok: false, error: 'Could not fingerprint this file.' }
  }

  const body = new URLSearchParams({
    client: apiKey,
    format: 'json',
    duration: String(Math.round(fp.duration)),
    fingerprint: fp.fingerprint,
    meta: 'recordings releasegroups releases tracks'
  })
  let data: {
    status: string
    error?: { message: string }
    results?: {
      score: number
      recordings?: {
        title?: string
        artists?: AcoustidArtist[]
        releasegroups?: {
          title?: string
          type?: string
          secondarytypes?: string[]
          artists?: AcoustidArtist[]
          releases?: {
            date?: { year?: number }
            mediums?: { tracks?: { position?: number }[] }[]
          }[]
        }[]
      }[]
    }[]
  }
  try {
    const res = await net.fetch('https://api.acoustid.org/v2/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    data = await res.json()
  } catch (err) {
    console.error('acoustid lookup failed:', err)
    return { ok: false, error: 'AcoustID request failed — check your connection.' }
  }
  if (data.status !== 'ok') {
    return { ok: false, error: data.error?.message ?? 'AcoustID returned an error.' }
  }

  // Flatten to one candidate per (recording, release group), dedupe, best first
  const seen = new Set<string>()
  const candidates: TagCandidate[] = []
  for (const result of data.results ?? []) {
    for (const rec of result.recordings ?? []) {
      if (!rec.title) continue
      const artist = joinArtists(rec.artists)
      for (const rg of rec.releasegroups ?? []) {
        if (!rg.title) continue
        const key = `${rec.title}|${artist}|${rg.title}`.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const years = (rg.releases ?? [])
          .map((r) => r.date?.year)
          .filter((y): y is number => typeof y === 'number')
        const trackNo =
          (rg.releases ?? [])
            .flatMap((r) => r.mediums ?? [])
            .flatMap((m) => m.tracks ?? [])
            .find((t) => typeof t.position === 'number')?.position ?? null
        candidates.push({
          score: result.score,
          title: rec.title,
          artist,
          albumArtist: joinArtists(rg.artists) || artist,
          album: rg.title,
          year: years.length ? Math.min(...years) : null,
          trackNo,
          releaseGroupType: [rg.type, ...(rg.secondarytypes ?? [])].filter(Boolean).join(' / ')
        })
      }
    }
  }
  // All release groups of one matched recording share the same AcoustID score,
  // so the secondary keys do the real ordering. Treat full albums AND
  // compilations as equally wanted (a track's "right" album is often a
  // compilation like "Legend"); only push singles/EPs/other below them. Then
  // earliest release first, so the original album and classic comps surface.
  const typeRank = (t: string): number =>
    t.startsWith('Album') || t.includes('Compilation') ? 0 : 1
  candidates.sort(
    (a, b) =>
      b.score - a.score || typeRank(a.releaseGroupType) - typeRank(b.releaseGroupType) ||
      (a.year ?? 9999) - (b.year ?? 9999)
  )
  return { ok: true, candidates: candidates.slice(0, 20) }
}

const metaArg = (k: string, v: string | number | null): string[] =>
  v !== null && v !== '' ? ['-metadata', `${k}=${v}`] : []

// Write the given -metadata args by remuxing with ffmpeg (-c copy = audio bytes
// untouched; unspecified tags are carried over from the source). The original is
// kept as .bak until the swap succeeds, then deleted.
async function remuxWithMeta(trackPath: string, meta: string[]): Promise<boolean> {
  if (!meta.length) return true
  const ff = await findFfmpeg()
  if (!ff.found || !ff.binary) return false
  const ext = path.extname(trackPath)
  const tmp = trackPath.slice(0, -ext.length) + '.doobar-tmp' + ext
  const bak = trackPath + '.bak'
  try {
    await execFileP(
      ff.binary,
      [
        '-y',
        '-i',
        trackPath,
        '-map',
        '0',
        '-c',
        'copy',
        ...(ext.toLowerCase() === '.mp3' ? ['-id3v2_version', '3'] : []),
        ...meta,
        tmp
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    )
    await fs.rename(trackPath, bak)
    await fs.rename(tmp, trackPath)
    await fs.rm(bak, { force: true })
    return true
  } catch (err) {
    console.error('remux failed:', trackPath, err)
    await fs.rm(tmp, { force: true }).catch(() => {})
    // if the original got moved aside but the swap failed, put it back
    try {
      await fs.access(trackPath)
    } catch {
      await fs.rename(bak, trackPath).catch(() => {})
    }
    return false
  }
}

export function applyTags(trackPath: string, tags: TagCandidate): Promise<boolean> {
  return remuxWithMeta(trackPath, [
    ...metaArg('title', tags.title),
    ...metaArg('artist', tags.artist),
    ...metaArg('album_artist', tags.albumArtist),
    ...metaArg('album', tags.album),
    ...metaArg('date', tags.year),
    ...metaArg('track', tags.trackNo)
  ])
}

// Apply only album-level fields to many files, leaving each one's title/track
// number intact — used to push an Identify match to the rest of an album.
export type AlbumFields = { album: string; albumArtist: string; year: number | null }
export async function applyAlbumTags(paths: string[], fields: AlbumFields): Promise<string[]> {
  const meta = [
    ...metaArg('album', fields.album),
    ...metaArg('album_artist', fields.albumArtist),
    ...metaArg('date', fields.year)
  ]
  const ok: string[] = []
  for (const p of paths) if (await remuxWithMeta(p, meta)) ok.push(p)
  return ok
}
