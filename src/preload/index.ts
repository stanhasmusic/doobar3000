import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FfmpegStatus, Playlist, ScanProgress, Settings, Track } from '../shared/types'

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  scanFolder: (dir: string): Promise<Track[]> => ipcRenderer.invoke('scan-folder', dir),
  getLibrary: (): Promise<Track[]> => ipcRenderer.invoke('get-library'),
  getPlaylists: (): Promise<Playlist[]> => ipcRenderer.invoke('get-playlists'),
  savePlaylists: (p: Playlist[]): Promise<void> => ipcRenderer.invoke('save-playlists', p),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: Settings): Promise<void> => ipcRenderer.invoke('save-settings', s),
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
  getArt: (trackPath: string): Promise<string | null> => ipcRenderer.invoke('get-art', trackPath),
  analyzeLoudness: (): Promise<void> => ipcRenderer.invoke('analyze-loudness'),
  onLufsUpdate: (cb: (u: { path: string; lufs: number; peakDb: number }) => void): void => {
    ipcRenderer.on('lufs-update', (_e, u) => cb(u))
  },
  onLufsProgress: (cb: (p: ScanProgress) => void): void => {
    ipcRenderer.on('lufs-progress', (_e, p: ScanProgress) => cb(p))
  },
  flags: {
    autoplay: process.env.DEV_AUTOPLAY === '1',
    seek: Number(process.env.DEV_SEEK ?? 0)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
