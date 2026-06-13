import { useMemo } from 'react'
import { duplicateGroups, formatTime, useStore } from '../store'

// Groups of likely-duplicate tracks (same title+artist, near-equal duration).
// Each row shows the distinguishing details so the user can pick which to drop.
export function DuplicatesView() {
  const library = useStore((s) => s.library)
  const currentPath = useStore((s) => s.currentPath)
  const { playQueue, removeFromLibrary } = useStore.getState()

  const groups = useMemo(() => duplicateGroups(library), [library])

  if (!groups.length) {
    return (
      <div className="tracklist empty-state">
        <div>
          <h2>No duplicates found</h2>
          <p>Tracks with the same title and artist and near-identical length show up here.</p>
        </div>
      </div>
    )
  }

  const total = groups.reduce((n, g) => n + g.length, 0)

  return (
    <div className="tracklist">
      <div className="dupes-body">
        {groups.map((group, gi) => (
          <div className="dupe-group" key={gi}>
            <div className="dupe-group-head">
              {group[0].artist} — {group[0].title}
            </div>
            {group.map((t) => (
              <div className="dupe-row" key={t.path}>
                <div className="dupe-main">
                  <div className="dupe-album">
                    {t.album}
                    {t.year ? ` (${t.year})` : ''}
                    {t.path === currentPath ? ' · ♪ now playing' : ''}
                  </div>
                  <div className="dupe-path" title={t.path}>
                    {t.path}
                  </div>
                </div>
                <div className="dupe-tech">
                  {[
                    t.fileType?.toUpperCase(),
                    t.bitrate ? `${t.bitrate} kbps` : null,
                    formatTime(t.duration)
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <button className="dupe-btn" onClick={() => playQueue([t.path], 0)}>
                  Play
                </button>
                <button
                  className="dupe-btn danger"
                  onClick={() => void removeFromLibrary([t.path])}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="status-bar">
        {groups.length} duplicate group{groups.length === 1 ? '' : 's'} · {total} tracks
      </div>
    </div>
  )
}
