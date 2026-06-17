import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  FfmpegStatus,
  IdentifyResult,
  Playlist,
  RadioQuery,
  RadioStation,
  ScanProgress,
  Settings,
  TagCandidate,
  Track,
  VizFrame,
  VizScope
} from '../shared/types'

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  scanFolder: (dir: string): Promise<Track[]> => ipcRenderer.invoke('scan-folder', dir),
  getLibrary: (): Promise<Track[]> => ipcRenderer.invoke('get-library'),
  saveLibrary: (library: Track[]): Promise<void> => ipcRenderer.invoke('save-library', library),
  getPlaylists: (): Promise<Playlist[]> => ipcRenderer.invoke('get-playlists'),
  savePlaylists: (p: Playlist[]): Promise<void> => ipcRenderer.invoke('save-playlists', p),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: Settings): Promise<void> => ipcRenderer.invoke('save-settings', s),
  // recolor the native Windows caption-button strip to match the active theme
  setTitleBarOverlay: (o: { color: string; symbolColor: string }): Promise<void> =>
    ipcRenderer.invoke('set-titlebar-overlay', o),
  getPeaks: (trackPath: string): Promise<number[] | null> =>
    ipcRenderer.invoke('get-peaks', trackPath),
  savePeaks: (trackPath: string, peaks: number[]): Promise<void> =>
    ipcRenderer.invoke('save-peaks', trackPath, peaks),
  onScanProgress: (cb: (p: ScanProgress) => void): void => {
    ipcRenderer.on('scan-progress', (_e, p: ScanProgress) => cb(p))
  },
  importPaths: (paths: string[]): Promise<{ library: Track[]; added: string[] }> =>
    ipcRenderer.invoke('import-paths', paths),
  // Explorer drag-drop: File objects only expose absolute paths via webUtils in preload
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  ffmpegStatus: (): Promise<FfmpegStatus> => ipcRenderer.invoke('ffmpeg-status'),
  ffmpegDownload: (): Promise<boolean> => ipcRenderer.invoke('ffmpeg-download'),
  onFfmpegProgress: (cb: (pct: number) => void): void => {
    ipcRenderer.on('ffmpeg-progress', (_e, pct: number) => cb(pct))
  },
  transcode: (trackPath: string): Promise<string | null> =>
    ipcRenderer.invoke('transcode', trackPath),
  getArt: (trackPath: string, albumKey: string): Promise<string | null> =>
    ipcRenderer.invoke('get-art', trackPath, albumKey),
  fetchArt: (albumArtist: string, album: string): Promise<string | null> =>
    ipcRenderer.invoke('fetch-art', albumArtist, album),
  setArt: (albumKey: string): Promise<string | null> => ipcRenderer.invoke('set-art', albumKey),
  clearArt: (albumKey: string): Promise<void> => ipcRenderer.invoke('clear-art', albumKey),
  fpcalcStatus: (): Promise<boolean> => ipcRenderer.invoke('fpcalc-status'),
  fpcalcDownload: (): Promise<boolean> => ipcRenderer.invoke('fpcalc-download'),
  identifyTrack: (trackPath: string, apiKey: string): Promise<IdentifyResult> =>
    ipcRenderer.invoke('identify-track', trackPath, apiKey),
  applyTags: (trackPath: string, tags: TagCandidate): Promise<Track[] | null> =>
    ipcRenderer.invoke('apply-tags', trackPath, tags),
  applyAlbumTags: (
    paths: string[],
    fields: { album: string; albumArtist: string; year: number | null }
  ): Promise<Track[] | null> => ipcRenderer.invoke('apply-album-tags', paths, fields),
  removeTracks: (paths: string[]): Promise<Track[]> => ipcRenderer.invoke('remove-tracks', paths),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  revealInExplorer: (trackPath: string): Promise<void> =>
    ipcRenderer.invoke('reveal-in-explorer', trackPath),
  fileStat: (trackPath: string): Promise<{ exists: boolean; size: number; modified: number }> =>
    ipcRenderer.invoke('file-stat', trackPath),
  analyzeLoudness: (): Promise<void> => ipcRenderer.invoke('analyze-loudness'),
  onLufsUpdate: (cb: (u: { path: string; lufs: number; peakDb: number }) => void): void => {
    ipcRenderer.on('lufs-update', (_e, u) => cb(u))
  },
  onLufsProgress: (cb: (p: ScanProgress) => void): void => {
    ipcRenderer.on('lufs-progress', (_e, p: ScanProgress) => cb(p))
  },
  analyzeVibe: (): Promise<void> => ipcRenderer.invoke('analyze-vibe'),
  onVibeUpdate: (
    cb: (u: { path: string; brightness: number | null; bpm: number | null }) => void
  ): void => {
    ipcRenderer.on('vibe-update', (_e, u) => cb(u))
  },
  onVibeProgress: (cb: (p: ScanProgress) => void): void => {
    ipcRenderer.on('vibe-progress', (_e, p: ScanProgress) => cb(p))
  },
  // ── Internet radio (Phase D) ──────────────────────────────────────────────
  // Main process → main window: the current-song title parsed from the ICY
  // stream metadata ('' = none). The proxy only emits on change.
  onRadioTitle: (cb: (title: string) => void): void => {
    ipcRenderer.on('radio-title', (_e, title: string) => cb(title))
  },
  // Search the radio-browser directory (Phase D3).
  radioSearch: (query: RadioQuery): Promise<RadioStation[]> =>
    ipcRenderer.invoke('radio-search', query),
  // ── Visualizer pop-out windows (Phase C) ──────────────────────────────────
  // Open a floating window for a scope (main process creates the BrowserWindow).
  openVizPopout: (scope: VizScope): Promise<void> => ipcRenderer.invoke('viz-popout-open', scope),
  // Main window → main process: one analyser frame to broadcast to pop-outs.
  sendVizFrame: (frame: VizFrame): void => ipcRenderer.send('viz-frame', frame),
  // Main process → main window: start/stop producing frames (a pop-out opened/closed).
  onVizFeed: (cb: (active: boolean) => void): void => {
    ipcRenderer.on('viz-feed', (_e, active: boolean) => cb(active))
  },
  // Main process → pop-out window: the latest analyser frame to render.
  onVizFrame: (cb: (frame: VizFrame) => void): void => {
    ipcRenderer.on('viz-frame', (_e, frame: VizFrame) => cb(frame))
  },
  // The scope a pop-out window was opened for (from its URL hash, e.g. #popout=spectrum).
  popoutScope: ((): VizScope | null => {
    const m = window.location.hash.match(/popout=(\w+)/)
    return m ? (m[1] as VizScope) : null
  })(),
  flags: {
    autoplay: process.env.DEV_AUTOPLAY === '1',
    seek: Number(process.env.DEV_SEEK ?? 0)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
