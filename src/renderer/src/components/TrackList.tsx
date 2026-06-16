import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnKey, Track } from '../../../shared/types'
import { levelingDbMap, useStore, type SortKey } from '../store'
import { ALL_COLUMNS, cellValue, COLUMN_DEFS } from '../columns'
import { resolveSmart, smartName } from '../smartPlaylists'
import { droppedPaths } from './Sidebar'
import { IdentifyDialog } from './IdentifyDialog'
import { TrackInfoDialog } from './TrackInfoDialog'
import { clampToViewport } from '../clampMenu'

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
  const selectedPaths = useStore((s) => s.selectedPaths)
  const levelMode = useStore((s) => s.levelMode)
  const columns = useStore((s) => s.columns)
  const {
    playQueue,
    setSort,
    setSelected,
    toggleSelected,
    selectRange,
    setColumns,
    addToPlaylist,
    removeFromPlaylist
  } = useStore.getState()
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths])

  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null)
  const [identifyFor, setIdentifyFor] = useState<Track | null>(null)
  const [infoFor, setInfoFor] = useState<Track | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [drag, setDrag] = useState<{
    key: ColumnKey
    x: number
    y: number
    over: ColumnKey | null
  } | null>(null)

  const isPlaylist = view.type === 'playlist'
  const playlist = isPlaylist ? playlists.find((p) => p.id === view.id) : undefined
  const smartId = view.type === 'smart' ? view.id : null

  // `sortableList` gates the clickable column headers: manual playlists and the
  // Recently-Added smart list keep their own order; everything else sorts.
  const { rows, sortableList } = useMemo<{ rows: Track[]; sortableList: boolean }>(() => {
    if (playlist) {
      const byPath = new Map(library.map((t) => [t.path, t]))
      return {
        rows: playlist.trackPaths
          .map((p) => byPath.get(p))
          .filter((t): t is Track => t !== undefined),
        sortableList: false
      }
    }
    if (smartId) {
      const r = resolveSmart(smartId, library)
      return {
        rows: r.sortable ? [...r.tracks].sort((a, b) => compareTracks(a, b, sortKey, sortDir)) : r.tracks,
        sortableList: r.sortable
      }
    }
    return {
      rows: [...library].sort((a, b) => compareTracks(a, b, sortKey, sortDir)),
      sortableList: true
    }
  }, [library, playlist, smartId, sortKey, sortDir])

  const levelDbs = useMemo(() => levelingDbMap(library, levelMode), [library, levelMode])
  const gridTemplate = useMemo(
    () => columns.map((k) => COLUMN_DEFS[k].width).join(' '),
    [columns]
  )

  // Callback ref: the scroll element only mounts once the library is non-empty
  // (before that we render the empty state), so a plain mount effect would miss it.
  // Attaching the observer when the node actually appears keeps viewportH correct.
  const setBodyRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (el) {
      setViewportH(el.clientHeight)
      const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
      ro.observe(el)
      roRef.current = ro
    }
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

  // Click selection: plain = one row, Ctrl/Cmd = toggle, Shift = range from anchor
  const onRowClick = (e: React.MouseEvent, index: number, path: string) => {
    if (e.shiftKey) {
      const anchor = useStore.getState().selectionAnchor
      const from = anchor ? rows.findIndex((t) => t.path === anchor) : -1
      if (from < 0) return setSelected(path)
      const [lo, hi] = from < index ? [from, index] : [index, from]
      selectRange(rows.slice(lo, hi + 1).map((t) => t.path))
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelected(path)
    } else {
      setSelected(path)
    }
  }

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

  // True swap: the dragged column and its target trade places; nothing else moves.
  const swapColumns = (a: ColumnKey, b: ColumnKey) => {
    if (a === b) return
    const cur = useStore.getState().columns
    const ia = cur.indexOf(a)
    const ib = cur.indexOf(b)
    if (ia < 0 || ib < 0) return
    const next = [...cur]
    ;[next[ia], next[ib]] = [next[ib], next[ia]]
    setColumns(next)
  }

  const colAt = (x: number, y: number): ColumnKey | null =>
    (document.elementFromPoint(x, y)?.closest('[data-colkey]')?.getAttribute('data-colkey') ??
      null) as ColumnKey | null

  // Pointer-based header drag: a floating label follows the cursor and the column
  // it's over animates. A plain press with no movement falls through to sorting.
  const headerPointerDown = (e: React.PointerEvent, key: ColumnKey) => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
      moved = true
      const over = colAt(ev.clientX, ev.clientY)
      setDrag({ key, x: ev.clientX, y: ev.clientY, over: over && over !== key ? over : null })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        const over = colAt(ev.clientX, ev.clientY)
        if (over) swapColumns(key, over)
      } else if (sortableList && COLUMN_DEFS[key].sortable) {
        setSort(key as SortKey)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
          const canSort = sortableList && def.sortable
          // the target leans toward the dragged column's slot — the way it'll travel on a swap
          const isOver = drag?.over === key
          const overDir =
            isOver && drag ? Math.sign(columns.indexOf(drag.key) - columns.indexOf(key)) : 0
          return (
            <div
              key={key}
              data-colkey={key}
              className={`${def.className} ${canSort ? 'sortable' : ''} ${
                drag?.key === key ? 'col-dragging' : ''
              } ${isOver ? `col-over col-over-${overDir > 0 ? 'right' : 'left'}` : ''}`}
              onPointerDown={(e) => headerPointerDown(e, key)}
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
        ref={setBodyRef}
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
                  selectedSet.has(t.path) ? 'selected' : ''
                } ${index % 2 ? 'odd' : ''}`}
                style={{ top: index * ROW_HEIGHT, gridTemplateColumns: gridTemplate }}
                onClick={(e) => onRowClick(e, index, t.path)}
                onDoubleClick={() => playRow(index)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  // right-clicking outside the current selection narrows to that row;
                  // right-clicking a selected row keeps the whole selection
                  if (!selectedSet.has(t.path)) setSelected(t.path)
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
        {playlist ? ` — ${playlist.name}` : smartId ? ` — ${smartName(smartId)}` : ''}
        {selectedPaths.length > 1 ? ` · ${selectedPaths.length} selected` : ''}
      </div>

      {menu && (
        <div ref={clampToViewport} className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="menu-item" onClick={() => playRow(menu.rowIndex)}>
            Play
          </div>
          <div className="menu-item" onClick={() => setIdentifyFor(menu.track)}>
            Identify (auto-tag)…
          </div>
          <div className="menu-item submenu-parent">
            Add {selectedPaths.length > 1 ? `${selectedPaths.length} tracks` : 'to'} Playlist ▸
            <div className="submenu">
              {playlists.length ? (
                playlists.map((p) => (
                  <div
                    key={p.id}
                    className="menu-item"
                    onClick={() => addToPlaylist(p.id, selectedPaths)}
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
          <div
            className="menu-item"
            onClick={() => void window.api.revealInExplorer(menu.track.path)}
          >
            Show in Explorer
          </div>
          <div
            className="menu-item"
            onClick={() => void navigator.clipboard.writeText(menu.track.path)}
          >
            Copy file path
          </div>
          <div className="menu-item" onClick={() => setInfoFor(menu.track)}>
            Get Info…
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
            onClick={() => void useStore.getState().removeFromLibrary(selectedPaths)}
          >
            Remove {selectedPaths.length > 1 ? `${selectedPaths.length} tracks` : ''} from library
          </div>
        </div>
      )}

      {colMenu && (
        <div ref={clampToViewport} className="context-menu" style={{ left: colMenu.x, top: colMenu.y }}>
          <div className="menu-head">Columns</div>
          {ALL_COLUMNS.map((key) => (
            <div key={key} className="menu-item check" onClick={() => toggleColumn(key)}>
              <span className="check-box">{columns.includes(key) ? '✓' : ''}</span>
              {COLUMN_DEFS[key].label}
            </div>
          ))}
        </div>
      )}

      {drag && (
        <div className="col-ghost" style={{ left: drag.x, top: drag.y }}>
          {COLUMN_DEFS[drag.key].label}
        </div>
      )}

      {identifyFor && (
        <IdentifyDialog track={identifyFor} onClose={() => setIdentifyFor(null)} />
      )}

      {infoFor && <TrackInfoDialog track={infoFor} onClose={() => setInfoFor(null)} />}
    </div>
  )
}
