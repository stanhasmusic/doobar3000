import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '../../../shared/types'
import { formatTime, useStore, type SortKey } from '../store'
import { droppedPaths } from './Sidebar'

const ROW_HEIGHT = 34
const OVERSCAN = 10

interface MenuState {
  x: number
  y: number
  track: Track
  rowIndex: number
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'trackNo', label: '#', className: 'col-no' },
  { key: 'title', label: 'Title', className: 'col-title' },
  { key: 'artist', label: 'Artist', className: 'col-artist' },
  { key: 'album', label: 'Album', className: 'col-album' },
  { key: 'genre', label: 'Genre', className: 'col-genre' },
  { key: 'duration', label: 'Time', className: 'col-time' }
]

function compareTracks(a: Track, b: Track, key: SortKey, dir: 1 | -1): number {
  const tier = (x: Track, y: Track, k: SortKey): number => {
    if (k === 'duration') return x.duration - y.duration
    if (k === 'trackNo') return (x.trackNo ?? 0) - (y.trackNo ?? 0)
    return String(x[k]).localeCompare(String(y[k]), undefined, { sensitivity: 'base' })
  }
  // artist/album sorts cascade like iTunes: artist → album → track number
  const tiers: SortKey[] =
    key === 'artist'
      ? ['artist', 'album', 'trackNo']
      : key === 'album'
        ? ['album', 'trackNo']
        : [key]
  for (const k of tiers) {
    const c = tier(a, b, k)
    if (c !== 0) return c * dir
  }
  return 0
}

function Notice() {
  const notice = useStore((s) => s.notice)
  return notice ? <span className="notice">{notice}&ensp;·&ensp;</span> : null
}

export function TrackList() {
  const library = useStore((s) => s.library)
  const playlists = useStore((s) => s.playlists)
  const view = useStore((s) => s.view)
  const sortKey = useStore((s) => s.sortKey)
  const sortDir = useStore((s) => s.sortDir)
  const currentPath = useStore((s) => s.currentPath)
  const selectedPath = useStore((s) => s.selectedPath)
  const { playQueue, setSort, setSelected, addToPlaylist, removeFromPlaylist } =
    useStore.getState()

  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isPlaylist = view.type === 'playlist'
  const playlist = isPlaylist ? playlists.find((p) => p.id === view.id) : undefined

  const rows: Track[] = useMemo(() => {
    if (playlist) {
      const byPath = new Map(library.map((t) => [t.path, t]))
      return playlist.trackPaths
        .map((p) => byPath.get(p))
        .filter((t): t is Track => t !== undefined)
    }
    return [...library].sort((a, b) => compareTracks(a, b, sortKey, sortDir))
  }, [library, playlist, isPlaylist, sortKey, sortDir])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)

  const playRow = (index: number) =>
    playQueue(
      rows.map((t) => t.path),
      index
    )

  // dropping files/folders from Explorer anywhere on the track area imports them
  const dropProps = {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const paths = droppedPaths(e)
      if (paths.length) void useStore.getState().importPaths(paths)
    }
  }

  if (!library.length) {
    return (
      <div className="tracklist empty-state" {...dropProps}>
        <div>
          <h2>Your library is empty</h2>
          <p>Click “+ Import Folder” in the sidebar, or drop files/folders here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="tracklist" {...dropProps}>
      <div className="list-header">
        {COLUMNS.map((c) => (
          <div
            key={c.key}
            className={`${c.className} ${!isPlaylist ? 'sortable' : ''}`}
            onClick={() => !isPlaylist && setSort(c.key)}
          >
            {c.label}
            {!isPlaylist && sortKey === c.key && (
              <span className="sort-arrow">{sortDir === 1 ? '▲' : '▼'}</span>
            )}
          </div>
        ))}
      </div>

      <div
        className="list-body"
        ref={containerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {rows.slice(first, last).map((t, i) => {
            const index = first + i
            const isCurrent = t.path === currentPath
            return (
              <div
                key={`${t.path}-${index}`}
                className={`row ${isCurrent ? 'current' : ''} ${
                  t.path === selectedPath ? 'selected' : ''
                } ${index % 2 ? 'odd' : ''}`}
                style={{ top: index * ROW_HEIGHT }}
                onClick={() => setSelected(t.path)}
                onDoubleClick={() => playRow(index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSelected(t.path)
                  setMenu({ x: e.clientX, y: e.clientY, track: t, rowIndex: index })
                }}
              >
                <div className="col-no">{isCurrent ? '♪' : (t.trackNo ?? '')}</div>
                <div className="col-title">{t.title}</div>
                <div className="col-artist">{t.artist}</div>
                <div className="col-album">{t.album}</div>
                <div className="col-genre">{t.genre}</div>
                <div className="col-time">{formatTime(t.duration)}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="status-bar">
        <Notice />
        {rows.length} track{rows.length === 1 ? '' : 's'}
        {playlist ? ` — ${playlist.name}` : ''}
      </div>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="menu-item" onClick={() => playRow(menu.rowIndex)}>
            Play
          </div>
          <div className="menu-item submenu-parent">
            Add to Playlist ▸
            <div className="submenu">
              {playlists.length ? (
                playlists.map((p) => (
                  <div
                    key={p.id}
                    className="menu-item"
                    onClick={() => addToPlaylist(p.id, [menu.track.path])}
                  >
                    {p.name}
                  </div>
                ))
              ) : (
                <div className="menu-item disabled">No playlists yet</div>
              )}
            </div>
          </div>
          {playlist && (
            <div
              className="menu-item"
              onClick={() => removeFromPlaylist(playlist.id, menu.rowIndex)}
            >
              Remove from Playlist
            </div>
          )}
        </div>
      )}
    </div>
  )
}
