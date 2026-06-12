import { contextBridge, ipcRenderer } from 'electron'
import type { Playlist, ScanProgress, Settings, Track } from '../shared/types'

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
  flags: {
    autoplay: process.env.DEV_AUTOPLAY === '1'
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
