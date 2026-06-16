import { useEffect, useState } from 'react'
import type { IdentifyResult, TagCandidate, Track } from '../../../shared/types'
import { useStore } from '../store'

const ACOUSTID_REGISTER = 'https://acoustid.org/new-application'

export function IdentifyDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const acoustidKey = useStore((s) => s.acoustidKey)
  const [result, setResult] = useState<IdentifyResult | null>(null)
  const [applying, setApplying] = useState(false)
  // set after a single-track apply when other tracks share this album, to offer
  // pushing the album-level fields to the rest
  const [albumPrompt, setAlbumPrompt] = useState<{ candidate: TagCandidate; siblings: string[] } | null>(null)

  useEffect(() => {
    if (!acoustidKey) return
    let cancelled = false
    setResult(null)
    void window.api.identifyTrack(track.path, acoustidKey).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [track.path, acoustidKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const apply = async (c: TagCandidate) => {
    setApplying(true)
    // siblings = other tracks that currently share this track's album, captured
    // before the tag write changes this track's album value
    const siblings = useStore
      .getState()
      .library.filter(
        (t) =>
          t.path !== track.path && t.album === track.album && t.albumArtist === track.albumArtist
      )
      .map((t) => t.path)
    const library = await window.api.applyTags(track.path, c)
    if (!library) {
      useStore.getState().showNotice('Tagging failed — file left unchanged.')
      setApplying(false)
      return
    }
    useStore.setState({ library })
    // warm the shared cover art for the (possibly new) album key
    void window.api.fetchArt(c.albumArtist, c.album)
    if (siblings.length) {
      setApplying(false)
      setAlbumPrompt({ candidate: c, siblings })
    } else {
      useStore.getState().showNotice(`Tagged “${c.title}”`)
      onClose()
    }
  }

  const applyToAlbum = async () => {
    if (!albumPrompt) return
    setApplying(true)
    const { candidate: c, siblings } = albumPrompt
    const library = await window.api.applyAlbumTags(siblings, {
      album: c.album,
      albumArtist: c.albumArtist,
      year: c.year
    })
    if (library) useStore.setState({ library })
    useStore
      .getState()
      .showNotice(
        library ? `Updated ${siblings.length + 1} tracks on “${c.album}”` : 'Album update failed.'
      )
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Identify track</div>
            <div className="modal-sub">{track.title || track.path}</div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {albumPrompt ? (
          <div className="modal-body">
            <p className="modal-confirm">
              Tagged “{albumPrompt.candidate.title}”. {albumPrompt.siblings.length} other track
              {albumPrompt.siblings.length === 1 ? '' : 's'} share this album — also set their{' '}
              <b>album</b>, <b>artist</b>, and <b>year</b> to “{albumPrompt.candidate.album}” by{' '}
              {albumPrompt.candidate.albumArtist}? Each track keeps its own title and track number.
            </p>
            <div className="modal-actions">
              <button className="btn-cancel" disabled={applying} onClick={onClose}>
                Just this track
              </button>
              <button className="btn-confirm" disabled={applying} onClick={() => void applyToAlbum()}>
                {applying ? 'Updating…' : `Update ${albumPrompt.siblings.length} more`}
              </button>
            </div>
          </div>
        ) : !acoustidKey ? (
          <div className="modal-body">
            <p>
              Auto-tagging needs a free AcoustID application key. Get one (takes a minute),
              then paste it into the ⚙ settings menu.
            </p>
            <button
              className="btn-download"
              onClick={() => void window.api.openExternal(ACOUSTID_REGISTER)}
            >
              Get an AcoustID key
            </button>
          </div>
        ) : result === null ? (
          <div className="modal-body muted">Fingerprinting and searching…</div>
        ) : !result.ok ? (
          <div className="modal-body muted">{result.error}</div>
        ) : result.candidates.length === 0 ? (
          <div className="modal-body muted">
            <p>No match in the AcoustID database for this file.</p>
            <p>
              That usually means this exact recording hasn’t been fingerprinted by anyone
              yet — common for rare, live, remastered, or personal recordings — rather than a
              problem with your tags. A more widely-released version of the track may match.
            </p>
          </div>
        ) : (
          <div className="modal-body candidates">
            {result.candidates.map((c, i) => (
              <div className="candidate" key={i}>
                <div className="candidate-main">
                  <div className="candidate-title">{c.title}</div>
                  <div className="candidate-meta">
                    {c.artist} — {c.album}
                    {c.year ? ` (${c.year})` : ''}
                    {c.releaseGroupType ? ` · ${c.releaseGroupType}` : ''}
                  </div>
                </div>
                <div className="candidate-score">{Math.round(c.score * 100)}%</div>
                <button className="btn-apply" disabled={applying} onClick={() => void apply(c)}>
                  Apply
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
