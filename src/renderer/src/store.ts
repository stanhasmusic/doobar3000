import { create } from 'zustand'
import {
  DEFAULT_TOPBAR_LAYOUT,
  type ColumnKey,
  type FfmpegStatus,
  type LevelMode,
  type Playlist,
  type RepeatMode,
  type ScanProgress,
  type Theme,
  type TopbarWidget,
  type Track
} from '../../shared/types'
import { audio } from './audio'
import { VIBE_ENABLED } from './smartPlaylists'

// Themes are driven by CSS variables; presets live in styles.css under
// `:root[data-theme='…']`. 'custom' reuses the dark base and overrides the
// accent vars inline from a user-picked hex color.
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.slice(1)
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
export function applyTheme(theme: Theme, accentColor: string): void {
  const root = document.documentElement
  root.dataset.theme = theme === 'custom' ? 'dark' : theme
  const accentVars = ['--accent', '--accent-hover', '--accent-soft'] as const
  if (theme === 'custom' && HEX.test(accentColor)) {
    root.style.setProperty('--accent', accentColor)
    root.style.setProperty('--accent-hover', accentColor)
    root.style.setProperty('--accent-soft', hexToRgba(accentColor, 0.16))
  } else {
    for (const v of accentVars) root.style.removeProperty(v)
  }
  refreshVizColors()
  // Tint the native Windows caption-button strip to match the top bar so the
  // min/max/close buttons read as part of the bar instead of a separate region.
  const cs = getComputedStyle(root)
  const color = cs.getPropertyValue('--topbar-top').trim() || '#1a1a1f'
  const symbolColor = cs.getPropertyValue('--text-dim').trim() || '#9a9aa5'
  void window.api?.setTitleBarOverlay?.({ color, symbolColor })
}

// Canvas visualizers (spectrum, waveform, VU) can't read CSS vars directly, so we
// snapshot the active theme's colors here and refresh on every theme change.
// Spectrum/waveform tones derive from the accent so a Custom accent flows through too.
export const vizColors = {
  accent: '#e0556e',
  accentLight: '#ff9aa8',
  accentDark: '#8a3b50',
  text: '#e8e8ec',
  faint: '#45454e',
  track: '#2a2a31'
}
const readVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(c: [number, number, number], t: [number, number, number], k: number): string {
  const m = (a: number, b: number): number => Math.round(a + (b - a) * k)
  return `rgb(${m(c[0], t[0])}, ${m(c[1], t[1])}, ${m(c[2], t[2])})`
}
export function refreshVizColors(): void {
  const accent = readVar('--accent') || '#e0556e'
  const rgb = toRgb(accent)
  vizColors.accent = accent
  vizColors.accentLight = mix(rgb, [255, 255, 255], 0.45)
  vizColors.accentDark = mix(rgb, [0, 0, 0], 0.4)
  vizColors.text = readVar('--text') || '#e8e8ec'
  vizColors.faint = readVar('--text-faint') || '#45454e'
  vizColors.track = readVar('--border') || '#2a2a31'
}

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
  /** all currently-selected track paths (multi-select) */
  selectedPaths: string[]
  /** the row a Shift-range extends from / a plain click sets */
  selectionAnchor: string | null
  notice: string | null
  levelMode: LevelMode
  columns: ColumnKey[]
  topbarLayout: TopbarWidget[]
  acoustidKey: string
  theme: Theme
  accentColor: string
  /** first-run welcome dialog is shown until dismissed */
  seenWelcome: boolean
  /** "nerd mode" — extra technical readouts + advanced settings nodes */
  nerdMode: boolean
  ffmpeg: FfmpegStatus | null
  ffmpegProgress: number | null
  lufsProgress: ScanProgress | null
  vibeProgress: ScanProgress | null
  fpcalcFound: boolean
  fpcalcInstalling: boolean
  /** actual file being played (a transcode-cache path when the original can't decode) */
  playbackPath: string | null
  canUndo: boolean
  canRedo: boolean

  init: () => Promise<void>
  importFolder: () => Promise<void>
  importPaths: (paths: string[]) => Promise<string[]>
  dropOnPlaylist: (id: string, paths: string[]) => Promise<void>
  setLevelMode: (m: LevelMode) => void
  setColumns: (c: ColumnKey[]) => void
  setTopbarLayout: (l: TopbarWidget[]) => void
  resetTopbarLayout: () => void
  setAcoustidKey: (k: string) => void
  setTheme: (t: Theme) => void
  setAccentColor: (c: string) => void
  setNerdMode: (on: boolean) => void
  dismissWelcome: () => void
  replayWelcome: () => void
  removeFromLibrary: (paths: string[]) => Promise<void>
  downloadFfmpeg: () => Promise<void>
  downloadFpcalc: () => Promise<void>
  showNotice: (msg: string) => void
  undo: () => void
  redo: () => void
  setView: (v: View) => void
  setSort: (k: SortKey) => void
  /** plain click — select exactly this row (or clear with null) */
  setSelected: (path: string | null) => void
  /** Ctrl/Cmd-click — add or remove one row from the selection */
  toggleSelected: (path: string) => void
  /** Shift-click — replace selection with the given range of paths */
  selectRange: (paths: string[]) => void

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
    topbarLayout: s.topbarLayout,
    acoustidKey: s.acoustidKey,
    shuffle: s.shuffle,
    repeat: s.repeat,
    theme: s.theme,
    accentColor: s.accentColor,
    seenWelcome: s.seenWelcome,
    nerdMode: s.nerdMode
  })
}

// Snapshot-based undo/redo for library + playlist edits. Both arrays are always
// replaced wholesale (never mutated in place) elsewhere in this store, so keeping
// references is safe and cheap. `snapshot(label)` is called *before* a mutation.
interface HistoryEntry {
  label: string
  library: Track[]
  playlists: Playlist[]
}
const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []
const HISTORY_LIMIT = 15

function syncHistoryFlags(): void {
  useStore.setState({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 })
}

function snapshot(label: string): void {
  const s = useStore.getState()
  undoStack.push({ label, library: s.library, playlists: s.playlists })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
  syncHistoryFlags()
}

// Roll back the most recent snapshot when the action it guarded turned out to be
// a no-op (e.g. an import where every file was already in the library).
function discardLastSnapshot(): void {
  undoStack.pop()
  syncHistoryFlags()
}

function applyHistoryEntry(entry: HistoryEntry): void {
  const cur = useStore.getState()
  const live = new Set(entry.library.map((t) => t.path))
  const viewPlaylistId = cur.view.type === 'playlist' ? cur.view.id : null
  const viewGone = viewPlaylistId !== null && !entry.playlists.some((p) => p.id === viewPlaylistId)
  useStore.setState({
    library: entry.library,
    playlists: entry.playlists,
    selectedPaths: cur.selectedPaths.filter((p) => live.has(p)),
    ...(cur.selectionAnchor && !live.has(cur.selectionAnchor) ? { selectionAnchor: null } : {}),
    // if the active view points at a now-deleted playlist, fall back to the library
    ...(viewGone ? { view: { type: 'library' } as View } : {})
  })
  void window.api.saveLibrary(entry.library)
  void window.api.savePlaylists(entry.playlists)
  syncHistoryFlags()
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
  selectedPaths: [],
  selectionAnchor: null,
  notice: null,
  levelMode: 'off',
  columns: DEFAULT_COLUMNS,
  topbarLayout: DEFAULT_TOPBAR_LAYOUT,
  acoustidKey: '',
  theme: 'dark',
  accentColor: '#e0556e',
  seenWelcome: true, // assume seen until init loads the real setting (avoids a flash)
  nerdMode: false,
  ffmpeg: null,
  ffmpegProgress: null,
  lufsProgress: null,
  vibeProgress: null,
  fpcalcFound: false,
  fpcalcInstalling: false,
  playbackPath: null,
  canUndo: false,
  canRedo: false,

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
      topbarLayout: settings.topbarLayout?.length ? settings.topbarLayout : DEFAULT_TOPBAR_LAYOUT,
      acoustidKey: settings.acoustidKey ?? '',
      shuffle: settings.shuffle ?? false,
      repeat: settings.repeat ?? 'off',
      theme: settings.theme ?? 'dark',
      accentColor: settings.accentColor || '#e0556e',
      seenWelcome: settings.seenWelcome ?? false,
      nerdMode: settings.nerdMode ?? false,
      ffmpeg,
      fpcalcFound
    })
    applyTheme(settings.theme ?? 'dark', settings.accentColor || '#e0556e')
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return // don't hijack text editing
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        e.shiftKey ? get().redo() : get().undo()
      } else if (k === 'y') {
        e.preventDefault()
        get().redo()
      }
    })
    window.api.onScanProgress((p) => {
      set({ scanning: p.done >= p.total ? null : p })
    })
    window.api.onFfmpegProgress((pct) => set({ ffmpegProgress: pct }))
    window.api.onLufsProgress((p) => set({ lufsProgress: p.done >= p.total ? null : p }))
    // Background analysis streams one update per track. Buffer them and flush in
    // batches (see flushAnalysis) so a large library isn't rebuilt once per track.
    window.api.onLufsUpdate((u) => {
      pendingLufs.set(u.path, { lufs: u.lufs, peakDb: u.peakDb })
      scheduleAnalysisFlush()
    })
    window.api.onVibeProgress((p) => set({ vibeProgress: p.done >= p.total ? null : p }))
    window.api.onVibeUpdate((u) => {
      pendingVibe.set(u.path, { brightness: u.brightness, bpm: u.bpm })
      scheduleAnalysisFlush()
    })
    if (ffmpeg.found) {
      if (library.some((t) => t.lufs === null)) void window.api.analyzeLoudness()
      if (VIBE_ENABLED && library.some((t) => t.brightness === null || t.bpm === null))
        void window.api.analyzeVibe()
    }
  },

  importFolder: async () => {
    const dir = await window.api.selectFolder()
    if (!dir) return
    snapshot('import folder')
    set({ scanning: { done: 0, total: 0 } })
    const library = await window.api.scanFolder(dir)
    set({ library, scanning: null })
    if (get().ffmpeg?.found) {
      void window.api.analyzeLoudness()
      if (VIBE_ENABLED) void window.api.analyzeVibe()
    }
  },

  importPaths: async (paths) => {
    snapshot('add tracks')
    set({ scanning: { done: 0, total: 0 } })
    const { library, added } = await window.api.importPaths(paths)
    set({ library, scanning: null })
    if (!added.length) discardLastSnapshot() // nothing changed — don't leave a no-op undo
    get().showNotice(`Added ${added.length} track${added.length === 1 ? '' : 's'}`)
    if (get().ffmpeg?.found) {
      void window.api.analyzeLoudness()
      if (VIBE_ENABLED) void window.api.analyzeVibe()
    }
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

  setTopbarLayout: (topbarLayout) => {
    set({ topbarLayout })
    persistSettings()
  },

  resetTopbarLayout: () => {
    set({ topbarLayout: DEFAULT_TOPBAR_LAYOUT })
    persistSettings()
  },

  setAcoustidKey: (acoustidKey) => {
    set({ acoustidKey })
    persistSettings()
  },

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme, get().accentColor)
    persistSettings()
  },

  setAccentColor: (accentColor) => {
    set({ accentColor })
    if (get().theme === 'custom') applyTheme('custom', accentColor)
    persistSettings()
  },

  setNerdMode: (nerdMode) => {
    set({ nerdMode })
    persistSettings()
  },

  dismissWelcome: () => {
    set({ seenWelcome: true })
    persistSettings()
  },

  // Re-show the first-run welcome guide (from Settings → General).
  replayWelcome: () => {
    set({ seenWelcome: false })
    persistSettings()
  },

  removeFromLibrary: async (paths) => {
    snapshot(`remove ${paths.length} track${paths.length === 1 ? '' : 's'}`)
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
    set({
      library,
      selectedPaths: get().selectedPaths.filter((p) => !gone.has(p)),
      ...(get().selectionAnchor && gone.has(get().selectionAnchor!) ? { selectionAnchor: null } : {})
    })
    // keep the play queue/now-playing coherent if any removed track was queued
    pruneQueue(gone)
    get().showNotice(`Removed ${paths.length} track${paths.length === 1 ? '' : 's'} from library`)
  },

  downloadFfmpeg: async () => {
    set({ ffmpegProgress: 0 })
    const ok = await window.api.ffmpegDownload()
    const ffmpeg = await window.api.ffmpegStatus()
    set({ ffmpeg, ffmpegProgress: null })
    get().showNotice(ok ? 'Decoder pack installed.' : 'Decoder pack download failed.')
    if (ok) {
      if (get().library.some((t) => t.lufs === null)) void window.api.analyzeLoudness()
      if (VIBE_ENABLED && get().library.some((t) => t.brightness === null || t.bpm === null))
        void window.api.analyzeVibe()
    }
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

  undo: () => {
    const entry = undoStack.pop()
    if (!entry) return
    const s = get()
    redoStack.push({ label: entry.label, library: s.library, playlists: s.playlists })
    applyHistoryEntry(entry)
    get().showNotice(`Undid: ${entry.label}`)
  },
  redo: () => {
    const entry = redoStack.pop()
    if (!entry) return
    const s = get()
    undoStack.push({ label: entry.label, library: s.library, playlists: s.playlists })
    applyHistoryEntry(entry)
    get().showNotice(`Redid: ${entry.label}`)
  },

  setView: (view) => set({ view, selectedPaths: [], selectionAnchor: null }),
  setSort: (k) => {
    const { sortKey, sortDir } = get()
    set(k === sortKey ? { sortDir: sortDir === 1 ? -1 : 1 } : { sortKey: k, sortDir: 1 })
  },
  setSelected: (path) =>
    set({ selectedPaths: path ? [path] : [], selectionAnchor: path }),
  toggleSelected: (path) => {
    const cur = get().selectedPaths
    const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]
    set({ selectedPaths: next, selectionAnchor: path })
  },
  selectRange: (paths) => set({ selectedPaths: paths }),

  playQueue: (paths, index) => {
    if (!paths.length) return
    const order = buildOrder(paths.length, get().shuffle, index)
    set({
      queue: paths,
      order,
      // shuffle forces the picked track to the front (→0); unshuffled keeps it at
      // `index`. Either way orderPos must point at where `index` landed in `order`,
      // or next/prev step relative to the wrong track.
      orderPos: order.indexOf(index),
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
    snapshot('create playlist')
    const playlists = [
      ...get().playlists,
      { id: crypto.randomUUID(), name, trackPaths: [] as string[] }
    ]
    set({ playlists })
    void window.api.savePlaylists(playlists)
  },
  renamePlaylist: (id, name) => {
    snapshot('rename playlist')
    const playlists = get().playlists.map((p) => (p.id === id ? { ...p, name } : p))
    set({ playlists })
    void window.api.savePlaylists(playlists)
  },
  deletePlaylist: (id) => {
    snapshot('delete playlist')
    const playlists = get().playlists.filter((p) => p.id !== id)
    const view = get().view
    set({
      playlists,
      view: view.type === 'playlist' && view.id === id ? { type: 'library' } : view
    })
    void window.api.savePlaylists(playlists)
  },
  addToPlaylist: (id, paths) => {
    snapshot(`add to playlist`)
    const playlists = get().playlists.map((p) =>
      p.id === id ? { ...p, trackPaths: [...p.trackPaths, ...paths] } : p
    )
    set({ playlists })
    void window.api.savePlaylists(playlists)
  },
  removeFromPlaylist: (id, index) => {
    snapshot('remove from playlist')
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

// Drop paths from the play queue (e.g. when tracks are removed from the library)
// while keeping playback coherent. Surviving tracks keep their traversal order.
// If the track currently playing was removed, advance to the next survivor in the
// play order (wrapping under repeat-all, stopping if none remain); if the queue
// empties entirely, stop.
function pruneQueue(gone: Set<string>): void {
  const s = useStore.getState()
  if (!s.queue.length || !s.queue.some((p) => gone.has(p))) return // queue untouched

  // Surviving queue entries, in queue order, with a map from old → new index so
  // the order[] indices (which point into the queue) can be remapped in place.
  const survived = s.queue.map((p, i) => ({ p, i })).filter(({ p }) => !gone.has(p))
  const newQueue = survived.map(({ p }) => p)
  const oldToNew = new Map<number, number>()
  survived.forEach(({ i }, n) => oldToNew.set(i, n))
  const newOrder = s.order.filter((qi) => oldToNew.has(qi)).map((qi) => oldToNew.get(qi)!)

  const stop = (): void => {
    audio.stop()
    useStore.setState({
      queue: newQueue,
      order: newOrder,
      orderPos: -1,
      currentPath: null,
      playbackPath: null,
      playing: false,
      position: 0
    })
  }

  if (!newQueue.length) return stop() // removed the whole queue

  // Current track survived (or nothing was playing): keep it playing, just
  // re-point the queue/order/orderPos at it. playbackPath is left untouched so a
  // transcode fallback keeps streaming.
  if (s.currentPath == null || !gone.has(s.currentPath)) {
    const curIdx = s.currentPath == null ? -1 : newQueue.indexOf(s.currentPath)
    useStore.setState({
      queue: newQueue,
      order: newOrder,
      orderPos: curIdx < 0 ? -1 : newOrder.indexOf(curIdx)
    })
    return
  }

  // The playing track was removed → resume from the next survivor in the order.
  let nextIdx = -1
  for (let p = s.orderPos + 1; p < s.order.length; p++) {
    const ni = oldToNew.get(s.order[p])
    if (ni !== undefined) {
      nextIdx = ni
      break
    }
  }
  if (nextIdx < 0 && s.repeat === 'all') nextIdx = newOrder[0] // wrap to the front
  if (nextIdx < 0) return stop() // nothing after it, not repeating

  const nextPath = newQueue[nextIdx]
  useStore.setState({
    queue: newQueue,
    order: newOrder,
    orderPos: newOrder.indexOf(nextIdx),
    currentPath: nextPath,
    playbackPath: nextPath,
    playing: s.playing,
    position: 0
  })
  applyLeveling()
  audio.load(nextPath, s.playing)
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

// Background analysis (loudness / vibe) emits one result per track. Applying each
// one individually would rebuild the entire `library` array per track — O(N²) over
// a full pass, plus a re-render each time. Instead we buffer results here and flush
// them together on a short timer, so a 10k-track pass does a few hundred rebuilds
// instead of 10k.
const pendingLufs = new Map<string, { lufs: number; peakDb: number }>()
const pendingVibe = new Map<string, { brightness: number | null; bpm: number | null }>()
let analysisFlushTimer: ReturnType<typeof setTimeout> | undefined

function scheduleAnalysisFlush(): void {
  if (analysisFlushTimer) return
  analysisFlushTimer = setTimeout(flushAnalysis, 250)
}

function flushAnalysis(): void {
  analysisFlushTimer = undefined
  if (!pendingLufs.size && !pendingVibe.size) return
  const s = useStore.getState()
  const reLevel = s.currentPath != null && pendingLufs.has(s.currentPath)
  const library = s.library.map((t) => {
    const l = pendingLufs.get(t.path)
    const v = pendingVibe.get(t.path)
    if (!l && !v) return t
    return {
      ...t,
      ...(l ? { lufs: l.lufs, peakDb: l.peakDb } : {}),
      ...(v ? { brightness: v.brightness ?? t.brightness, bpm: v.bpm ?? t.bpm } : {})
    }
  })
  pendingLufs.clear()
  pendingVibe.clear()
  useStore.setState({ library })
  if (reLevel) applyLeveling()
}

function applyLeveling(): void {
  const s = useStore.getState()
  audio.setLevelGainDb(levelingDb(trackByPath(s.library, s.currentPath), s.levelMode, s.library))
}

// Chromium can't decode some formats (e.g. ALAC). When the ORIGINAL file errors
// and ffmpeg is available, transcode to a cached FLAC and switch playback to it.
// The loop guard is `playbackPath`: if the error arrives while we're already
// playing a transcode (playbackPath ≠ the original), the transcode itself failed,
// so we give up and skip. Keying off playbackPath instead of a permanent
// "already tried" set means a track can be replayed any number of times in a
// session and still fall back to its cached transcode each time.
audio.onError = () => {
  const st = useStore.getState()
  const orig = st.currentPath
  const failed = trackByPath(st.library, orig)
  if (!orig || !failed) return
  const playingOriginal = st.playbackPath === orig
  if (st.ffmpeg?.found && playingOriginal) {
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
