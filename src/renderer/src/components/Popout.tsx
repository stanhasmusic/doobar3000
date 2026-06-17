import { useEffect, useState } from 'react'
import { ALL_VIZ_SCOPES, VIZ_SCOPE_LABELS, type VizScope } from '../../../shared/types'
import { applyThemeColors } from '../vizColors'
import { VizCanvas, type VizSource } from './VizScopes'

// A floating pop-out visualizer window. It has no audio of its own — it renders
// from analyser frames the main window ships over IPC (see liveSource's feed
// bridge + main process broadcast). Frameless + always-on-top; the header strip is
// the window drag region.

// Analyser config mirrors audio.ts (spectrum fftSize 4096 → 2048 bins; VU 1024).
const FREQ_BINS = 2048
const FFT = 1024

// Latest frame, updated from IPC. The draw code copies out of these each tick.
// Bare typed-array types (ArrayBufferLike) so IPC-received frames assign cleanly.
const latest: { freq: Uint8Array; timeL: Float32Array; timeR: Float32Array; sampleRate: number } = {
  freq: new Uint8Array(FREQ_BINS),
  timeL: new Float32Array(FFT),
  timeR: new Float32Array(FFT),
  sampleRate: 48000
}

const ipcSource: VizSource = {
  getFrequencyData: (o) => o.set(latest.freq.subarray(0, o.length)),
  getTimeDomainData: (ch, o) => o.set((ch === 0 ? latest.timeL : latest.timeR).subarray(0, o.length)),
  get sampleRate() {
    return latest.sampleRate
  },
  freqBinCount: FREQ_BINS,
  fftSize: FFT
}

export function Popout({ initialScope }: { initialScope: VizScope }): React.ReactNode {
  const [scope, setScope] = useState<VizScope>(initialScope)
  const [enabled, setEnabled] = useState<VizScope[]>(ALL_VIZ_SCOPES)
  const [title, setTitle] = useState('')

  // Match the main app's theme (and refresh the canvas color snapshot for it).
  useEffect(() => {
    void window.api.getSettings().then((s) => {
      applyThemeColors(s.theme ?? 'dark', s.accentColor || '#e0556e')
      if (s.visualizers?.length) setEnabled(s.visualizers)
    })
  }, [])

  // Receive analyser frames: feed the draw buffers + track the now-playing title
  // (setTitle bails out when unchanged, so it only re-renders the header on track changes).
  useEffect(() => {
    window.api.onVizFrame((f) => {
      latest.freq = f.freq
      latest.timeL = f.timeL
      latest.timeR = f.timeR
      latest.sampleRate = f.sampleRate
      setTitle(f.title)
    })
  }, [])

  const available = ALL_VIZ_SCOPES.filter((s) => enabled.includes(s))
  const active = available.includes(scope) ? scope : (available[0] ?? scope)

  return (
    <div className="popout">
      <div className="popout-head">
        <select
          className="viz-panel-select popout-select"
          value={active}
          onChange={(e) => setScope(e.target.value as VizScope)}
        >
          {available.map((s) => (
            <option key={s} value={s}>
              {VIZ_SCOPE_LABELS[s]}
            </option>
          ))}
        </select>
        {/* the flexible grab strip (also the now-playing label) — the rest of the
            frameless window's drag region */}
        <div className="popout-drag" title="Drag to move">
          <span className="popout-title">{title || 'Doobar 3000'}</span>
        </div>
        <button className="viz-panel-btn" onClick={() => window.close()} title="Close">
          ×
        </button>
      </div>
      <div className="popout-stage">
        <VizCanvas key={active} scope={active} source={ipcSource} />
      </div>
    </div>
  )
}
