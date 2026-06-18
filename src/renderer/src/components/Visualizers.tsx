import { useEffect, useRef } from 'react'
import { audio } from '../audio'
import { useStore, vizColors } from '../store'
import { pickDbTicks, pickFreqTicks } from '../vizTicks'
import { makeFpsGate } from '../vizFps'

// The draw callback is held in a ref and refreshed every render, so the rAF loop
// (started once) always calls the latest closure — letting `draw` read live props
// like nerd mode without restarting the loop. `fps` is likewise read live via a
// ref so the user's render-rate cap can change without tearing down the loop.
function useCanvasLoop(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  fps: number
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const fpsRef = useRef(fps)
  fpsRef.current = fps
  useEffect(() => {
    let raf = 0
    const gate = makeFpsGate()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (!gate(now, fpsRef.current)) return
      const canvas = ref.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      const g = canvas.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      drawRef.current(g, w, h)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return ref
}

// log position (0..1) of a frequency within the spectrum's FREQ_MIN..FREQ_MAX span
const freqFrac = (f: number): number =>
  Math.log(f / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN)

const BARS = 48
const FREQ_MIN = 50
const FREQ_MAX = 16000

export function Spectrum() {
  const analyser = audio.spectrumAnalyser
  const data = useRef(new Uint8Array(analyser.frequencyBinCount))
  const nerdMode = useStore((s) => s.nerdMode)
  const fps = useStore((s) => s.vizFps)

  const ref = useCanvasLoop((g, w, h) => {
    analyser.getByteFrequencyData(data.current)
    // reserve a thin bottom strip for the Hz axis when nerd mode is on and the
    // widget is wide enough for the labels to stay legible
    const axis = nerdMode && w >= 200 ? 11 : 0
    const plotH = h - axis
    const binHz = audio.context.sampleRate / 2 / analyser.frequencyBinCount
    const barW = w / BARS
    const grad = g.createLinearGradient(0, plotH, 0, 0)
    grad.addColorStop(0, vizColors.accentDark)
    grad.addColorStop(0.6, vizColors.accent)
    grad.addColorStop(1, vizColors.accentLight)
    g.fillStyle = grad
    for (let i = 0; i < BARS; i++) {
      // log-spaced frequency band for this bar
      const f0 = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, i / BARS)
      const f1 = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, (i + 1) / BARS)
      const b0 = Math.floor(f0 / binHz)
      const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz))
      let sum = 0
      for (let b = b0; b < b1; b++) sum += data.current[b] ?? 0
      const v = Math.pow(sum / (b1 - b0) / 255, 0.8) // mild lift for low levels
      const bh = Math.max(1.5, v * plotH)
      g.fillRect(i * barW + 1, plotH - bh, barW - 2, bh)
    }
    if (axis) {
      g.font = '9px system-ui, sans-serif'
      g.textBaseline = 'bottom'
      g.fillStyle = vizColors.faint
      // density scales with width: more graduations fill a wider widget
      const ticks = pickFreqTicks(freqFrac, w, 34)
      ticks.forEach((t, i) => {
        const x = t.frac * w
        g.fillRect(x, plotH - 2, 1, 3) // a small tick into the plot
        g.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
        g.fillText(t.label, Math.max(1, Math.min(w - 1, x)), h)
      })
    }
  }, fps)

  return <canvas ref={ref} className="spectrum" />
}

const VU_FLOOR = -48 // dB shown at the left edge
const vuFrac = (db: number): number => Math.max(0, Math.min(1, (db - VU_FLOOR) / -VU_FLOOR))

export function VuMeter() {
  const buffers = useRef(audio.vuAnalysers.map((a) => new Float32Array(a.fftSize)))
  const peaks = useRef([VU_FLOOR, VU_FLOOR])
  const nerdMode = useStore((s) => s.nerdMode)
  const fps = useStore((s) => s.vizFps)

  const ref = useCanvasLoop((g, w, h) => {
    const axis = nerdMode && w >= 90 ? 13 : 0 // bottom strip for the dB scale
    const head = nerdMode && w >= 90 ? 13 : 0 // top strip for the live peak readout
    const barH = 7
    const span = h - axis - head
    const gap = (span - barH * 2) / 3
    let peakMax = VU_FLOOR
    audio.vuAnalysers.forEach((analyser, ch) => {
      analyser.getFloatTimeDomainData(buffers.current[ch])
      let sum = 0
      for (const v of buffers.current[ch]) sum += v * v
      const rms = Math.sqrt(sum / buffers.current[ch].length)
      const db = rms > 0 ? 20 * Math.log10(rms) : VU_FLOOR
      // peak hold with steady fall
      peaks.current[ch] = Math.max(db, peaks.current[ch] - 0.45)
      peakMax = Math.max(peakMax, peaks.current[ch])

      const frac = vuFrac(db)
      const peakFrac = vuFrac(peaks.current[ch])
      const y = head + gap + ch * (barH + gap)

      g.fillStyle = vizColors.track
      g.fillRect(0, y, w, barH)
      // level-coded gradient (green→amber→red) stays constant across themes
      const grad = g.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, '#3ddc84')
      grad.addColorStop(0.72, '#3ddc84')
      grad.addColorStop(0.85, '#ffd24a')
      grad.addColorStop(1, '#ff5c5c')
      g.fillStyle = grad
      g.fillRect(0, y, w * frac, barH)
      if (peakFrac > 0.01) {
        g.fillStyle = vizColors.text
        g.fillRect(w * peakFrac - 1, y, 2, barH)
      }
    })
    if (axis || head) {
      const PAD = 3 // keep the corner labels off the widget's boundary lines
      g.font = '9px system-ui, sans-serif'
      g.fillStyle = vizColors.faint
      g.textBaseline = 'bottom'
      g.textAlign = 'right'
      // width-adaptive density: the 12 dB grid at the narrow top-bar width,
      // filling in 6/3 dB marks as the widget grows
      for (const t of pickDbTicks(vuFrac, w, 22)) {
        const x = Math.min(t.frac * w, w - 1)
        g.fillRect(x, head + span, 1, 3)
        // each number sits just left of its tick mark (right-aligned) so the mark
        // never crosses the digits; the baseline is a hair above the bottom border
        g.fillText(t.label, x - 2, h - 1)
      }
      // live peak readout (louder of L/R), top-right — inset from the corner
      g.textBaseline = 'top'
      g.textAlign = 'right'
      g.fillStyle = peakMax > -1 ? '#ff5c5c' : vizColors.text
      g.fillText(`${peakMax <= VU_FLOOR ? '−∞' : peakMax.toFixed(1)} dB`, w - PAD, PAD)
    }
  }, fps)

  return <canvas ref={ref} className="vu-meter" title="VU (L/R)" />
}
