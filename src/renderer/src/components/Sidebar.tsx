import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { smartPlaylists } from '../smartPlaylists'
import { ArtPanel } from './ArtPanel'
import { ConfirmDialog } from './ConfirmDialog'

export function droppedPaths(e: React.DragEvent): string[] {
  return Array.from(e.dataTransfer.files)
    .map((f) => window.api.getPathForFile(f))
    .filter(Boolean)
}

// D1 SPIKE PLACEHOLDER — replaced by the radio-browser search dialog in Phase D3.
// A known-good Icecast stream (SomaFM Groove Salad) to prove the radio:// proxy +
// graph + live visualizers end-to-end. Icecast answers a clean HTTP/1.1 200, so
// the spike isn't blocked on the "ICY 200 OK" status-line landmine.
const SPIKE_STATION = {
  id: 'spike-groovesalad',
  name: 'SomaFM — Groove Salad',
  url: 'http://ice1.somafm.com/groovesalad-128-mp3',
  codec: 'MP3',
  bitrate: 128,
  country: 'US'
}

export function Sidebar() {
  const playlists = useStore((s) => s.playlists)
  const library = useStore((s) => s.library)
  const view = useStore((s) => s.view)
  const scanning = useStore((s) => s.scanning)
  const { setView, createPlaylist, renamePlaylist, deletePlaylist, importFolder } =
    useStore.getState()

  const smart = useMemo(() => smartPlaylists(library), [library])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  // which sidebar sections are collapsed (local-only; defaults to all expanded)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const commitRename = () => {
    if (editingId && editName.trim()) renamePlaylist(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="sidebar">
      <div className="side-nav">
      <div className="side-section" onClick={() => toggleSection('library')}>
        <span className={`side-caret ${collapsed.has('library') ? 'collapsed' : ''}`}>▾</span>
        LIBRARY
      </div>
      {!collapsed.has('library') && (
        <>
          <div
            className={`side-item ${view.type === 'library' ? 'active' : ''}`}
            onClick={() => setView({ type: 'library' })}
          >
            <span className="side-icon">♫</span> All Music
          </div>
          <div
            className={`side-item ${view.type === 'duplicates' ? 'active' : ''}`}
            onClick={() => setView({ type: 'duplicates' })}
          >
            <span className="side-icon">⧉</span> Duplicates
          </div>
          {/* D1 SPIKE PLACEHOLDER — D3 turns this into the radio-browser dialog. */}
          <div
            className="side-item"
            onClick={() => useStore.getState().playStation(SPIKE_STATION)}
            title="D1 spike: play a test internet-radio stream"
          >
            <span className="side-icon">📻</span> Radio (test)
          </div>
        </>
      )}

      {smart.length > 0 && (
        <>
          <div className="side-section" onClick={() => toggleSection('smart')}>
            <span className={`side-caret ${collapsed.has('smart') ? 'collapsed' : ''}`}>▾</span>
            SMART
          </div>
          {!collapsed.has('smart') &&
            smart.map((sp) => (
            <div
              key={sp.id}
              className={`side-item ${
                view.type === 'smart' && view.id === sp.id ? 'active' : ''
              }`}
              onClick={() => setView({ type: 'smart', id: sp.id })}
            >
              <span className="side-icon">{sp.icon}</span>
              <span className="side-name">{sp.name}</span>
            </div>
          ))}
        </>
      )}

      <div className="side-section" onClick={() => toggleSection('playlists')}>
        <span className={`side-caret ${collapsed.has('playlists') ? 'collapsed' : ''}`}>▾</span>
        PLAYLISTS
        <button
          className="btn-add"
          title="New playlist"
          onClick={(e) => {
            e.stopPropagation()
            // make sure the new playlist is visible
            setCollapsed((prev) => {
              const next = new Set(prev)
              next.delete('playlists')
              return next
            })
            const n = playlists.length + 1
            createPlaylist(`Playlist ${n}`)
          }}
        >
          +
        </button>
      </div>
      {!collapsed.has('playlists') &&
        playlists.map((p) => (
        <div
          key={p.id}
          className={`side-item ${view.type === 'playlist' && view.id === p.id ? 'active' : ''} ${
            dropTarget === p.id ? 'drop-target' : ''
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDropTarget(p.id)
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => {
            e.preventDefault()
            setDropTarget(null)
            const paths = droppedPaths(e)
            if (paths.length) void useStore.getState().dropOnPlaylist(p.id, paths)
          }}
          onClick={() => setView({ type: 'playlist', id: p.id })}
          onDoubleClick={() => {
            setEditingId(p.id)
            setEditName(p.name)
          }}
        >
          <span className="side-icon">≡</span>
          {editingId === p.id ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="side-name">{p.name}</span>
          )}
          <button
            className="btn-delete"
            title="Delete playlist"
            onClick={(e) => {
              e.stopPropagation()
              setPendingDelete({ id: p.id, name: p.name })
            }}
          >
            ×
          </button>
        </div>
      ))}
      </div>

      <ArtPanel />

      <div className="side-footer">
        <button className="btn-import" onClick={() => void importFolder()} disabled={!!scanning}>
          {scanning
            ? scanning.total
              ? `Scanning ${scanning.done}/${scanning.total}…`
              : 'Scanning…'
            : '+ Import Folder'}
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete playlist?"
          message={
            <>
              Delete <strong>{pendingDelete.name}</strong>? The tracks stay in your library.
            </>
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deletePlaylist(pendingDelete.id)
            setPendingDelete(null)
          }}
        />
      )}
    </div>
  )
}
