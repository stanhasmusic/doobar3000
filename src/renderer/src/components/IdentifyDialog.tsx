import { useEffect, useState } from 'react'
import type { IdentifyResult, TagCandidate, Track } from '../../../shared/types'
import { useStore } from '../store'

const ACOUSTID_REGISTER = 'https://acoustid.org/new-application'

export function IdentifyDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const acoustidKey = useStore((s) => s.acoustidKey)
  const [result, setResult] = useState<IdentifyResult | null>(null)
  const [applying, setApplying] = useState(false)

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
    const library = await window.api.applyTags(track.path, c)
    if (library) {
      useStore.setState({ library })
      useStore.getState().showNotice(`Tagged “${c.title}”`)
      onClose()
    } else {
      useStore.getState().showNotice('Tagging failed — file left unchanged.')
      setApplying(false)
    }
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

        {!acoustidKey ? (
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
