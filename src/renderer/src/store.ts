import { create } from 'zustand'
import type {
  ColumnKey,
  FfmpegStatus,
  LevelMode,
  Playlist,
  RepeatMode,
  ScanProgress,
  Track
} from '../../shared/types'
import { audio } from './audio'

const LUFS_TARGET = -18 // ReplayGain 2.0 reference loudness

const clampGain = (gainDb: number, headroom: number): number =>
  Math.max(-24, Math.min(gainDb, Math.max(headroom, 0), 12))

// Gain per track path for a leveling mode. Album mode computes one gain for
// the whole album (energy-weighted average loudness), so tracks keep their
// relative dynamics; the gain is capped so no track on the album would clip.
// Exported so the track list's Level column can show what's being applied.
export function levelingDbMap(library: Track[], mode: LevelMode): Map<string, number> {
  const map = new Map<string, number>()
  if (mode === 'off') return map
  if (mode === 'track') {
    for (const t of library) {
      if (t.lufs !== null) map.set(t.path, clampGain(LUFS_TARGET - t.lufs, -1 - (t.peakDb ?? 0)))
    }
    return map
  }
  const albums = new Map<string, Track[]>()
  for (const t of library) {
    if (t.lufs === null) continue
    const key = `${t.albumArtist}|${t.album}`
    albums.get(key)?.push(t) ?? albums.set(key, [t])
  }
  for (const tracks of albums.values()) {
    let energy = 0
    let dur = 0
    for (const t of tracks) {
      energy += t.duration * Math.pow(10, t.lufs! / 10)
      dur += t.duration
    }
    const gainDb = LUFS_TARGET - 10 * Math.log10(energy / Math.max(dur, 1))
    const headroom = Math.min(...tracks.map((t) => -1 - (t.peakDb ?? 0)))
    for (const t of tracks) map.set(t.path, clampGain(gainDb, headroom))
  }
  return map
}

function levelingDb(track: Track | undefined, mode: LevelMode, library: Track[]): number {
  if (!track) return 0
  return levelingDbMap(library, mode).get(track.path) ?? 0
}

export type View =
  | { type: 'library' }
  | { type: 'playlist'; id: string }
  | { type: 'duplicates' }
  | { type: 'smart'; id: string }
// every column except Level (whose value depends on the leveling mode) is sortable
export type SortKey = Exclude<ColumnKey, 'level'>

export const DEFAULT_COLUMNS: ColumnKey[] = [
  'trackNo',
  'title',
  'artist',
  'album',
  'genre',
  'duration',
  'level'
]

// Likely duplicates: same normalized title + artist, durations within 2 s.
// Returns groups of 2+ tracks (fingerprint-accurate matching can layer on later).
const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export function duplicateGroups(library: Track[]): Track[][] {
  const byKey = new Map<string, Track[]>()
  for (const t of library) {
    const key = `${norm(t.title)}|${norm(t.artist)}`
    byKey.get(key)?.push(t) ?? byKey.set(key, [t])
  }
  const groups: Track[][] = []
  for (const tracks of byKey.values()) {
    if (tracks.length < 2) continue
    tracks.sort((a, b) => a.duration - b.duration)
    let cluster: Track[] = [tracks[0]]
    for (let i = 1; i <= tracks.length; i++) {
      if (i < tracks.length && tracks[i].duration - cluster[cluster.length - 1].duration <= 2) {
        cluster.push(tracks[i])
      } else {
        if (cluster.length >= 2) groups.push(cluster)
        cluster = i < tracks.length ? [tracks[i]] : []
      }
    }
  }
  return groups
}

interface State {
  library: Track[]
  playlists: Playlist[]
  view: View
  sortKey: SortKey
  sortDir: 1 | -1
  queue: string[]
  /** traversal order: indices into `queue` (identity when not shuffled) */
  order: number[]
  /** position within `order` of the current track */
  orderPos: number
  shuffle: boolean
  repeat: RepeatMode
  currentPath: string | null
  playing: boolean
  position: number
  volume: number
  scanning: ScanProgress | null
  selectedPath: string | null
  notice: string | null
  levelMode: LevelMode
  columns: ColumnKey[]
  acoustidKey: string
  ffmpeg: FfmpegStatus | null
  ffmpegProgress: number | null
  lufsProgress: ScanProgress | null
  fpcalcFound: boolean
  fpcalcInstalling: boolean
  /** actual file being played (a transcode-cache path when the original can't decode) */
  playbackPath: string | null

  init: () => Promise<void>
  importFolder: () => Promise<void>
  importPaths: (paths: string[]) => Promise<string[]>
  dropOnPlaylist: (id: string, paths: string[]) => Promise<void>
  setLevelMode: (m: LevelMode) => void
  setColumns: (c: ColumnKey[]) => void
  setAcoustidKey: (k: string) => void
  removeFromLibrary: (paths: string[]) => Promise<void>
  downloadFfmpeg: () => Promise<void>
  downloadFpcalc: () => Promise<void>
  showNotice: (msg: string) => void
  setView: (v: View) => void
  setSort: (k: SortKey) => void
  setSelected: (path: string | null) => void

  playQueue: (paths: string[], index: number) => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  seek: (time: number) => void
  setVolume: (v: number) => void

  createPlaylist: (name: string) => void
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (id: string, paths: string[]) => void
  removeFromPlaylist: (id: string, index: number) => void
}

let saveSettingsTimer: ReturnType<typeof setTimeout> | undefined

function persistSettings(): void {
  const s = useStore.getState()
  void window.api.saveSettings({
    volume: s.volume,
    levelMode: s.levelMode,
    columns: s.columns,
    acoustidKey: s.acoustidKey,
    shuffle: s.shuffle,
    repeat: s.repeat
  })
}

// Fisher–Yates shuffle of queue indices, with `first` forced to the front so the
// track the user picked plays now and the rest follow in random order.
function buildOrder(length: number, shuffle: boolean, first: number): number[] {
  const order = Array.from({ length }, (_, i) => i)
  if (!shuffle) return order
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const at = order.indexOf(first)
  ;[order[0], order[at]] = [order[at], order[0]]
  return order
}

export const useStore = create<State>((set, get) => ({
  library: [],
  playlists: [],
  view: { type: 'library' },
  sortKey: 'artist',
  sortDir: 1,
  queue: [],
  order: [],
  orderPos: -1,
  shuffle: false,
  repeat: 'off',
  currentPath: null,
  playing: false,
  position: 0,
  volume: 0.8,
  scanning: null,
  selectedPath: null,
  notice: null,
  levelMode: 'off',
  columns: DEFAULT_COLUMNS,
  acoustidKey: '',
  ffmpeg: null,
  ffmpegProgress: null,
  lufsProgress: null,
  fpcalcFound: false,
  fpcalcInstalling: false,
  playbackPath: null,

  init: async () => {
    const [library, playlists, settings, ffmpeg, fpcalcFound] = await Promise.all([
      window.api.getLibrary(),
      window.api.getPlaylists(),
      window.api.getSettings(),
      window.api.ffmpegStatus(),
      window.api.fpcalcStatus()
    ])
    audio.setVolume(settings.volume)
    set({
      library,
      playlists,
      volume: settings.volume,
      levelMode: settings.levelMode,
      columns: settings.columns?.length ? settings.columns : DEFAULT_COLUMNS,
      acoustidKey: settings.acoustidKey ?? '',
      shuffle: settings.shuffle ?? false,
      repeat: settings.repeat ?? 'off',
      ffmpeg,
      fpcalcFound
    })
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
    persistSettings()
    applyLeveling()
  },

  setColumns: (columns) => {
    set({ columns })
    persistSettings()
  },

  setAcoustidKey: (acoustidKey) => {
    set({ acoustidKey })
    persistSettings()
  },

  removeFromLibrary: async (paths) => {
    const gone = new Set(paths)
    // pull them from any playlists too, then update the library from disk
    const playlists = get().playlists.map((p) => ({
      ...p,
      trackPaths: p.trackPaths.filter((tp) => !gone.has(tp))
    }))
    if (playlists.some((p, i) => p.trackPaths.length !== get().playlists[i].trackPaths.length)) {
      set({ playlists })
      void window.api.savePlaylists(playlists)
    }
    const library = await window.api.removeTracks(paths)
    const cleared = get().currentPath && gone.has(get().currentPath!)
    set({ library, ...(cleared ? { selectedPath: null } : {}) })
    get().showNotice(`Removed ${paths.length} track${paths.length === 1 ? '' : 's'} from library`)
  },

  downloadFfmpeg: async () => {
    set({ ffmpegProgress: 0 })
    const ok = await window.api.ffmpegDownload()
    const ffmpeg = await window.api.ffmpegStatus()
    set({ ffmpeg, ffmpegProgress: null })
    get().showNotice(ok ? 'Decoder pack installed.' : 'Decoder pack download failed.')
    if (ok && get().library.some((t) => t.lufs === null)) void window.api.analyzeLoudness()
  },

  downloadFpcalc: async () => {
    set({ fpcalcInstalling: true })
    const ok = await window.api.fpcalcDownload()
    set({ fpcalcInstalling: false, fpcalcFound: ok || get().fpcalcFound })
    get().showNotice(ok ? 'Fingerprinter installed.' : 'Fingerprinter download failed.')
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
    const order = buildOrder(paths.length, get().shuffle, index)
    set({
      queue: paths,
      order,
      orderPos: 0,
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
  next: () => playAtOrderPos(get().orderPos + 1),
  prev: () => {
    const { orderPos, position } = get()
    if (position > 3 || orderPos <= 0) {
      audio.seek(0)
      set({ position: 0 })
    } else {
      playAtOrderPos(orderPos - 1)
    }
  },
  toggleShuffle: () => {
    const shuffle = !get().shuffle
    const { queue, order, orderPos } = get()
    // rebuild the remaining order so the toggle takes effect immediately, while
    // keeping the current track playing at the new front
    const current = order[orderPos] ?? 0
    set({
      shuffle,
      ...(queue.length
        ? { order: buildOrder(queue.length, shuffle, current), orderPos: 0 }
        : {})
    })
    persistSettings()
  },
  cycleRepeat: () => {
    const modes: RepeatMode[] = ['off', 'all', 'one']
    set({ repeat: modes[(modes.indexOf(get().repeat) + 1) % modes.length] })
    persistSettings()
  },
  seek: (time) => {
    audio.seek(time)
    set({ position: time })
  },
  setVolume: (volume) => {
    audio.setVolume(volume)
    set({ volume })
    clearTimeout(saveSettingsTimer)
    saveSettingsTimer = setTimeout(persistSettings, 400)
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

// Move to a position in the play order. Past the end: wrap if repeat-all
// (reshuffling for variety when shuffled), otherwise stop.
function playAtOrderPos(pos: number): void {
  const s = useStore.getState()
  if (!s.queue.length) return
  let order = s.order
  if (pos >= order.length) {
    if (s.repeat !== 'all') {
      audio.stop()
      useStore.setState({
        playing: false,
        currentPath: null,
        playbackPath: null,
        position: 0,
        orderPos: -1
      })
      return
    }
    if (s.shuffle) order = buildOrder(s.queue.length, true, order[0] ?? 0)
    pos = 0
  } else if (pos < 0) {
    pos = 0
  }
  const path = s.queue[order[pos]]
  useStore.setState({
    order,
    orderPos: pos,
    currentPath: path,
    playbackPath: path,
    playing: true,
    position: 0
  })
  applyLeveling()
  audio.load(path, true)
}

audio.onEnded = () => {
  const s = useStore.getState()
  if (s.repeat === 'one') {
    audio.seek(0)
    void audio.play()
    return
  }
  playAtOrderPos(s.orderPos + 1)
}

// dev-only: lets the screenshot harness (DEV_EVAL) drive the store
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  ;(window as unknown as { useStore: typeof useStore }).useStore = useStore
}

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

export function formatDb(db: number): string {
  return `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`
}

export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
