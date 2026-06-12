import { create } from 'zustand'
import type { Playlist, ScanProgress, Track } from '../../shared/types'
import { audio } from './audio'

export type View = { type: 'library' } | { type: 'playlist'; id: string }
export type SortKey = 'title' | 'artist' | 'album' | 'genre' | 'duration' | 'trackNo'

interface State {
  library: Track[]
  playlists: Playlist[]
  view: View
  sortKey: SortKey
  sortDir: 1 | -1
  queue: string[]
  queueIndex: number
  currentPath: string | null
  playing: boolean
  position: number
  volume: number
  scanning: ScanProgress | null
  selectedPath: string | null

  init: () => Promise<void>
  importFolder: () => Promise<void>
  setView: (v: View) => void
  setSort: (k: SortKey) => void
  setSelected: (path: string | null) => void

  playQueue: (paths: string[], index: number) => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (v: number) => void

  createPlaylist: (name: string) => void
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (id: string, paths: string[]) => void
  removeFromPlaylist: (id: string, index: number) => void
}

let saveSettingsTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => ({
  library: [],
  playlists: [],
  view: { type: 'library' },
  sortKey: 'artist',
  sortDir: 1,
  queue: [],
  queueIndex: -1,
  currentPath: null,
  playing: false,
  position: 0,
  volume: 0.8,
  scanning: null,
  selectedPath: null,

  init: async () => {
    const [library, playlists, settings] = await Promise.all([
      window.api.getLibrary(),
      window.api.getPlaylists(),
      window.api.getSettings()
    ])
    audio.setVolume(settings.volume)
    set({ library, playlists, volume: settings.volume })
    window.api.onScanProgress((p) => {
      set({ scanning: p.done >= p.total ? null : p })
    })
  },

  importFolder: async () => {
    const dir = await window.api.selectFolder()
    if (!dir) return
    set({ scanning: { done: 0, total: 0 } })
    const library = await window.api.scanFolder(dir)
    set({ library, scanning: null })
  },

  setView: (view) => set({ view, selectedPath: null }),
  setSort: (k) => {
    const { sortKey, sortDir } = get()
    set(k === sortKey ? { sortDir: sortDir === 1 ? -1 : 1 } : { sortKey: k, sortDir: 1 })
  },
  setSelected: (selectedPath) => set({ selectedPath }),

  playQueue: (paths, index) => {
    if (!paths.length) return
    set({ queue: paths, queueIndex: index, currentPath: paths[index], playing: true, position: 0 })
    audio.load(paths[index], true)
  },
  togglePlay: () => {
    const { playing, currentPath, queue } = get()
    if (!currentPath) {
      if (queue.length) get().playQueue(queue, 0)
      return
    }
    if (playing) {
      audio.pause()
      set({ playing: false })
    } else {
      void audio.play()
      set({ playing: true })
    }
  },
  next: () => {
    const { queue, queueIndex } = get()
    if (queueIndex + 1 < queue.length) {
      get().playQueue(queue, queueIndex + 1)
    } else {
      audio.stop()
      set({ playing: false, currentPath: null, position: 0, queueIndex: -1 })
    }
  },
  prev: () => {
    const { queue, queueIndex, position } = get()
    if (position > 3 || queueIndex <= 0) {
      audio.seek(0)
      set({ position: 0 })
    } else {
      get().playQueue(queue, queueIndex - 1)
    }
  },
  seek: (time) => {
    audio.seek(time)
    set({ position: time })
  },
  setVolume: (volume) => {
    audio.setVolume(volume)
    set({ volume })
    clearTimeout(saveSettingsTimer)
    saveSettingsTimer = setTimeout(() => void window.api.saveSettings({ volume }), 400)
  },

  createPlaylist: (name) => {
    const playlists = [
      ...get().playlists,
      { id: crypto.randomUUID(), name, trackPaths: [] as string[] }
    ]
    set({ playlists })
    void window.api.savePlaylists(playlists)
  },
  renamePlaylist: (id, name) => {
    const playlists = get().playlists.map((p) => (p.id === id ? { ...p, name } : p))
    set({ playlists })
    void window.api.savePlaylists(playlists)
  },
  deletePlaylist: (id) => {
    const playlists = get().playlists.filter((p) => p.id !== id)
    const view = get().view
    set({
      playlists,
      view: view.type === 'playlist' && view.id === id ? { type: 'library' } : view
    })
    void window.api.savePlaylists(playlists)
  },
  addToPlaylist: (id, paths) => {
    const playlists = get().playlists.map((p) =>
      p.id === id ? { ...p, trackPaths: [...p.trackPaths, ...paths] } : p
    )
    set({ playlists })
    void window.api.savePlaylists(playlists)
  },
  removeFromPlaylist: (id, index) => {
    const playlists = get().playlists.map((p) =>
      p.id === id ? { ...p, trackPaths: p.trackPaths.filter((_, i) => i !== index) } : p
    )
    set({ playlists })
    void window.api.savePlaylists(playlists)
  }
}))

audio.onEnded = () => useStore.getState().next()
audio.onTimeUpdate = (time) => {
  // coarse updates for the top-bar clock; the waveform reads time via rAF directly
  if (Math.abs(time - useStore.getState().position) > 0.25) {
    useStore.setState({ position: time })
  }
}

export function trackByPath(library: Track[], path: string | null): Track | undefined {
  return path ? library.find((t) => t.path === path) : undefined
}

export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
