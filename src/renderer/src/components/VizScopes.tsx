import { useEffect, useRef } from 'react'
import { type VizScope } from '../../../shared/types'
import { vizColors } from '../vizColors'
import { pickFreqTicks } from '../vizTicks'

// Shared visualizer rendering for Phase C. The four scopes are pure draw
// functions over a `VizSource` — an abstraction of the analyser taps — so the
// same code drives both the in-app docked panel (fed by the live analysers; see
// liveSource.ts) and the floating pop-out windows (fed analyser frames over IPC;
// see the pop-out renderer). No new audio-graph nodes anywhere. This module
// deliberately avoids importing `audio`/`store` so the pop-out window can use it
// without spinning up a second AudioContext.

export interface VizSource {
  getFrequencyData(out: Uint8Array): void
  getTimeDomainData(ch: 0 | 1, out: Float32Array): void
  readonly sampleRate: number
  readonly freqBinCount: number
  readonly fftSize: number
}

const STAGE_BG_RGB = '11,11,14' // dark stage, theme-independent (visualizers read best on black)

// Shared canvas/rAF plumbing. DPR-correct sizing; `clear:false` lets a scope keep
// the previous frame (spectrogram scroll, goniometer trails). The draw closure is
// refreshed every render via a ref, so it always sees live props.
function useStageCanvas(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { clear?: boolean; onResize?: (w: number, h: number) => void } = {}
): React.RefObject<HTMLCanvasElement> {
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
      if (!w || !h) return
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

// Shared log-frequency span. Axis ticks are picked adaptively per draw (see
// vizTicks) so density scales with the rendered width/height.
const F_MIN = 30
const F_MAX = 20000
const freqFrac = (f: number): number => Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)

interface ScopeSpec {
  clear: boolean
  init: (src: VizSource) => Record<string, unknown>
  draw: (
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    src: VizSource,
    st: Record<string, unknown>
  ) => void
  onResize?: (w: number, h: number, st: Record<string, unknown>) => void
}

function toRgb(s: string): [number, number, number] {
  const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/)
  if (!m) return [255, 255, 255]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

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

const BIG_BARS = 96
const SG_COLS = 600
const SG_ROWS = 300

const SCOPES: Record<VizScope, ScopeSpec> = {
  // ── Spectrum ──────────────────────────────────────────────────────────────
  spectrum: {
    clear: true,
    init: (src) => ({ data: new Uint8Array(src.freqBinCount), peaks: new Float32Array(BIG_BARS) }),
    draw: (g, w, h, src, st) => {
      const data = st.data as Uint8Array
      const peaks = st.peaks as Float32Array
      src.getFrequencyData(data)
      const axis = 18
      const plotH = h - axis
      const binHz = src.sampleRate / 2 / src.freqBinCount
      const barW = w / BIG_BARS

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
        for (let b = b0; b < b1; b++) sum += data[b] ?? 0
        const v = Math.pow(sum / (b1 - b0) / 255, 0.8)
        g.fillStyle = grad
        const bh = Math.max(1.5, v * plotH)
        g.fillRect(i * barW + 1, plotH - bh, barW - 2, bh)
        const p = (peaks[i] = Math.max(v, peaks[i] - 0.006))
        g.fillStyle = vizColors.text
        g.fillRect(i * barW + 1, plotH - Math.max(2, p * plotH), barW - 2, 2)
      }

      g.font = '11px system-ui, sans-serif'
      g.textBaseline = 'bottom'
      g.fillStyle = vizColors.faint
      const ticks = pickFreqTicks(freqFrac, w, 48)
      ticks.forEach((t, i) => {
        const x = t.frac * w
        g.fillRect(x, plotH - 3, 1, 4)
        g.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
        g.fillText(`${t.label} Hz`, Math.max(1, Math.min(w - 1, x)), h)
      })
    }
  },

  // ── Spectrogram ───────────────────────────────────────────────────────────
  spectrogram: {
    clear: false,
    init: (src) => {
      const hist = document.createElement('canvas')
      hist.width = SG_COLS
      hist.height = SG_ROWS
      return { data: new Uint8Array(src.freqBinCount), hist, palette: buildPalette() }
    },
    onResize: (_w, _h, st) => {
      st.palette = buildPalette()
    },
    draw: (g, w, h, src, st) => {
      const data = st.data as Uint8Array
      const hist = st.hist as HTMLCanvasElement
      const palette = st.palette as string[]
      src.getFrequencyData(data)
      const hg = hist.getContext('2d')!
      hg.globalCompositeOperation = 'copy'
      hg.drawImage(hist, -1, 0)
      hg.globalCompositeOperation = 'source-over'
      const binHz = src.sampleRate / 2 / src.freqBinCount
      const x = SG_COLS - 1
      for (let y = 0; y < SG_ROWS; y++) {
        const f = F_MIN * Math.pow(F_MAX / F_MIN, 1 - y / SG_ROWS)
        const bin = Math.min(data.length - 1, Math.round(f / binHz))
        hg.fillStyle = palette[data[bin] ?? 0]
        hg.fillRect(x, y, 1, 1)
      }
      const axis = 26
      g.imageSmoothingEnabled = true
      g.fillStyle = `rgb(${STAGE_BG_RGB})`
      g.fillRect(0, 0, w, h)
      g.drawImage(hist, 0, 0, SG_COLS, SG_ROWS, 0, 0, w, h - axis)

      g.font = '11px system-ui, sans-serif'
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      // vertical axis: density scales with the rendered height
      for (const t of pickFreqTicks(freqFrac, h - axis, 22)) {
        const y = (1 - t.frac) * (h - axis)
        g.fillStyle = 'rgba(0,0,0,0.45)'
        g.fillRect(0, y - 7, 34, 14)
        g.fillStyle = vizColors.text
        g.fillText(t.label, 3, y)
      }
      g.fillStyle = vizColors.faint
      g.textBaseline = 'bottom'
      g.textAlign = 'left'
      g.fillText('older', 2, h)
      g.textAlign = 'right'
      g.fillText('now ▸', w - 2, h)
    }
  },

  // ── Oscilloscope ──────────────────────────────────────────────────────────
  oscilloscope: {
    clear: true,
    init: (src) => ({ bufL: new Float32Array(src.fftSize), bufR: new Float32Array(src.fftSize) }),
    draw: (g, w, h, src, st) => {
      const bufL = st.bufL as Float32Array
      const bufR = st.bufR as Float32Array
      const mid = h / 2
      g.strokeStyle = vizColors.faint
      g.globalAlpha = 0.4
      g.beginPath()
      g.moveTo(0, mid)
      g.lineTo(w, mid)
      g.stroke()
      g.globalAlpha = 1

      const trace = (buf: Float32Array, color: string, alpha: number): void => {
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

      src.getTimeDomainData(1, bufR)
      src.getTimeDomainData(0, bufL)
      trace(bufR, vizColors.accentLight, 0.5)
      trace(bufL, vizColors.accent, 1)

      g.font = '11px system-ui, sans-serif'
      g.fillStyle = vizColors.faint
      g.textBaseline = 'top'
      g.textAlign = 'left'
      g.fillText('L / R waveform', 4, 4)
    }
  },

  // ── Goniometer (vectorscope) ──────────────────────────────────────────────
  goniometer: {
    clear: false,
    init: (src) => ({ bufL: new Float32Array(src.fftSize), bufR: new Float32Array(src.fftSize) }),
    draw: (g, w, h, src, st) => {
      const bufL = st.bufL as Float32Array
      const bufR = st.bufR as Float32Array
      g.fillStyle = `rgba(${STAGE_BG_RGB},0.22)`
      g.fillRect(0, 0, w, h)

      const cx = w / 2
      const cy = h / 2
      const scale = Math.min(w, h) * 0.46

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

      src.getTimeDomainData(0, bufL)
      src.getTimeDomainData(1, bufR)
      const n = bufL.length
      g.fillStyle = vizColors.accent
      g.globalAlpha = 0.85
      for (let i = 0; i < n; i++) {
        const l = bufL[i]
        const r = bufR[i]
        const x = (l - r) * Math.SQRT1_2
        const y = (l + r) * Math.SQRT1_2
        g.fillRect(cx + x * scale, cy - y * scale, 1.6, 1.6)
      }
      g.globalAlpha = 1
    }
  }
}

// One canvas that renders a scope from a source. Key it by scope so switching
// scopes remounts it (fresh per-scope state + correct clear/loop config).
export function VizCanvas({
  scope,
  source
}: {
  scope: VizScope
  source: VizSource
}): React.ReactNode {
  const spec = SCOPES[scope]
  const stateRef = useRef<Record<string, unknown> | null>(null)
  if (!stateRef.current) stateRef.current = spec.init(source)
  const ref = useStageCanvas((g, w, h) => spec.draw(g, w, h, source, stateRef.current!), {
    clear: spec.clear,
    onResize: (w, h) => spec.onResize?.(w, h, stateRef.current!)
  })
  return <canvas ref={ref} className="viz-stage-canvas" />
}
