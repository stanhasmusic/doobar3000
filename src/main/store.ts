import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  ALL_VIZ_SCOPES,
  DEFAULT_TOPBAR_LAYOUT,
  type Playlist,
  type RadioData,
  type Settings,
  type Track
} from '../shared/types'

function dataDir(): string {
  return app.getPath('userData')
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir(), file), 'utf8')) as T
  } catch {
    return fallback
  }
}

// Writes in flight right now. `flushPending` awaits these on quit so a 34 MB
// library.json save isn't killed mid-rename by app.quit(); see the before-quit
// handler in index.ts.
const pending = new Set<Promise<void>>()

async function writeJson(file: string, data: unknown): Promise<void> {
  const p = (async (): Promise<void> => {
    const dir = dataDir()
    await fs.mkdir(dir, { recursive: true })
    const dest = path.join(dir, file)
    // Atomic write: serialize to a temp file, then rename it over the target.
    // rename is atomic on a single volume, so a crash (or a second concurrent
    // write) can never leave a truncated library.json — a reader always sees the
    // complete old contents or the complete new ones. The pid in the temp name
    // keeps concurrent writers from sharing a scratch file.
    const tmp = `${dest}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data))
    await fs.rename(tmp, dest)
  })()
  pending.add(p)
  try {
    await p
  } finally {
    pending.delete(p)
  }
}

/**
 * Resolves once no write is in flight. A write that starts while we're draining
 * is picked up by the re-check, so this can't return with work still pending.
 * Rejections are swallowed — a failed save must not block the app from quitting.
 */
export async function flushPending(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending])
}

/**
 * A hard kill (Task Manager, power loss) leaves the scratch file behind — no
 * quit handler can catch that, so sweep at boot instead. Only this process's own
 * pid pattern would be reused, but any stale .tmp here is dead weight.
 */
export async function sweepTempFiles(): Promise<void> {
  try {
    const dir = dataDir()
    for (const name of await fs.readdir(dir)) {
      if (name.endsWith('.tmp')) await fs.rm(path.join(dir, name), { force: true })
    }
  } catch {
    // Nothing to sweep, or the dir doesn't exist yet — never block startup.
  }
}

export const getLibrary = async (): Promise<Track[]> => {
  const tracks = await readJson<Track[]>('library.json', [])
  // Backfill nullable analysis fields that may be absent on tracks scanned by an
  // older version. A missing key reads as `undefined`, which slips past the
  // `=== null` "needs analysis" checks — normalize so every track has them.
  for (const t of tracks) {
    t.lufs ??= null
    t.peakDb ??= null
    t.brightness ??= null
    t.bpm ??= null
    t.bitsPerSample ??= null
  }
  return tracks
}
export const saveLibrary = (tracks: Track[]) => writeJson('library.json', tracks)

export const getPlaylists = () => readJson<Playlist[]>('playlists.json', [])
export const savePlaylists = (playlists: Playlist[]) => writeJson('playlists.json', playlists)

// Radio favorites + play-history (Phase D4). Merged with a default so an older
// file missing one key still loads cleanly.
const DEFAULT_RADIO: RadioData = { favorites: [], recent: [] }
export const getRadio = async (): Promise<RadioData> => ({
  ...DEFAULT_RADIO,
  ...(await readJson<Partial<RadioData>>('radio.json', {}))
})
export const saveRadio = (data: RadioData) => writeJson('radio.json', data)

const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  levelMode: 'off',
  columns: ['trackNo', 'title', 'artist', 'album', 'genre', 'duration', 'level'],
  topbarLayout: DEFAULT_TOPBAR_LAYOUT,
  // Bring-your-own AcoustID key: users paste a free application key in ⚙ (it
  // persists in settings.json). Never commit a real key here — it's public-repo source.
  acoustidKey: '',
  shuffle: false,
  repeat: 'off',
  theme: 'dark',
  accentColor: '#e0556e',
  seenWelcome: false,
  nerdMode: false,
  outputDeviceId: '',
  visualizers: ALL_VIZ_SCOPES,
  vizScope: 'spectrum',
  vizPanelWidth: 360,
  vizFps: 60,
  analysisQuality: 'full',
  analysisPaused: false
}
export const getSettings = async (): Promise<Settings> => ({
  ...DEFAULT_SETTINGS,
  ...(await readJson<Partial<Settings>>('settings.json', {}))
})
export const saveSettings = (s: Settings) => writeJson('settings.json', s)

function peaksFile(trackPath: string): string {
  const hash = createHash('sha1').update(trackPath).digest('hex')
  return path.join(dataDir(), 'peaks', `${hash}.json`)
}

export async function getPeaks(trackPath: string): Promise<number[] | null> {
  try {
    return JSON.parse(await fs.readFile(peaksFile(trackPath), 'utf8')) as number[]
  } catch {
    return null
  }
}

export async function savePeaks(trackPath: string, peaks: number[]): Promise<void> {
  await fs.mkdir(path.join(dataDir(), 'peaks'), { recursive: true })
  await fs.writeFile(peaksFile(trackPath), JSON.stringify(peaks))
}
