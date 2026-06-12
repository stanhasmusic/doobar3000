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
}

export interface Playlist {
  id: string
  name: string
  trackPaths: string[]
}

export interface Settings {
  volume: number
}

export interface ScanProgress {
  done: number
  total: number
}
