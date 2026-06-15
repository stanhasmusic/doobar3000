import { useEffect, useState } from 'react'
import type { Track } from '../../../shared/types'
import { formatTime } from '../store'

const fmtSize = (bytes: number): string => {
  if (!bytes) return '—'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export function TrackInfoDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const [stat, setStat] = useState<{ exists: boolean; size: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.fileStat(track.path).then((s) => !cancelled && setStat(s))
    return () => {
      cancelled = true
    }
  }, [track.path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: [string, React.ReactNode][] = [
    ['Title', track.title || '—'],
    ['Artist', track.artist || '—'],
    ['Album', track.album || '—'],
    ['Album artist', track.albumArtist || '—'],
    ['Genre', track.genre || '—'],
    ['Year', track.year ?? '—'],
    ['Track #', track.trackNo ?? '—'],
    ['Duration', formatTime(track.duration)],
    ['Format', track.codec || track.fileType || '—'],
    ['Bitrate', track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : '—'],
    ['Sample rate', track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : '—'],
    ['Size', stat ? fmtSize(stat.size) : '…'],
    ['Loudness', track.lufs !== null ? `${track.lufs.toFixed(1)} LUFS` : 'not analyzed'],
    ['BPM', track.bpm ?? '—']
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-info" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Track info</div>
            <div className="modal-sub">{track.title || track.path}</div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <dl className="info-grid">
            {rows.map(([k, v]) => (
              <div className="info-row" key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div className="info-row info-path">
              <dt>Path</dt>
              <dd>
                <span className={stat && !stat.exists ? 'path-missing' : ''}>{track.path}</span>
                {stat && !stat.exists && ' (file not found)'}
              </dd>
            </div>
          </dl>
          <div className="modal-actions">
            <button
              className="btn-cancel"
              onClick={() => void navigator.clipboard.writeText(track.path)}
            >
              Copy path
            </button>
            <button
              className="btn-confirm"
              onClick={() => void window.api.revealInExplorer(track.path)}
            >
              Show in Explorer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
