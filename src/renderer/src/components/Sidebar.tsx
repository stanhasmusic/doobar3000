import { useState } from 'react'
import { useStore } from '../store'
import { ArtPanel } from './ArtPanel'

export function droppedPaths(e: React.DragEvent): string[] {
  return Array.from(e.dataTransfer.files)
    .map((f) => window.api.getPathForFile(f))
    .filter(Boolean)
}

export function Sidebar() {
  const playlists = useStore((s) => s.playlists)
  const view = useStore((s) => s.view)
  const scanning = useStore((s) => s.scanning)
  const { setView, createPlaylist, renamePlaylist, deletePlaylist, importFolder } =
    useStore.getState()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const commitRename = () => {
    if (editingId && editName.trim()) renamePlaylist(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="sidebar">
      <div className="side-section">LIBRARY</div>
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

      <div className="side-section">
        PLAYLISTS
        <button
          className="btn-add"
          title="New playlist"
          onClick={() => {
            const n = playlists.length + 1
            createPlaylist(`Playlist ${n}`)
          }}
        >
          +
        </button>
      </div>
      {playlists.map((p) => (
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
              deletePlaylist(p.id)
            }}
          >
            ×
          </button>
        </div>
      ))}

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
    </div>
  )
}
