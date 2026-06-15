import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import MusicTempo from 'music-tempo'
import type { FfmpegStatus } from '../shared/types'

const execFileP = promisify(execFile)

// gyan.dev "essentials" build: stable URL, ~80 MB, includes every audio codec we need
const DOWNLOAD_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

const appBinary = () => path.join(app.getPath('userData'), 'bin', 'ffmpeg.exe')

let cached: { binary: string; source: 'app' | 'path' } | null = null

export async function findFfmpeg(): Promise<FfmpegStatus & { binary?: string }> {
  if (cached) return { found: true, source: cached.source, binary: cached.binary }
  for (const [binary, source] of [
    [appBinary(), 'app'],
    ['ffmpeg', 'path']
  ] as const) {
    try {
      await execFileP(binary, ['-version'])
      cached = { binary, source }
      return { found: true, source, binary }
    } catch {
      /* keep looking */
    }
  }
  return { found: false, source: null }
}

export async function downloadFfmpeg(onProgress: (pct: number) => void): Promise<boolean> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doobar-ffmpeg-'))
  const zipPath = path.join(tmpDir, 'ffmpeg.zip')
  try {
    const res = await net.fetch(DOWNLOAD_URL)
    if (!res.ok || !res.body) return false
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    const counter = new TransformStream({
      transform(chunk: Uint8Array, controller) {
        received += chunk.byteLength
        if (total) onProgress(Math.round((received / total) * 100))
        controller.enqueue(chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(res.body.pipeThrough(counter) as never),
      createWriteStream(zipPath)
    )

    // Windows 10+ ships bsdtar, which extracts zips
    await execFileP('tar', ['-xf', zipPath, '-C', tmpDir], { maxBuffer: 1024 * 1024 })

    // locate ffmpeg.exe inside the extracted folder
    let found: string | null = null
    const search = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (found) return
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await search(full)
        else if (e.name.toLowerCase() === 'ffmpeg.exe') found = full
      }
    }
    await search(tmpDir)
    if (!found) return false

    await fs.mkdir(path.dirname(appBinary()), { recursive: true })
    await fs.copyFile(found, appBinary())
    cached = null
    return (await findFfmpeg()).found
  } catch (err) {
    console.error('ffmpeg download failed:', err)
    return false
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Decode-anything fallback: transcode to FLAC (lossless, Chromium-playable), cached by path hash.
const inFlight = new Map<string, Promise<string | null>>()

export async function transcode(trackPath: string): Promise<string | null> {
  const ff = await findFfmpeg()
  if (!ff.found || !ff.binary) return null
  const outDir = path.join(app.getPath('userData'), 'transcode')
  const out = path.join(outDir, `${createHash('sha1').update(trackPath).digest('hex')}.flac`)
  try {
    await fs.access(out)
    return out
  } catch {
    /* not cached yet */
  }
  if (inFlight.has(out)) return inFlight.get(out)!
  const job = (async () => {
    try {
      await fs.mkdir(outDir, { recursive: true })
      await execFileP(
        ff.binary!,
        ['-y', '-i', trackPath, '-vn', '-compression_level', '2', out],
        { maxBuffer: 16 * 1024 * 1024 }
      )
      return out
    } catch (err) {
      console.error('transcode failed:', trackPath, err)
      await fs.rm(out, { force: true }).catch(() => {})
      return null
    } finally {
      inFlight.delete(out)
    }
  })()
  inFlight.set(out, job)
  return job
}

// EBU R128 integrated loudness + true peak via ffmpeg's ebur128 filter.
export async function measureLoudness(
  trackPath: string
): Promise<{ lufs: number; peakDb: number } | null> {
  const ff = await findFfmpeg()
  if (!ff.found || !ff.binary) return null
  return new Promise((resolve) => {
    const proc = spawn(ff.binary!, [
      '-hide_banner',
      '-nostats',
      '-i',
      trackPath,
      '-map',
      'a:0',
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-'
    ])
    let err = ''
    proc.stderr.on('data', (d) => (err += d))
    proc.on('close', () => {
      // ebur128 logs a progress line per frame whose "I:" starts at -70 LUFS;
      // only the LAST "I:"/"Peak:" (the end-of-run summary) is the real value
      const lufs = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)
      const peak = [...err.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)
      resolve(lufs ? { lufs: Number(lufs[1]), peakDb: peak ? Number(peak[1]) : 0 } : null)
    })
    proc.on('error', () => resolve(null))
  })
}

// Vibe analysis (Phase 4.5): mean spectral centroid (brightness) + estimated
// tempo (BPM). The energy axis is read separately from the existing LUFS value.
// Both sub-measures decode the file, so they run sequentially to keep at most
// one extra ffmpeg process per worker (matching the loudness pass's load).
export async function measureVibe(
  trackPath: string
): Promise<{ brightness: number | null; bpm: number | null }> {
  const ff = await findFfmpeg()
  if (!ff.found || !ff.binary) return { brightness: null, bpm: null }
  const brightness = await measureBrightness(ff.binary, trackPath)
  const bpm = await measureTempo(ff.binary, trackPath)
  return { brightness, bpm }
}

// aspectralstats logs the per-frame spectral centroid (Hz) as frame metadata;
// ametadata=print:file=- emits it to stdout. We average across the track.
function measureBrightness(binary: string, trackPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn(binary, [
      '-hide_banner',
      '-nostats',
      '-i',
      trackPath,
      '-map',
      'a:0',
      '-af',
      'aformat=channel_layouts=mono,aspectralstats=measure=centroid,ametadata=print:file=-',
      '-f',
      'null',
      '-'
    ])
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('close', () => {
      let sum = 0
      let n = 0
      for (const m of out.matchAll(/centroid=([\d.]+)/g)) {
        const v = Number(m[1])
        if (Number.isFinite(v)) {
          sum += v
          n++
        }
      }
      resolve(n ? Math.round(sum / n) : null)
    })
    proc.on('error', () => resolve(null))
  })
}

// Decode up to 4 min of mono PCM at 11.025 kHz (plenty for tempo, bounds cost)
// and run beat detection over it.
function measureTempo(binary: string, trackPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn(binary, [
      '-v',
      'quiet',
      '-t',
      '240',
      '-i',
      trackPath,
      '-map',
      'a:0',
      '-ac',
      '1',
      '-ar',
      '11025',
      '-f',
      'f32le',
      '-'
    ])
    const chunks: Buffer[] = []
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.on('close', () => {
      try {
        const buf = Buffer.concat(chunks)
        if (buf.byteLength < 4 * 11025) return resolve(null) // < 1 s of audio
        const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
        const mt = new MusicTempo(Array.from(samples))
        const bpm = Math.round(Number(mt.tempo))
        resolve(Number.isFinite(bpm) && bpm > 0 ? bpm : null)
      } catch {
        resolve(null)
      }
    })
    proc.on('error', () => resolve(null))
  })
}
