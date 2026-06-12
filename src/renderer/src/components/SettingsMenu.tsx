import { useEffect, useRef, useState } from 'react'
import type { LevelMode } from '../../../shared/types'
import { useStore } from '../store'

const MODES: { value: LevelMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'track', label: 'Track' },
  { value: 'album', label: 'Album' }
]

export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const levelMode = useStore((s) => s.levelMode)
  const ffmpeg = useStore((s) => s.ffmpeg)
  const ffmpegProgress = useStore((s) => s.ffmpegProgress)
  const library = useStore((s) => s.library)
  const lufsProgress = useStore((s) => s.lufsProgress)
  const { setLevelMode, downloadFfmpeg } = useStore.getState()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const analyzed = library.filter((t) => t.lufs !== null).length
  const downloading = ffmpegProgress !== null

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button className="btn-icon" title="Settings" onClick={() => setOpen(!open)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.7L4.5 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.7l2 3.4c.1.2.4.3.6.2l2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.7a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.7a7.6 7.6 0 0 0 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.7L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
        </svg>
      </button>
      {open && (
        <div className="settings-pop">
          <div className="set-title">Auto-level volume</div>
          <div className="set-row seg">
            {MODES.map((m) => (
              <button
                key={m.value}
                className={levelMode === m.value ? 'seg-on' : ''}
                onClick={() => setLevelMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="set-hint">
            EBU R128 loudness leveling. Album mode keeps an album's internal dynamics.
            {library.length > 0 && (
              <>
                {' '}
                {lufsProgress
                  ? `Analyzing… ${lufsProgress.done}/${lufsProgress.total}`
                  : `${analyzed}/${library.length} tracks analyzed.`}
                {!ffmpeg?.found && ' Requires the decoder pack.'}
              </>
            )}
          </div>

          <div className="set-title">Decoder pack (ffmpeg)</div>
          <div className="set-hint">
            {ffmpeg?.found
              ? `Installed (${ffmpeg.source === 'path' ? 'system' : 'app'}). Plays ALAC, APE, WMA and more; powers loudness analysis.`
              : 'Not installed. Needed for ALAC/APE/WMA playback and loudness analysis. One-time ~80 MB download.'}
          </div>
          {!ffmpeg?.found && (
            <button
              className="btn-download"
              disabled={downloading}
              onClick={() => void downloadFfmpeg()}
            >
              {downloading ? `Downloading… ${ffmpegProgress}%` : 'Download decoder pack'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
