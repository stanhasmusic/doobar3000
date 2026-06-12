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

export interface Playlist {
  id: string
  name: string
  trackPaths: string[]
}

export interface Settings {
  volume: number
  levelMode: LevelMode
}

export interface FfmpegStatus {
  found: boolean
  source: 'app' | 'path' | null
}

export interface ScanProgress {
  done: number
  total: number
}
