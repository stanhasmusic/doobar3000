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
}

export type LevelMode = 'off' | 'track' | 'album'
export type RepeatMode = 'off' | 'all' | 'one'

export interface Playlist {
  id: string
  name: string
  trackPaths: string[]
}

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
  /** AcoustID application API key (user-provided, for track identification) */
  acoustidKey: string
  shuffle: boolean
  repeat: RepeatMode
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
