import { useEffect, useState } from 'react'
import { trackByPath, useStore } from '../store'

const cache = new Map<string, string | null>() // album key → data URL

export function ArtPanel() {
  const currentPath = useStore((s) => s.currentPath)
  const library = useStore((s) => s.library)
  const [art, setArt] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

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
    setArt(null)
    // embedded art (or the fetch cache) first; if nothing, try fetching online
    void window.api.getArt(track.path, albumKey).then(async (url) => {
      let result = url
      if (!result && track.albumArtist && track.album) {
        result = await window.api.fetchArt(track.albumArtist, track.album)
      }
      cache.set(albumKey, result)
      if (!cancelled) setArt(result)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumKey])

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const chooseArt = async (): Promise<void> => {
    if (!albumKey) return
    const url = await window.api.setArt(albumKey)
    if (url) {
      cache.set(albumKey, url)
      setArt(url)
    }
  }

  const removeArt = async (): Promise<void> => {
    if (!albumKey) return
    await window.api.clearArt(albumKey)
    cache.delete(albumKey)
    // re-resolve: embedded art (if any) survives a cache clear
    const embedded = await window.api.getArt(track!.path, albumKey)
    cache.set(albumKey, embedded)
    setArt(embedded)
  }

  if (!track) return null
  return (
    <>
      <div
        className={`art-panel ${art ? 'zoomable' : ''}`}
        onClick={() => art && setZoom(true)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={art ? 'Click to enlarge · right-click for options' : 'Right-click to set art'}
      >
        {art ? (
          <img src={art} alt={track.album} draggable={false} />
        ) : (
          <div className="art-empty">♫</div>
        )}
      </div>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="menu-item" onClick={() => void chooseArt()}>
            Set album art…
          </div>
          {art && (
            <div className="menu-item" onClick={() => void removeArt()}>
              Clear album art
            </div>
          )}
        </div>
      )}
      {zoom && art && (
        <div className="art-lightbox" onClick={() => setZoom(false)}>
          <img src={art} alt={track.album} draggable={false} />
          <div className="art-lightbox-caption">
            {track.album} — {track.albumArtist || track.artist}
          </div>
        </div>
      )}
    </>
  )
}
