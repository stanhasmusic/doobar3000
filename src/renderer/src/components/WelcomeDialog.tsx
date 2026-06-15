import { useEffect } from 'react'
import { useStore } from '../store'

// First-run alpha guide. Shows once (gated on the persisted `seenWelcome` setting)
// to orient a new tester: what works out of the box, what needs the one-click
// decoder download, the unsigned-build SmartScreen note, and where to send bugs.
export function WelcomeDialog() {
  const dismissWelcome = useStore((s) => s.dismissWelcome)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') dismissWelcome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismissWelcome])

  return (
    <div className="modal-backdrop" onClick={dismissWelcome}>
      <div className="modal modal-welcome" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-head">
          <svg className="welcome-mark" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="20" fill="#141418" />
            <circle cx="22" cy="22" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <circle cx="22" cy="22" r="12" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <circle cx="22" cy="22" r="6" fill="var(--accent)" />
            <circle cx="22" cy="22" r="1.6" fill="#141418" />
          </svg>
          <div>
            <div className="modal-title">Welcome to Doobar 3000</div>
            <div className="welcome-sub">Alpha build — thanks for testing!</div>
          </div>
        </div>
        <div className="modal-body welcome-body">
          <p>
            A native Windows music player: iTunes-simple, foobar2000-powerful. Here&apos;s the
            quick start.
          </p>
          <ul>
            <li>
              <b>Add your music</b> — click the import button (or drag a folder of music straight
              onto the track list). Your library is saved between launches.
            </li>
            <li>
              <b>Plays most formats right away</b> — mp3, flac, m4a/aac, ogg, opus, wav. For ALAC,
              APE, WMA and friends, open <b>⚙ settings</b> and grab the one-click decoder pack
              (~80&nbsp;MB, downloads once).
            </li>
            <li>
              <b>Explore ⚙ settings</b> — color themes, loudness auto-leveling, customizable
              columns, and an optional AcoustID key for auto-tagging.
            </li>
            <li>
              <b>This is an early build</b> — expect rough edges. If Windows shows a{' '}
              <i>“Windows protected your PC”</i> warning on first launch, that&apos;s just because
              the app isn&apos;t code-signed yet: click <b>More info → Run anyway</b>.
            </li>
            <li>
              <b>Found a bug or have a thought?</b> Jot down what you did and what happened — every
              note helps.
            </li>
          </ul>
        </div>
        <div className="modal-actions">
          <button className="btn-confirm" autoFocus onClick={dismissWelcome}>
            Let&apos;s go
          </button>
        </div>
      </div>
    </div>
  )
}
