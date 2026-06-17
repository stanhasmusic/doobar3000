import { useEffect, useState } from 'react'
import {
  ALL_VIZ_SCOPES,
  VIZ_SCOPE_LABELS,
  type LevelMode,
  type Theme,
  type VizScope
} from '../../../shared/types'
import { audio } from '../audio'
import { formatRate, trackByPath, useStore } from '../store'

const MODES: { value: LevelMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'track', label: 'Track' },
  { value: 'album', label: 'Album' }
]

// bg/accent here are just the swatch preview; the real palettes live in styles.css
const THEMES: { value: Theme; label: string; bg: string; accent: string }[] = [
  { value: 'dark', label: 'Dark', bg: '#141417', accent: '#e0556e' },
  { value: 'light', label: 'Light', bg: '#f3f3f6', accent: '#d6315a' },
  { value: 'midnight', label: 'Midnight', bg: '#0d1117', accent: '#2fa6b8' },
  { value: 'sepia', label: 'Sepia', bg: '#efe7d6', accent: '#a3592a' },
  { value: 'custom', label: 'Custom', bg: '#141417', accent: '#e0556e' }
]

// The settings tree. Two levels max: top-level nodes, each with optional sub-tabs.
// `nerd: true` nodes/subs only appear when nerd mode is on. New panels (Output,
// Visualizers) slot in here as later phases build them — the shell doesn't change.
type NodeId = 'general' | 'display' | 'playback' | 'library' | 'advanced'
interface TreeNode {
  id: NodeId
  label: string
  nerd?: boolean
  subs?: { id: string; label: string; nerd?: boolean }[]
}
const TREE: TreeNode[] = [
  { id: 'general', label: 'General' },
  {
    id: 'display',
    label: 'Display',
    subs: [
      { id: 'colors', label: 'Colors' },
      { id: 'visualizers', label: 'Visualizers', nerd: true }
    ]
  },
  {
    id: 'playback',
    label: 'Playback',
    subs: [
      { id: 'output', label: 'Output' },
      { id: 'leveling', label: 'Leveling' }
    ]
  },
  { id: 'library', label: 'Library & Tagging' },
  { id: 'advanced', label: 'Advanced', nerd: true }
]

const LAST_NODE_KEY = 'settingsNode' // remember where the dialog was last open

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const nerdMode = useStore((s) => s.nerdMode)

  const visibleNodes = TREE.filter((n) => !n.nerd || nerdMode)
  const [nodeId, setNodeId] = useState<NodeId>(() => {
    const saved = localStorage.getItem(LAST_NODE_KEY) as NodeId | null
    return saved && TREE.some((n) => n.id === saved) ? saved : 'general'
  })
  // a hidden (nerd) node can be selected then nerd mode turned off — fall back
  const node = visibleNodes.find((n) => n.id === nodeId) ?? visibleNodes[0]
  const subs = (node.subs ?? []).filter((s) => !s.nerd || nerdMode)
  const [subId, setSubId] = useState<string>(subs[0]?.id ?? '')

  const selectNode = (id: NodeId): void => {
    setNodeId(id)
    localStorage.setItem(LAST_NODE_KEY, id)
    const first = TREE.find((n) => n.id === id)?.subs?.find((s) => !s.nerd || nerdMode)
    setSubId(first?.id ?? '')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Settings</div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-tree">
          <nav className="st-nav">
            {visibleNodes.map((n) => (
              <button
                key={n.id}
                className={n.id === node.id ? 'on' : ''}
                onClick={() => selectNode(n.id)}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <div className="st-pane">
            {subs.length > 1 && (
              <div className="st-subtabs">
                {subs.map((s) => (
                  <button
                    key={s.id}
                    className={s.id === subId ? 'on' : ''}
                    onClick={() => setSubId(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <div className="st-content">
              <NodeContent nodeId={node.id} subId={subId} onClose={onClose} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NodeContent({
  nodeId,
  subId,
  onClose
}: {
  nodeId: NodeId
  subId: string
  onClose: () => void
}): React.ReactNode {
  switch (nodeId) {
    case 'general':
      return <GeneralPanel onClose={onClose} />
    case 'display':
      return subId === 'visualizers' ? <VisualizersPanel /> : <ColorsPanel />
    case 'playback':
      return subId === 'leveling' ? <LevelingPanel /> : <OutputPanel />
    case 'library':
      return <LibraryPanel />
    case 'advanced':
      return (
        <p className="set-hint">
          Advanced diagnostics will appear here as Nerd Mode features land. Output and format
          details live under Playback → Output; the expandable visualizer overlay is under
          Display → Visualizers (and opens from the top-bar viz widget).
        </p>
      )
  }
}

function GeneralPanel({ onClose }: { onClose: () => void }): React.ReactNode {
  const nerdMode = useStore((s) => s.nerdMode)
  const { setNerdMode, replayWelcome } = useStore.getState()
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  return (
    <>
      <div className="set-title">Nerd mode</div>
      <div className="seg">
        <button className={!nerdMode ? 'seg-on' : ''} onClick={() => setNerdMode(false)}>
          Off
        </button>
        <button className={nerdMode ? 'seg-on' : ''} onClick={() => setNerdMode(true)}>
          On
        </button>
      </div>
      <div className="set-hint">
        Layers extra technical readouts onto the player and unlocks advanced settings. The
        normal layout is unchanged.
      </div>

      <div className="set-title">Welcome guide</div>
      <button className="st-btn" onClick={() => (replayWelcome(), onClose())}>
        Show welcome guide
      </button>

      <div className="set-title">About</div>
      <div className="set-hint">
        Doobar 3000{version ? ` · v${version}` : ''}
        <br />A native Windows music player — iTunes-simple, foobar2000-powerful.
      </div>
    </>
  )
}

function ColorsPanel(): React.ReactNode {
  const theme = useStore((s) => s.theme)
  const accentColor = useStore((s) => s.accentColor)
  const { setTheme, setAccentColor } = useStore.getState()
  return (
    <>
      <div className="set-title">Color scheme</div>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.value}
            className={`theme-swatch ${theme === t.value ? 'on' : ''}`}
            title={t.label}
            style={{ background: t.bg }}
            onClick={() => setTheme(t.value)}
          >
            <span
              className="theme-dot"
              style={{ background: t.value === 'custom' ? accentColor || t.accent : t.accent }}
            />
            {t.label}
          </button>
        ))}
      </div>
      {theme === 'custom' && (
        <div className="set-row custom-color">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#e0556e'}
            onChange={(e) => setAccentColor(e.target.value)}
          />
          <input
            className="set-input"
            type="text"
            placeholder="#e0556e"
            value={accentColor}
            spellCheck={false}
            onChange={(e) => setAccentColor(e.target.value.trim())}
          />
        </div>
      )}
      <div className="set-hint">
        {theme === 'custom'
          ? 'Custom uses the dark base with your accent color — pick from the wheel or type a hex code.'
          : 'Light, dark, and a couple of modern/classic palettes.'}
      </div>
    </>
  )
}

const VIZ_DESCRIPTIONS: Record<VizScope, string> = {
  spectrum: 'Big log-frequency bar spectrum with peak-hold.',
  spectrogram: 'Scrolling time × frequency waterfall.',
  oscilloscope: 'L/R waveform (time-domain) trace.',
  goniometer: 'Vectorscope — stereo width & phase (mono sits vertical).'
}

function VisualizersPanel(): React.ReactNode {
  const enabled = useStore((s) => s.visualizers)
  const { setVisualizers } = useStore.getState()

  const toggle = (scope: VizScope, on: boolean): void => {
    const next = ALL_VIZ_SCOPES.filter((s) => (s === scope ? on : enabled.includes(s)))
    setVisualizers(next)
  }

  return (
    <>
      <div className="set-title">Overlay visualizers</div>
      <div className="viz-toggle-list">
        {ALL_VIZ_SCOPES.map((scope) => {
          const on = enabled.includes(scope)
          return (
            <label key={scope} className="viz-toggle">
              <input
                type="checkbox"
                checked={on}
                // keep at least one enabled so the overlay always has something
                disabled={on && enabled.length === 1}
                onChange={(e) => toggle(scope, e.target.checked)}
              />
              <span className="viz-toggle-text">
                <span className="viz-toggle-name">{VIZ_SCOPE_LABELS[scope]}</span>
                <span className="viz-toggle-desc">{VIZ_DESCRIPTIONS[scope]}</span>
              </span>
            </label>
          )
        })}
      </div>
      <div className="set-hint">
        Pick which scopes the expandable visualizer overlay offers. Open it by clicking the
        spectrum/VU widget in the top bar (nerd mode).
      </div>
    </>
  )
}

function OutputPanel(): React.ReactNode {
  const outputDeviceId = useStore((s) => s.outputDeviceId)
  const nerdMode = useStore((s) => s.nerdMode)
  const currentPath = useStore((s) => s.currentPath)
  const library = useStore((s) => s.library)
  const { setOutputDevice } = useStore.getState()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  // Enumerate output devices and keep the list fresh as hardware comes/goes.
  // (Labels can be blank until the app has media permission — we fall back to a
  // generic name so the picker is still usable.)
  useEffect(() => {
    const load = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setDevices(d.filter((x) => x.kind === 'audiooutput')))
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  const track = trackByPath(library, currentPath)
  const mix = audio.mixFormat()
  const resampled = track?.sampleRate != null && track.sampleRate !== mix.sampleRate
  const srcRate = track?.sampleRate ? formatRate(track.sampleRate) : '—'
  const srcDesc = track
    ? [
        (track.codec || track.fileType || '').toUpperCase() || '—',
        track.sampleRate ? `${srcRate}${track.bitsPerSample ? `/${track.bitsPerSample}` : ''}` : '',
        track.bitrate ? `${track.bitrate} kbps` : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : 'nothing playing'

  return (
    <>
      <div className="set-title">Output device</div>
      <select
        className="set-input"
        value={outputDeviceId}
        onChange={(e) => void setOutputDevice(e.target.value)}
      >
        <option value="">System default</option>
        {devices
          .filter((d) => d.deviceId && d.deviceId !== 'default')
          .map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Output ${i + 1}`}
            </option>
          ))}
      </select>
      <div className="set-hint">
        Routes playback (and the visualizers) to this device. Output is{' '}
        <strong>WASAPI (Shared)</strong> — exclusive / bit-perfect output needs a native audio
        engine and isn&apos;t supported.
      </div>

      {nerdMode && (
        <>
          <div className="set-title">Signal path</div>
          <div className="nerd-readout">
            <div>
              <span>Source</span>
              <span>{srcDesc}</span>
            </div>
            <div>
              <span>Mix</span>
              <span>
                {formatRate(mix.sampleRate)} · {mix.channels} ch · WASAPI shared
              </span>
            </div>
            <div>
              <span>Resampling</span>
              <span>
                {resampled
                  ? `yes — ${srcRate} → ${formatRate(mix.sampleRate)}`
                  : track?.sampleRate
                    ? 'no (source matches mix)'
                    : '—'}
              </span>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function LevelingPanel(): React.ReactNode {
  const levelMode = useStore((s) => s.levelMode)
  const library = useStore((s) => s.library)
  const lufsProgress = useStore((s) => s.lufsProgress)
  const ffmpeg = useStore((s) => s.ffmpeg)
  const { setLevelMode } = useStore.getState()
  const analyzed = library.filter((t) => t.lufs !== null).length
  return (
    <>
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
        EBU R128 loudness leveling. Album mode keeps an album&apos;s internal dynamics.
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
    </>
  )
}

function LibraryPanel(): React.ReactNode {
  const ffmpeg = useStore((s) => s.ffmpeg)
  const ffmpegProgress = useStore((s) => s.ffmpegProgress)
  const acoustidKey = useStore((s) => s.acoustidKey)
  const fpcalcFound = useStore((s) => s.fpcalcFound)
  const fpcalcInstalling = useStore((s) => s.fpcalcInstalling)
  const { downloadFfmpeg, setAcoustidKey, downloadFpcalc } = useStore.getState()
  const downloading = ffmpegProgress !== null
  return (
    <>
      <div className="set-title">Decoder pack (ffmpeg)</div>
      <div className="set-hint">
        {ffmpeg?.found
          ? `Installed (${ffmpeg.source === 'path' ? 'system' : 'app'}). Plays ALAC, APE, WMA and more; powers loudness analysis.`
          : 'Not installed. Needed for ALAC/APE/WMA playback and loudness analysis. One-time ~80 MB download.'}
      </div>
      {!ffmpeg?.found && (
        <button className="btn-download" disabled={downloading} onClick={() => void downloadFfmpeg()}>
          {downloading ? `Downloading… ${ffmpegProgress}%` : 'Download decoder pack'}
        </button>
      )}

      <div className="set-title">Auto-tagging (AcoustID)</div>
      <div className="set-hint">
        Identifies tracks by audio fingerprint and fills in tags from MusicBrainz. Paste a free
        application key from{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            void window.api.openExternal('https://acoustid.org/new-application')
          }}
        >
          acoustid.org
        </a>
        .
      </div>
      <input
        className="set-input"
        type="text"
        placeholder="AcoustID application key"
        value={acoustidKey}
        spellCheck={false}
        onChange={(e) => setAcoustidKey(e.target.value.trim())}
      />
      <div className="set-hint">
        Fingerprinter (fpcalc):{' '}
        {fpcalcFound ? 'installed.' : 'not installed — required to identify tracks.'}
      </div>
      {!fpcalcFound && (
        <button
          className="btn-download"
          disabled={fpcalcInstalling}
          onClick={() => void downloadFpcalc()}
        >
          {fpcalcInstalling ? 'Installing…' : 'Install fingerprinter (~1.5 MB)'}
        </button>
      )}
    </>
  )
}
