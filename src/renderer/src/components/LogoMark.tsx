import { useEffect, useRef, useState } from 'react'
import { useStore, trackByPath } from '../store'
import { audio } from '../audio'

// Doobar 3000's brand mark: a vinyl record with a swing-arm tonearm. It doubles
// as the transport's tactile control and the background-work indicator:
//  • Click it to play/pause — the tonearm drops the needle onto the spinning
//    record when playing and lifts it off when paused, just like the real thing.
//  • Right-click for the spin mode (see SpinMode): a fixed retro spin, a spin
//    whose stepped "ticks" track the song's BPM, or one that pulses on the kick.
//  • While any analysis pass runs the record spins and its outer ring fills
//    clockwise with the accent color to show overall progress. Fed by the three
//    progress sources in the store (library scan, loudness, vibe); when several
//    run at once their done/total are summed. When the last pass finishes it
//    snaps the ring to full and plays a brief pulse-and-fade "done" beat.

const R = 18.5 // progress-ring radius (user units; viewBox is 44×40)
const C = 2 * Math.PI * R

type SpinMode = 'standard' | 'bpm' | 'kick'
const MODES: { id: SpinMode; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard spin', hint: 'Steady retro spin' },
  { id: 'bpm', label: 'Match BPM', hint: 'Steps tick on the beat' },
  { id: 'kick', label: 'Match kick drum', hint: 'Pulses on the low end' }
]

export function LogoMark() {
  const scanning = useStore((s) => s.scanning)
  const lufsProgress = useStore((s) => s.lufsProgress)
  const vibeProgress = useStore((s) => s.vibeProgress)
  const playing = useStore((s) => s.playing)
  const currentPath = useStore((s) => s.currentPath)
  const { togglePlay } = useStore.getState()

  const sources = [
    { p: scanning, label: 'Scanning library' },
    { p: lufsProgress, label: 'Analyzing loudness' },
    { p: vibeProgress, label: 'Analyzing vibe' }
  ].filter((s): s is { p: { done: number; total: number }; label: string } => s.p != null)

  const active = sources.length > 0
  const done = sources.reduce((n, s) => n + s.p.done, 0)
  const total = sources.reduce((n, s) => n + s.p.total, 0)
  const liveFrac = total > 0 ? done / total : 0

  // Spin mode, persisted locally (no IPC plumbing needed for a view preference).
  const [mode, setMode] = useState<SpinMode>(() => {
    const m = localStorage.getItem('discSpinMode')
    return m === 'bpm' || m === 'kick' ? m : 'standard'
  })
  const changeMode = (m: SpinMode): void => {
    setMode(m)
    localStorage.setItem('discSpinMode', m)
    setMenu(null)
  }

  // Real platter physics: an rAF loop ramps angular velocity toward the target
  // (spin up fast, coast down slow like a heavy platter), then quantizes the
  // angle into chunky steps so the disc visibly "ticks" around like a low-fps
  // sprite — the core of the 8/16-bit feel. We drive the transform imperatively
  // to keep React out of the per-frame hot path.
  //   • bpm  — target speed is set so one 30° step lands per beat.
  //   • kick — low-band onsets off the spectrum analyser give the disc a scale
  //            "pump" on each kick, on top of the normal spin.
  const discRef = useRef<SVGGElement>(null)
  const angle = useRef(0)
  const vel = useRef(0)
  const raf = useRef(0)
  const last = useRef(0)
  const freq = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const baseline = useRef(0) // slow EMA of low-band energy, the kick threshold floor
  const lastKick = useRef(0)
  const pulse = useRef(0) // 0..1 kick pump, decays each frame
  const spinning = playing || active

  useEffect(() => {
    const STEP = 30 // quantize into 12 retro "frames" per turn
    const tick = (ts: number): void => {
      const dt = last.current ? Math.min((ts - last.current) / 1000, 0.05) : 0
      last.current = ts

      // top speed for the current mode
      let max = 156 // deg/sec
      if (mode === 'bpm') {
        const t = trackByPath(useStore.getState().library, useStore.getState().currentPath)
        // bpm/2 deg/s ⇒ one 30° step per beat (STEP * bpm/60)
        max = t?.bpm ? Math.min(420, Math.max(40, t.bpm / 2)) : 156
      }
      const target = spinning ? max : 0
      // snappier spin-up than coast-down — the platter has inertia
      const k = target > vel.current ? 4.5 : 1.8
      vel.current = target + (vel.current - target) * Math.exp(-k * dt)
      angle.current = (angle.current + vel.current * dt) % 360
      const q = Math.round(angle.current / STEP) * STEP

      // kick detection: compare instantaneous low-band energy to a slow baseline
      if (mode === 'kick' && spinning) {
        const an = audio.spectrumAnalyser
        if (!freq.current || freq.current.length !== an.frequencyBinCount)
          freq.current = new Uint8Array(new ArrayBuffer(an.frequencyBinCount))
        an.getByteFrequencyData(freq.current)
        const binHz = audio.context.sampleRate / an.fftSize
        const lo = Math.max(1, Math.floor(40 / binHz))
        const hi = Math.min(freq.current.length - 1, Math.ceil(120 / binHz))
        let sum = 0
        for (let i = lo; i <= hi; i++) sum += freq.current[i]
        const energy = sum / (hi - lo + 1) / 255 // 0..1
        baseline.current += (energy - baseline.current) * 0.06
        const now = ts / 1000
        if (energy > 0.16 && energy > baseline.current * 1.45 && now - lastKick.current > 0.16) {
          lastKick.current = now
          pulse.current = 1
        }
      }
      pulse.current = pulse.current > 0.002 ? pulse.current * Math.exp(-9 * dt) : 0

      if (discRef.current) {
        const s = 1 + pulse.current * 0.14
        discRef.current.style.transform = `rotate(${q}deg) scale(${s.toFixed(3)})`
      }
      if (spinning || vel.current > 0.5 || pulse.current > 0.01) {
        raf.current = requestAnimationFrame(tick)
      } else {
        vel.current = 0
        last.current = 0
        raf.current = 0
      }
    }
    if (!raf.current) {
      last.current = 0
      raf.current = requestAnimationFrame(tick)
    }
    return () => {
      if (raf.current) {
        cancelAnimationFrame(raf.current)
        raf.current = 0
      }
    }
  }, [spinning, mode])

  // "done" beat: when work stops, briefly hold a full ring before resetting.
  const [finishing, setFinishing] = useState(false)
  const wasActive = useRef(false)

  useEffect(() => {
    if (active) {
      wasActive.current = true
      setFinishing(false)
      return
    }
    if (!wasActive.current) return // was already idle — nothing finished
    wasActive.current = false
    setFinishing(true)
    const id = setTimeout(() => setFinishing(false), 1100)
    return () => clearTimeout(id) // resuming work cancels the beat
  }, [active])

  // right-click spin-mode menu
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const arcFrac = active ? liveFrac : finishing ? 1 : 0
  // (record turns while playing OR analysis runs — see `spinning` above; the
  // needle only rides the groove when there's actual playback)
  const title = active
    ? `${sources.length === 1 ? sources[0].label : 'Analyzing audio'}… ${done} / ${total}`
    : playing
      ? 'Pause'
      : currentPath
        ? 'Play'
        : 'Doobar 3000'

  return (
    <>
      <button
        type="button"
        className="logo-mark"
        title={title}
        aria-label={title}
        onClick={togglePlay}
        onContextMenu={(e) => {
          e.preventDefault()
          // Don't let this reach the TopBar's bar-level context menu — otherwise
          // both open at once and the bar's "rearrange" menu paints over ours.
          // (In arrange mode .tb-content is pointer-events:none, so this never
          // fires there and the bar menu correctly handles the vinyl.)
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <svg
          className={`logo-disc ${playing ? 'playing' : ''} ${finishing ? 'done' : ''}`}
          viewBox="0 0 44 40"
          shapeRendering="crispEdges"
        >
          <g className="disc-spin" ref={discRef}>
            <circle className="disc-body" cx="20" cy="20" r="15.5" />
            <circle className="disc-groove" cx="20" cy="20" r="12.6" />
            <circle className="disc-groove" cx="20" cy="20" r="9.4" />
            {/* chunky run-in groove + an orbiting pixel make the stepped spin read */}
            <line className="disc-notch" x1="20" y1="6" x2="20" y2="14.6" />
            <rect className="disc-marker" x="18.8" y="4.3" width="2.4" height="2.4" />
            <circle className="disc-label" cx="20" cy="20" r="5" />
            {/* blocky pixel detail on the label */}
            <rect className="disc-label-px" x="16.4" y="19" width="2" height="2" />
            <rect className="disc-label-px" x="21.6" y="19" width="2" height="2" />
            <rect className="disc-label-hi" x="19" y="16.1" width="2" height="2" />
            <circle className="disc-hole" cx="20" cy="20" r="1.3" />
          </g>
          {/* progress ring: faint full track + accent arc that fills clockwise */}
          <circle className="disc-track" cx="20" cy="20" r={R} shapeRendering="geometricPrecision" />
          <circle
            className="disc-arc"
            cx="20"
            cy="20"
            r={R}
            shapeRendering="geometricPrecision"
            style={{ strokeDasharray: C, strokeDashoffset: C * (1 - arcFrac) }}
          />
          {/* swing-arm tonearm: pivots from the top-right mount (38,8). Drawn in its
              engaged pose (needle on the outer groove); .playing drops it here with a
              bounce, otherwise CSS parks it lifted up and off the record. Blocky pixel
              pivot + square-capped rods to match the retro disc. */}
          <g className="tonearm">
            {/* counterweight stub behind the pivot */}
            <line className="arm-rod arm-rod-back" x1="38" y1="8" x2="41" y2="6.5" />
            {/* main arm out to the headshell */}
            <line className="arm-rod" x1="38" y1="8" x2="29.6" y2="11.2" />
            <rect className="arm-head" x="27.4" y="9.6" width="3.6" height="3.6" />
            <rect className="arm-needle" x="28.6" y="13" width="1.2" height="1.6" />
            <rect className="arm-pivot-base" x="35.2" y="5.2" width="5.6" height="5.6" />
            <rect className="arm-pivot" x="36.8" y="6.8" width="2.4" height="2.4" />
          </g>
        </svg>
      </button>
      {menu && (
        <div ref={menuRef} className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="menu-head">Disc spin</div>
          {MODES.map((m) => (
            <div
              key={m.id}
              className="menu-item check"
              title={m.hint}
              onClick={() => changeMode(m.id)}
            >
              <span className="check-box">{mode === m.id ? '✓' : ''}</span>
              {m.label}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
