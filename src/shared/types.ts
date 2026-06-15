export interface Track {
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  genre: string
  year: number | null
  trackNo: number | null
  duration: number
  addedAt: number
  // tech fields (Phase 2+; older library entries may lack them until rescan)
  bitrate: number | null
  sampleRate: number | null
  codec: string | null
  fileType: string | null
  // EBU R128 loudness analysis (null = not yet analyzed)
  lufs: number | null
  peakDb: number | null
  // Vibe analysis (Phase 4.5; null = not yet analyzed). energy axis reuses lufs.
  brightness: number | null // mean spectral centroid, Hz (higher = brighter/treblier)
  bpm: number | null // estimated tempo, beats per minute
}

export type LevelMode = 'off' | 'track' | 'album'
export type RepeatMode = 'off' | 'all' | 'one'
export type Theme = 'dark' | 'light' | 'midnight' | 'sepia' | 'custom'

export interface Playlist {
  id: string
  name: string
  trackPaths: string[]
}

/** the rearrangeable widgets in the top bar, in display order */
export type TopbarWidget = 'logo' | 'transport' | 'nowPlaying' | 'viz' | 'settings' | 'volume'

export const DEFAULT_TOPBAR_LAYOUT: TopbarWidget[] = [
  'transport',
  'nowPlaying',
  'logo',
  'viz',
  'volume',
  'settings'
]

export type ColumnKey =
  | 'trackNo'
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'genre'
  | 'year'
  | 'duration'
  | 'bitrate'
  | 'sampleRate'
  | 'codec'
  | 'fileType'
  | 'level'

export interface Settings {
  volume: number
  levelMode: LevelMode
  /** visible track-list columns, in display order */
  columns: ColumnKey[]
  /** rearrangeable top-bar widgets, in display order */
  topbarLayout: TopbarWidget[]
  /** AcoustID application API key (user-provided, for track identification) */
  acoustidKey: string
  shuffle: boolean
  repeat: RepeatMode
  /** app color scheme */
  theme: Theme
  /** accent color (hex) used when theme === 'custom' */
  accentColor: string
  /** true once the user has dismissed the first-run welcome/alpha-notes dialog */
  seenWelcome: boolean
}

/** one tag proposal from an AcoustID/MusicBrainz lookup */
export interface TagCandidate {
  score: number
  title: string
  artist: string
  albumArtist: string
  album: string
  year: number | null
  trackNo: number | null
  releaseGroupType: string
}

export type IdentifyResult =
  | { ok: true; candidates: TagCandidate[] }
  | { ok: false; error: string }

export interface FfmpegStatus {
  found: boolean
  source: 'app' | 'path' | null
}

export interface ScanProgress {
  done: number
  total: number
}
