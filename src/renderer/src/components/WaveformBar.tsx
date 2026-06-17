import { useEffect, useRef } from 'react'
import { audio, toMediaUrl } from '../audio'
import { trackByPath, useStore, vizColors } from '../store'

const BUCKETS = 1200

async function computePeaks(filePath: string): Promise<number[]> {
  const buf = await (await fetch(toMediaUrl(filePath))).arrayBuffer()
  // decode in a throwaway context so the playback context is untouched
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(buf)
    const data = decoded.getChannelData(0)
    const peaks = new Array<number>(BUCKETS).fill(0)
    const step = Math.max(1, Math.floor(data.length / BUCKETS))
    for (let b = 0; b < BUCKETS; b++) {
      let max = 0
      const start = b * step
      const end = Math.min(start + step, data.length)
      // sample within the bucket; every 16th value is plenty for a visual
      for (let i = start; i < end; i += 16) {
        const v = Math.abs(data[i])
        if (v > max) max = v
      }
      peaks[b] = max
    }
    // normalize to the track's own peak so quiet recordings still fill the display
    const top = Math.max(...peaks)
    return top > 0 ? peaks.map((p) => p / top) : peaks
  } finally {
    void ctx.close()
  }
}

export function WaveformBar() {
  const currentPath = useStore((s) => s.currentPath)
  const playbackPath = useStore((s) => s.playbackPath)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<number[] | null>(null)

  useEffect(() => {
    peaksRef.current = null
    if (!currentPath || !playbackPath) return
    let cancelled = false
    ;(async () => {
      // cache key is the original path; decode source is whatever file actually
      // plays (the transcode cache when the original is Chromium-undecodable)
      let peaks = await window.api.getPeaks(currentPath)
      if (!peaks) {
        try {
          peaks = await computePeaks(playbackPath)
          void window.api.savePeaks(currentPath, peaks)
        } catch {
          peaks = null
        }
      }
      if (!cancelled) peaksRef.current = peaks
    })()
    return () => {
      cancelled = true
    }
  }, [currentPath, playbackPath])

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
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

      const peaks = peaksRef.current
      // streamed sources can report Infinity; fall back to the scanned metadata duration
      const st = useStore.getState()
      const duration = audio.duration() || trackByPath(st.library, st.currentPath)?.duration || 0
      const progress = duration > 0 ? Math.min(1, audio.currentTime() / duration) : 0

      if (!peaks) {
        // no waveform yet: flat progress line
        g.fillStyle = vizColors.track
        g.fillRect(0, h / 2 - 1, w, 2)
        g.fillStyle = vizColors.accent
        g.fillRect(0, h / 2 - 1, w * progress, 2)
        return
      }

      const n = peaks.length
      const mid = h / 2
      const barW = w / n
      const playedX = w * progress
      for (let i = 0; i < n; i++) {
        const x = i * barW
        const amp = Math.max(0.015, peaks[i] * 0.92)
        const bh = amp * (h - 6)
        g.fillStyle = x < playedX ? vizColors.accent : vizColors.faint
        g.fillRect(x, mid - bh / 2, Math.max(1, barW - 0.5), bh)
      }
      // playhead
      g.fillStyle = vizColors.text
      g.fillRect(playedX - 0.5, 2, 1, h - 4)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const st = useStore.getState()
    const duration = audio.duration() || trackByPath(st.library, st.currentPath)?.duration || 0
    if (duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    useStore.getState().seek(frac * duration)
  }

  const track = trackByPath(useStore((s) => s.library), currentPath)
  const station = useStore((s) => s.currentStation)

  // Radio is a live stream — there's nothing to seek. Replace the waveform with a
  // "● LIVE" indicator (the draw loop above no-ops while the canvas is unmounted).
  if (station) {
    return (
      <div className="waveform-bar waveform-live" title={`${station.name} — live stream`}>
        <span className="live-dot" />
        LIVE
      </div>
    )
  }

  return (
    <div className="waveform-bar" title={track ? `${track.title} — click to seek` : ''}>
      <canvas ref={canvasRef} onClick={onClick} />
    </div>
  )
}
