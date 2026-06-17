import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_TOPBAR_LAYOUT, type Playlist, type Settings, type Track } from '../shared/types'

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

async function writeJson(file: string, data: unknown): Promise<void> {
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
  }
  return tracks
}
export const saveLibrary = (tracks: Track[]) => writeJson('library.json', tracks)

export const getPlaylists = () => readJson<Playlist[]>('playlists.json', [])
export const savePlaylists = (playlists: Playlist[]) => writeJson('playlists.json', playlists)

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
  nerdMode: false
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
