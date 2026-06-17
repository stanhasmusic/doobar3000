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
  bitsPerSample: number | null
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

/** the big visualizers offered in the nerd-mode expandable overlay (Phase C) */
export type VizScope = 'spectrum' | 'spectrogram' | 'oscilloscope' | 'goniometer'
export const ALL_VIZ_SCOPES: VizScope[] = [
  'spectrum',
  'spectrogram',
  'oscilloscope',
  'goniometer'
]
export const VIZ_SCOPE_LABELS: Record<VizScope, string> = {
  spectrum: 'Spectrum',
  spectrogram: 'Spectrogram',
  oscilloscope: 'Oscilloscope',
  goniometer: 'Goniometer'
}

/** one analyser frame shipped from the main window to the pop-out viz windows */
export interface VizFrame {
  freq: Uint8Array
  timeL: Float32Array
  timeR: Float32Array
  sampleRate: number
  /** now-playing track title, shown in the pop-out header ('' when idle) */
  title: string
}

export interface Playlist {
  id: string
  name: string
  trackPaths: string[]
}

/** An internet-radio station. NOT a Track — radio is a distinct playback source
 *  that never enters the library/leveling/column logic (Phase D). `url` is the
 *  resolved stream URL (radio-browser `url_resolved`); `id` is its uuid. */
export interface Station {
  id: string
  name: string
  url: string
  codec: string
  bitrate: number
  country: string
  favicon?: string
}

/** A station as it comes back from a radio-browser search: a playable Station
 *  plus the display-only vote count used to rank/show results (Phase D3). */
export interface RadioStation extends Station {
  votes: number
}

/** Search facets for the radio-browser browse dialog (Phase D3). All optional;
 *  blank fields are simply omitted from the query. */
export interface RadioQuery {
  name?: string
  tag?: string
  country?: string
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
  /** "nerd mode" — layers extra technical readouts onto the existing UI and
   *  reveals advanced settings nodes. A single annotation flag, not a second UI. */
  nerdMode: boolean
  /** chosen audio output device (mediaDevices deviceId; '' = system default).
   *  Device ids rotate with hardware changes, so a stale id falls back to default. */
  outputDeviceId: string
  /** which big visualizers the nerd-mode overlay offers (Display → Visualizers).
   *  Order is display order in the stage selector. */
  visualizers: VizScope[]
  /** last-selected scope in the docked viz panel / pop-outs */
  vizScope: VizScope
  /** width (px) of the docked visualizer side panel */
  vizPanelWidth: number
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
