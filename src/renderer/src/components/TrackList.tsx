import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnKey, Track } from '../../../shared/types'
import { levelingDbMap, useStore, type SortKey } from '../store'
import { ALL_COLUMNS, cellValue, COLUMN_DEFS } from '../columns'
import { droppedPaths } from './Sidebar'
import { IdentifyDialog } from './IdentifyDialog'

const ROW_HEIGHT = 34
const OVERSCAN = 10

interface MenuState {
  x: number
  y: number
  track: Track
  rowIndex: number
}

const NUMERIC_KEYS = new Set<SortKey>(['trackNo', 'duration', 'year', 'bitrate', 'sampleRate'])

function compareTracks(a: Track, b: Track, key: SortKey, dir: 1 | -1): number {
  const tier = (x: Track, y: Track, k: SortKey): number => {
    if (NUMERIC_KEYS.has(k)) return Number(x[k] ?? 0) - Number(y[k] ?? 0)
    return String(x[k] ?? '').localeCompare(String(y[k] ?? ''), undefined, { sensitivity: 'base' })
  }
  // artist/album-ish sorts cascade like iTunes: → album → track number
  const tiers: SortKey[] =
    key === 'artist'
      ? ['artist', 'album', 'trackNo']
      : key === 'albumArtist'
        ? ['albumArtist', 'album', 'trackNo']
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

const searchUrls = (t: Track): { spotify: string; apple: string } => {
  const q = encodeURIComponent(`${t.artist} ${t.title}`.trim())
  return {
    spotify: `https://open.spotify.com/search/${q}`,
    apple: `https://music.apple.com/us/search?term=${q}`
  }
}

export function TrackList() {
  const library = useStore((s) => s.library)
  const playlists = useStore((s) => s.playlists)
  const view = useStore((s) => s.view)
  const sortKey = useStore((s) => s.sortKey)
  const sortDir = useStore((s) => s.sortDir)
  const currentPath = useStore((s) => s.currentPath)
  const selectedPath = useStore((s) => s.selectedPath)
  const levelMode = useStore((s) => s.levelMode)
  const columns = useStore((s) => s.columns)
  const { playQueue, setSort, setSelected, setColumns, addToPlaylist, removeFromPlaylist } =
    useStore.getState()

  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null)
  const [identifyFor, setIdentifyFor] = useState<Track | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragKey = useRef<ColumnKey | null>(null)

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

  const levelDbs = useMemo(() => levelingDbMap(library, levelMode), [library, levelMode])
  const gridTemplate = useMemo(
    () => columns.map((k) => COLUMN_DEFS[k].width).join(' '),
    [columns]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const close = () => {
      setMenu(null)
      setColMenu(null)
    }
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
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault()
    },
    onDrop: (e: React.DragEvent) => {
      const paths = droppedPaths(e)
      if (paths.length) {
        e.preventDefault()
        void useStore.getState().importPaths(paths)
      }
    }
  }

  // drag a header onto another to reorder columns
  const onColDrop = (target: ColumnKey) => {
    const from = dragKey.current
    dragKey.current = null
    if (!from || from === target) return
    const next = columns.filter((k) => k !== from)
    next.splice(next.indexOf(target), 0, from)
    setColumns(next)
  }

  const toggleColumn = (key: ColumnKey) => {
    if (columns.includes(key)) {
      if (columns.length > 1) setColumns(columns.filter((k) => k !== key))
    } else {
      setColumns([...columns, key])
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
      <div
        className="list-header"
        style={{ gridTemplateColumns: gridTemplate }}
        onContextMenu={(e) => {
          e.preventDefault()
          setColMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {columns.map((key) => {
          const def = COLUMN_DEFS[key]
          const canSort = !isPlaylist && def.sortable
          return (
            <div
              key={key}
              className={`${def.className} ${canSort ? 'sortable' : ''}`}
              draggable
              onDragStart={() => (dragKey.current = key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onColDrop(key)}
              onClick={() => canSort && setSort(key as SortKey)}
            >
              {def.label}
              {canSort && sortKey === key && (
                <span className="sort-arrow">{sortDir === 1 ? '▲' : '▼'}</span>
              )}
            </div>
          )
        })}
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
                style={{ top: index * ROW_HEIGHT, gridTemplateColumns: gridTemplate }}
                onClick={() => setSelected(t.path)}
                onDoubleClick={() => playRow(index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setSelected(t.path)
                  setMenu({ x: e.clientX, y: e.clientY, track: t, rowIndex: index })
                }}
              >
                {columns.map((key) => (
                  <div key={key} className={COLUMN_DEFS[key].className}>
                    {cellValue(key, t, isCurrent, levelMode, levelDbs.get(t.path))}
                  </div>
                ))}
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
          <div className="menu-item" onClick={() => setIdentifyFor(menu.track)}>
            Identify (auto-tag)…
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
          <div
            className="menu-item"
            onClick={() => void window.api.openExternal(searchUrls(menu.track).spotify)}
          >
            Search on Spotify
          </div>
          <div
            className="menu-item"
            onClick={() => void window.api.openExternal(searchUrls(menu.track).apple)}
          >
            Search on Apple Music
          </div>
          <div className="menu-sep" />
          {playlist && (
            <div
              className="menu-item"
              onClick={() => removeFromPlaylist(playlist.id, menu.rowIndex)}
            >
              Remove from Playlist
            </div>
          )}
          <div
            className="menu-item danger"
            onClick={() => void useStore.getState().removeFromLibrary([menu.track.path])}
          >
            Remove from library
          </div>
        </div>
      )}

      {colMenu && (
        <div className="context-menu" style={{ left: colMenu.x, top: colMenu.y }}>
          <div className="menu-head">Columns</div>
          {ALL_COLUMNS.map((key) => (
            <div key={key} className="menu-item check" onClick={() => toggleColumn(key)}>
              <span className="check-box">{columns.includes(key) ? '✓' : ''}</span>
              {COLUMN_DEFS[key].label}
            </div>
          ))}
        </div>
      )}

      {identifyFor && (
        <IdentifyDialog track={identifyFor} onClose={() => setIdentifyFor(null)} />
      )}
    </div>
  )
}
