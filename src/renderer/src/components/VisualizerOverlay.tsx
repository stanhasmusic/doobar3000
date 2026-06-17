import { useEffect, useRef, useState } from 'react'
import { ALL_VIZ_SCOPES, VIZ_SCOPE_LABELS, type VizScope } from '../../../shared/types'
import { audio } from '../audio'
import { useStore, vizColors } from '../store'

// Phase C — the expandable, nerd-gated visualizer overlay. Reuses the album-art
// lightbox pattern (full-window modal, Esc / click-out to close) and shows ONE big
// visualizer at a time, picked from a stage selector. Every scope reads the
// existing analyser taps (spectrum freq data; L/R time-domain from the VU
// analysers) — no new audio-graph nodes, so it fits the "stay in Web Audio"
// constraint. The rAF loop lives inside each scope component, which only mounts
// while the overlay is open, so nothing renders when it's closed.

// All scopes draw on a dark stage regardless of theme — visualizers read best on
// black and it keeps the persistence-fade math theme-independent.
const STAGE_BG = '#0b0b0e'
const LAST_SCOPE_KEY = 'vizScope' // remember the last-viewed scope across opens

// Shared canvas/rAF plumbing for a stage scope. DPR-correct sizing; `clear:false`
// lets a scope keep the previous frame (spectrogram scroll, goniometer trails).
function useStageCanvas(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { clear?: boolean; onResize?: (w: number, h: number) => void } = {}
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const canvas = ref.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        opts.onResize?.(w, h)
      }
      const g = canvas.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (opts.clear !== false) g.clearRect(0, 0, w, h)
      drawRef.current(g, w, h)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

// ── Spectrum ─────────────────────────────────────────────────────────────────
const BIG_BARS = 96
const F_MIN = 30
const F_MAX = 20000
const bigFreqFrac = (f: number): number => Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)
const SPEC_TICKS: { f: number; label: string }[] = [
  { f: 30, label: '30' },
  { f: 100, label: '100' },
  { f: 300, label: '300' },
  { f: 1000, label: '1k' },
  { f: 3000, label: '3k' },
  { f: 10000, label: '10k' }
]

function BigSpectrum(): React.ReactNode {
  const analyser = audio.spectrumAnalyser
  const data = useRef(new Uint8Array(analyser.frequencyBinCount))
  const peaks = useRef(new Float32Array(BIG_BARS)) // per-bar peak hold (0..1)

  const ref = useStageCanvas((g, w, h) => {
    analyser.getByteFrequencyData(data.current)
    const axis = 18
    const plotH = h - axis
    const binHz = audio.context.sampleRate / 2 / analyser.frequencyBinCount
    const barW = w / BIG_BARS

    // faint horizontal grid
    g.strokeStyle = vizColors.faint
    g.globalAlpha = 0.35
    g.beginPath()
    for (let i = 1; i < 4; i++) {
      const y = (plotH * i) / 4
      g.moveTo(0, y)
      g.lineTo(w, y)
    }
    g.stroke()
    g.globalAlpha = 1

    const grad = g.createLinearGradient(0, plotH, 0, 0)
    grad.addColorStop(0, vizColors.accentDark)
    grad.addColorStop(0.6, vizColors.accent)
    grad.addColorStop(1, vizColors.accentLight)

    for (let i = 0; i < BIG_BARS; i++) {
      const f0 = F_MIN * Math.pow(F_MAX / F_MIN, i / BIG_BARS)
      const f1 = F_MIN * Math.pow(F_MAX / F_MIN, (i + 1) / BIG_BARS)
      const b0 = Math.floor(f0 / binHz)
      const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz))
      let sum = 0
      for (let b = b0; b < b1; b++) sum += data.current[b] ?? 0
      const v = Math.pow(sum / (b1 - b0) / 255, 0.8)
      g.fillStyle = grad
      const bh = Math.max(1.5, v * plotH)
      g.fillRect(i * barW + 1, plotH - bh, barW - 2, bh)
      // peak-hold cap, slow decay
      const p = (peaks.current[i] = Math.max(v, peaks.current[i] - 0.006))
      g.fillStyle = vizColors.text
      g.fillRect(i * barW + 1, plotH - Math.max(2, p * plotH), barW - 2, 2)
    }

    g.font = '11px system-ui, sans-serif'
    g.textBaseline = 'bottom'
    g.fillStyle = vizColors.faint
    for (const { f, label } of SPEC_TICKS) {
      const x = bigFreqFrac(f) * w
      g.fillRect(x, plotH - 3, 1, 4)
      g.textAlign = f === SPEC_TICKS[0].f ? 'left' : f === 10000 ? 'right' : 'center'
      g.fillText(`${label} Hz`, Math.max(1, Math.min(w - 1, x)), h)
    }
  })
  return <canvas ref={ref} className="viz-stage-canvas" />
}

// ── Spectrogram ──────────────────────────────────────────────────────────────
// Scrolling time×freq waterfall. We keep an offscreen history canvas at a fixed
// internal resolution and, each frame, shift it left one column and paint the
// newest spectrum on the right, then blit (stretched) to the visible canvas.
// Resizing only changes the blit size, so the history survives a window resize.
const SG_COLS = 600 // ~time samples kept (one per frame ≈ 10 s at 60fps)
const SG_ROWS = 300 // freq resolution (log-mapped, top = high)

function buildPalette(): string[] {
  // black → accentDark → accent → accentLight → white, 256 steps
  const stops: [number, [number, number, number]][] = [
    [0, [11, 11, 14]],
    [0.35, toRgb(vizColors.accentDark)],
    [0.65, toRgb(vizColors.accent)],
    [0.85, toRgb(vizColors.accentLight)],
    [1, [255, 255, 255]]
  ]
  const out: string[] = []
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let a = stops[0]
    let b = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s]
        b = stops[s + 1]
        break
      }
    }
    const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
    const c = (j: number): number => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k)
    out.push(`rgb(${c(0)},${c(1)},${c(2)})`)
  }
  return out
}
function toRgb(s: string): [number, number, number] {
  const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/)
  if (!m) return [255, 255, 255]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function Spectrogram(): React.ReactNode {
  const analyser = audio.spectrumAnalyser
  const data = useRef(new Uint8Array(analyser.frequencyBinCount))
  const hist = useRef<HTMLCanvasElement | null>(null)
  const palette = useRef<string[]>([])

  if (!hist.current) {
    const c = document.createElement('canvas')
    c.width = SG_COLS
    c.height = SG_ROWS
    hist.current = c
    palette.current = buildPalette()
  }

  const ref = useStageCanvas(
    (g, w, h) => {
      analyser.getByteFrequencyData(data.current)
      const hg = hist.current!.getContext('2d')!
      // scroll the history one column to the left, then draw the newest column
      hg.globalCompositeOperation = 'copy'
      hg.drawImage(hist.current!, -1, 0)
      hg.globalCompositeOperation = 'source-over'
      const binHz = audio.context.sampleRate / 2 / analyser.frequencyBinCount
      const x = SG_COLS - 1
      for (let y = 0; y < SG_ROWS; y++) {
        // top row = high freq → log map
        const f = F_MIN * Math.pow(F_MAX / F_MIN, 1 - y / SG_ROWS)
        const bin = Math.min(data.current.length - 1, Math.round(f / binHz))
        hg.fillStyle = palette.current[data.current[bin] ?? 0]
        hg.fillRect(x, y, 1, 1)
      }
      // blit (stretched) to the visible stage
      const axis = 26
      const g0 = g as CanvasRenderingContext2D & { imageSmoothingEnabled: boolean }
      g0.imageSmoothingEnabled = true
      g.drawImage(hist.current!, 0, 0, SG_COLS, SG_ROWS, 0, 0, w, h - axis)

      // freq labels down the left edge + a "now" marker on the right
      g.font = '11px system-ui, sans-serif'
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      g.fillStyle = vizColors.text
      for (const { f, label } of SPEC_TICKS) {
        const y = (1 - bigFreqFrac(f)) * (h - axis)
        g.fillStyle = 'rgba(0,0,0,0.45)'
        g.fillRect(0, y - 7, 34, 14)
        g.fillStyle = vizColors.text
        g.fillText(`${label}`, 3, y)
      }
      g.fillStyle = vizColors.faint
      g.textBaseline = 'bottom'
      g.textAlign = 'left'
      g.fillText('older', 2, h)
      g.textAlign = 'right'
      g.fillText('now ▸', w - 2, h)
    },
    {
      clear: false,
      onResize: () => {
        palette.current = buildPalette()
      }
    }
  )
  return <canvas ref={ref} className="viz-stage-canvas" />
}

// ── Oscilloscope ─────────────────────────────────────────────────────────────
function Oscilloscope(): React.ReactNode {
  const [aL, aR] = audio.vuAnalysers
  const bufL = useRef(new Float32Array(aL.fftSize))
  const bufR = useRef(new Float32Array(aR.fftSize))

  const ref = useStageCanvas((g, w, h) => {
    const mid = h / 2
    // center line + faint grid
    g.strokeStyle = vizColors.faint
    g.globalAlpha = 0.4
    g.beginPath()
    g.moveTo(0, mid)
    g.lineTo(w, mid)
    g.stroke()
    g.globalAlpha = 1

    const drawTrace = (buf: Float32Array, color: string, alpha: number): void => {
      const n = buf.length
      g.strokeStyle = color
      g.globalAlpha = alpha
      g.lineWidth = 2
      g.lineJoin = 'round'
      g.beginPath()
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w
        const y = mid - buf[i] * mid * 0.95
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
      g.globalAlpha = 1
    }

    aR.getFloatTimeDomainData(bufR.current)
    aL.getFloatTimeDomainData(bufL.current)
    drawTrace(bufR.current, vizColors.accentLight, 0.5) // R behind, lighter
    drawTrace(bufL.current, vizColors.accent, 1) // L in front

    g.font = '11px system-ui, sans-serif'
    g.fillStyle = vizColors.faint
    g.textBaseline = 'top'
    g.textAlign = 'left'
    g.fillText('L / R waveform', 4, 4)
  })
  return <canvas ref={ref} className="viz-stage-canvas" />
}

// ── Goniometer (vectorscope) ─────────────────────────────────────────────────
// Lissajous of L vs R, rotated 45° so a mono signal sits on the vertical (mid)
// axis and stereo width spreads horizontally (side). Trails persist with a slow
// fade for the classic "glowing blob" look.
function Goniometer(): React.ReactNode {
  const [aL, aR] = audio.vuAnalysers
  const bufL = useRef(new Float32Array(aL.fftSize))
  const bufR = useRef(new Float32Array(aR.fftSize))

  const ref = useStageCanvas(
    (g, w, h) => {
      // fade the previous frame toward the stage background
      g.fillStyle = 'rgba(11,11,14,0.22)'
      g.fillRect(0, 0, w, h)

      const cx = w / 2
      const cy = h / 2
      const scale = Math.min(w, h) * 0.46

      // reference axes: vertical = mono (M), horizontal = side (S)
      g.strokeStyle = vizColors.faint
      g.globalAlpha = 0.5
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(cx, cy - scale)
      g.lineTo(cx, cy + scale)
      g.moveTo(cx - scale, cy)
      g.lineTo(cx + scale, cy)
      g.stroke()
      g.globalAlpha = 1
      g.font = '11px system-ui, sans-serif'
      g.fillStyle = vizColors.faint
      g.textAlign = 'center'
      g.textBaseline = 'bottom'
      g.fillText('M', cx, cy - scale)
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      g.fillText('+S', cx + scale - 14, cy - 8)

      aL.getFloatTimeDomainData(bufL.current)
      aR.getFloatTimeDomainData(bufR.current)
      const n = bufL.current.length
      g.fillStyle = vizColors.accent
      g.globalAlpha = 0.85
      for (let i = 0; i < n; i++) {
        const l = bufL.current[i]
        const r = bufR.current[i]
        const x = (l - r) * Math.SQRT1_2
        const y = (l + r) * Math.SQRT1_2
        g.fillRect(cx + x * scale, cy - y * scale, 1.6, 1.6)
      }
      g.globalAlpha = 1
    },
    { clear: false }
  )
  return <canvas ref={ref} className="viz-stage-canvas" />
}

const SCOPES: Record<VizScope, () => React.ReactNode> = {
  spectrum: BigSpectrum,
  spectrogram: Spectrogram,
  oscilloscope: Oscilloscope,
  goniometer: Goniometer
}

export function VisualizerOverlay({ onClose }: { onClose: () => void }): React.ReactNode {
  const enabled = useStore((s) => s.visualizers)
  // available scopes in canonical order, filtered to the user's enabled set
  const available = ALL_VIZ_SCOPES.filter((s) => enabled.includes(s))

  const [scope, setScope] = useState<VizScope>(() => {
    const saved = localStorage.getItem(LAST_SCOPE_KEY) as VizScope | null
    return saved && ALL_VIZ_SCOPES.includes(saved) ? saved : 'spectrum'
  })
  // keep the active scope valid as the enabled set changes
  const active = available.includes(scope) ? scope : available[0]

  const select = (s: VizScope): void => {
    setScope(s)
    localStorage.setItem(LAST_SCOPE_KEY, s)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const Scope = active ? SCOPES[active] : null

  return (
    <div className="viz-overlay" onMouseDown={onClose}>
      <div
        className="viz-overlay-inner"
        style={{ background: STAGE_BG }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="viz-overlay-head">
          <div className="viz-tabs">
            {available.map((s) => (
              <button
                key={s}
                className={s === active ? 'on' : ''}
                onClick={() => select(s)}
              >
                {VIZ_SCOPE_LABELS[s]}
              </button>
            ))}
          </div>
          <button className="viz-overlay-close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
        <div className="viz-stage">
          {Scope ? (
            <Scope />
          ) : (
            <div className="viz-empty">
              No visualizers enabled — turn some on in Settings → Display → Visualizers.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
