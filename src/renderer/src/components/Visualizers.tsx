import { useEffect, useRef } from 'react'
import { audio } from '../audio'

function useCanvasLoop(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
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
      draw(g, w, h)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

const BARS = 48
const FREQ_MIN = 50
const FREQ_MAX = 16000

export function Spectrum() {
  const analyser = audio.spectrumAnalyser
  const data = useRef(new Uint8Array(analyser.frequencyBinCount))

  const ref = useCanvasLoop((g, w, h) => {
    analyser.getByteFrequencyData(data.current)
    const binHz = audio.context.sampleRate / 2 / analyser.frequencyBinCount
    const barW = w / BARS
    const grad = g.createLinearGradient(0, h, 0, 0)
    grad.addColorStop(0, '#8a3b50')
    grad.addColorStop(0.6, '#e0556e')
    grad.addColorStop(1, '#ff9aa8')
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
      const bh = Math.max(1.5, v * h)
      g.fillRect(i * barW + 1, h - bh, barW - 2, bh)
    }
  })

  return <canvas ref={ref} className="spectrum" />
}

const VU_FLOOR = -48 // dB shown at the left edge

export function VuMeter() {
  const buffers = useRef(audio.vuAnalysers.map((a) => new Float32Array(a.fftSize)))
  const peaks = useRef([VU_FLOOR, VU_FLOOR])

  const ref = useCanvasLoop((g, w, h) => {
    const barH = 7
    const gap = (h - barH * 2) / 3
    audio.vuAnalysers.forEach((analyser, ch) => {
      analyser.getFloatTimeDomainData(buffers.current[ch])
      let sum = 0
      for (const v of buffers.current[ch]) sum += v * v
      const rms = Math.sqrt(sum / buffers.current[ch].length)
      const db = rms > 0 ? 20 * Math.log10(rms) : VU_FLOOR
      // peak hold with steady fall
      peaks.current[ch] = Math.max(db, peaks.current[ch] - 0.45)

      const frac = Math.max(0, Math.min(1, (db - VU_FLOOR) / -VU_FLOOR))
      const peakFrac = Math.max(0, Math.min(1, (peaks.current[ch] - VU_FLOOR) / -VU_FLOOR))
      const y = gap + ch * (barH + gap)

      g.fillStyle = '#2a2a31'
      g.fillRect(0, y, w, barH)
      const grad = g.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, '#3ddc84')
      grad.addColorStop(0.72, '#3ddc84')
      grad.addColorStop(0.85, '#ffd24a')
      grad.addColorStop(1, '#ff5c5c')
      g.fillStyle = grad
      g.fillRect(0, y, w * frac, barH)
      if (peakFrac > 0.01) {
        g.fillStyle = '#fff'
        g.fillRect(w * peakFrac - 1, y, 2, barH)
      }
    })
  })

  return <canvas ref={ref} className="vu-meter" title="VU (L/R)" />
}
