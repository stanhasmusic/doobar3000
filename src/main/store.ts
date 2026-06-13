import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Playlist, Settings, Track } from '../shared/types'

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
  await fs.mkdir(dataDir(), { recursive: true })
  await fs.writeFile(path.join(dataDir(), file), JSON.stringify(data))
}

export const getLibrary = () => readJson<Track[]>('library.json', [])
export const saveLibrary = (tracks: Track[]) => writeJson('library.json', tracks)

export const getPlaylists = () => readJson<Playlist[]>('playlists.json', [])
export const savePlaylists = (playlists: Playlist[]) => writeJson('playlists.json', playlists)

const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  levelMode: 'off',
  columns: ['trackNo', 'title', 'artist', 'album', 'genre', 'duration', 'level'],
  acoustidKey: '',
  shuffle: false,
  repeat: 'off'
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
