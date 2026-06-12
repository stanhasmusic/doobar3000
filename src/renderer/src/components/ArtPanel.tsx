import { useEffect, useState } from 'react'
import { trackByPath, useStore } from '../store'

const cache = new Map<string, string | null>() // album key → data URL

export function ArtPanel() {
  const currentPath = useStore((s) => s.currentPath)
  const library = useStore((s) => s.library)
  const [art, setArt] = useState<string | null>(null)

  const track = trackByPath(library, currentPath)
  const albumKey = track ? `${track.albumArtist}|${track.album}` : null

  useEffect(() => {
    if (!track || !albumKey) {
      setArt(null)
      return
    }
    if (cache.has(albumKey)) {
      setArt(cache.get(albumKey)!)
      return
    }
    let cancelled = false
    void window.api.getArt(track.path).then((url) => {
      cache.set(albumKey, url)
      if (!cancelled) setArt(url)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumKey])

  if (!track) return null
  return (
    <div className="art-panel">
      {art ? (
        <img src={art} alt={track.album} draggable={false} />
      ) : (
        <div className="art-empty">♫</div>
      )}
    </div>
  )
}
