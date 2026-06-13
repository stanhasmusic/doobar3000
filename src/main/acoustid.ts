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
  const typeRank = (t: string): number =>
    t.includes('Compilation') ? 2 : t.startsWith('Album') ? 0 : 1
  candidates.sort(
    (a, b) =>
      b.score - a.score || typeRank(a.releaseGroupType) - typeRank(b.releaseGroupType) ||
      (a.year ?? 9999) - (b.year ?? 9999)
  )
  return { ok: true, candidates: candidates.slice(0, 6) }
}

// Write tags by remuxing with ffmpeg (-c copy = audio bytes untouched). The
// original is kept as .bak until the swap succeeds, then deleted.
export async function applyTags(trackPath: string, tags: TagCandidate): Promise<boolean> {
  const ff = await findFfmpeg()
  if (!ff.found || !ff.binary) return false
  const ext = path.extname(trackPath)
  const tmp = trackPath.slice(0, -ext.length) + '.doobar-tmp' + ext
  const bak = trackPath + '.bak'
  const meta: string[] = []
  const push = (k: string, v: string | number | null) => {
    if (v !== null && v !== '') meta.push('-metadata', `${k}=${v}`)
  }
  push('title', tags.title)
  push('artist', tags.artist)
  push('album_artist', tags.albumArtist)
  push('album', tags.album)
  push('date', tags.year)
  push('track', tags.trackNo)
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
    console.error('applyTags failed:', trackPath, err)
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
