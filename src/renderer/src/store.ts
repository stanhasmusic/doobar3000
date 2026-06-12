import { create } from 'zustand'
import type { FfmpegStatus, LevelMode, Playlist, ScanProgress, Track } from '../../shared/types'
import { audio } from './audio'

const LUFS_TARGET = -18 // ReplayGain 2.0 reference loudness

// Gain to apply for the current leveling mode. Album mode computes one gain for
// the whole album (energy-weighted average loudness), so tracks keep their
// relative dynamics; the gain is capped so no track on the album would clip.
function levelingDb(track: Track | undefined, mode: LevelMode, library: Track[]): number {
  if (!track || mode === 'off' || track.lufs === null) return 0
  let gainDb: number
  let headroom: number
  if (mode === 'album') {
    const albumTracks = library.filter(
      (t) => t.album === track.album && t.albumArtist === track.albumArtist && t.lufs !== null
    )
    if (!albumTracks.length) return 0
    let energy = 0
    let dur = 0
    for (const t of albumTracks) {
      energy += t.duration * Math.pow(10, t.lufs! / 10)
      dur += t.duration
    }
    gainDb = LUFS_TARGET - 10 * Math.log10(energy / Math.max(dur, 1))
    headroom = Math.min(...albumTracks.map((t) => -1 - (t.peakDb ?? 0)))
  } else {
    gainDb = LUFS_TARGET - track.lufs
    headroom = -1 - (track.peakDb ?? 0)
  }
  return Math.max(-24, Math.min(gainDb, Math.max(headroom, 0), 12))
}

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
  notice: string | null
  levelMode: LevelMode
  ffmpeg: FfmpegStatus | null
  ffmpegProgress: number | null
  lufsProgress: ScanProgress | null
  /** actual file being played (a transcode-cache path when the original can't decode) */
  playbackPath: string | null

  init: () => Promise<void>
  importFolder: () => Promise<void>
  importPaths: (paths: string[]) => Promise<string[]>
  dropOnPlaylist: (id: string, paths: string[]) => Promise<void>
  setLevelMode: (m: LevelMode) => void
  downloadFfmpeg: () => Promise<void>
  showNotice: (msg: string) => void
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
  notice: null,
  levelMode: 'off',
  ffmpeg: null,
  ffmpegProgress: null,
  lufsProgress: null,
  playbackPath: null,

  init: async () => {
    const [library, playlists, settings, ffmpeg] = await Promise.all([
      window.api.getLibrary(),
      window.api.getPlaylists(),
      window.api.getSettings(),
      window.api.ffmpegStatus()
    ])
    audio.setVolume(settings.volume)
    set({ library, playlists, volume: settings.volume, levelMode: settings.levelMode, ffmpeg })
    window.api.onScanProgress((p) => {
      set({ scanning: p.done >= p.total ? null : p })
    })
    window.api.onFfmpegProgress((pct) => set({ ffmpegProgress: pct }))
    window.api.onLufsProgress((p) => set({ lufsProgress: p.done >= p.total ? null : p }))
    window.api.onLufsUpdate((u) => {
      set({
        library: get().library.map((t) =>
          t.path === u.path ? { ...t, lufs: u.lufs, peakDb: u.peakDb } : t
        )
      })
      if (u.path === get().currentPath) applyLeveling()
    })
    if (ffmpeg.found && library.some((t) => t.lufs === null)) {
      void window.api.analyzeLoudness()
    }
  },

  importFolder: async () => {
    const dir = await window.api.selectFolder()
    if (!dir) return
    set({ scanning: { done: 0, total: 0 } })
    const library = await window.api.scanFolder(dir)
    set({ library, scanning: null })
    if (get().ffmpeg?.found) void window.api.analyzeLoudness()
  },

  importPaths: async (paths) => {
    set({ scanning: { done: 0, total: 0 } })
    const { library, added } = await window.api.importPaths(paths)
    set({ library, scanning: null })
    get().showNotice(`Added ${added.length} track${added.length === 1 ? '' : 's'}`)
    if (get().ffmpeg?.found) void window.api.analyzeLoudness()
    return added
  },

  dropOnPlaylist: async (id, paths) => {
    const added = await get().importPaths(paths)
    if (added.length) get().addToPlaylist(id, added)
  },

  setLevelMode: (levelMode) => {
    set({ levelMode })
    void window.api.saveSettings({ volume: get().volume, levelMode })
    applyLeveling()
  },

  downloadFfmpeg: async () => {
    set({ ffmpegProgress: 0 })
    const ok = await window.api.ffmpegDownload()
    const ffmpeg = await window.api.ffmpegStatus()
    set({ ffmpeg, ffmpegProgress: null })
    get().showNotice(ok ? 'Decoder pack installed.' : 'Decoder pack download failed.')
    if (ok && get().library.some((t) => t.lufs === null)) void window.api.analyzeLoudness()
  },

  showNotice: (msg) => {
    set({ notice: msg })
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => set({ notice: null }), 5000)
  },

  setView: (view) => set({ view, selectedPath: null }),
  setSort: (k) => {
    const { sortKey, sortDir } = get()
    set(k === sortKey ? { sortDir: sortDir === 1 ? -1 : 1 } : { sortKey: k, sortDir: 1 })
  },
  setSelected: (selectedPath) => set({ selectedPath }),

  playQueue: (paths, index) => {
    if (!paths.length) return
    set({
      queue: paths,
      queueIndex: index,
      currentPath: paths[index],
      playbackPath: paths[index],
      playing: true,
      position: 0
    })
    applyLeveling()
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
      set({ playing: false, currentPath: null, playbackPath: null, position: 0, queueIndex: -1 })
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
    saveSettingsTimer = setTimeout(
      () => void window.api.saveSettings({ volume, levelMode: get().levelMode }),
      400
    )
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

let noticeTimer: ReturnType<typeof setTimeout> | undefined

function applyLeveling(): void {
  const s = useStore.getState()
  audio.setLevelGainDb(levelingDb(trackByPath(s.library, s.currentPath), s.levelMode, s.library))
}

// Chromium can't decode this file (e.g. ALAC). If ffmpeg is installed, transcode
// to cached FLAC and retry once; otherwise tell the user and skip.
const transcodeTried = new Set<string>()
audio.onError = () => {
  const st = useStore.getState()
  const orig = st.currentPath
  const failed = trackByPath(st.library, orig)
  if (!orig || !failed) return
  if (st.ffmpeg?.found && !transcodeTried.has(orig)) {
    transcodeTried.add(orig)
    st.showNotice(`Converting "${failed.title}"…`)
    void window.api.transcode(orig).then((out) => {
      const cur = useStore.getState()
      if (cur.currentPath !== orig) return // user moved on while we converted
      if (out) {
        useStore.setState({ playbackPath: out, notice: null })
        audio.load(out, cur.playing)
      } else {
        cur.showNotice(`Can't play "${failed.title}" — conversion failed. Skipping.`)
        cur.next()
      }
    })
  } else {
    st.showNotice(
      st.ffmpeg?.found
        ? `Can't play "${failed.title}" — unsupported format. Skipping.`
        : `Can't play "${failed.title}" — install the decoder pack (⚙) to play this format.`
    )
    st.next()
  }
}
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
