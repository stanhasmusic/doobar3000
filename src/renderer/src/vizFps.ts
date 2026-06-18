// Selectable render-rate caps for the visualizers. requestAnimationFrame (i.e.
// the display refresh) is the hard ceiling, so these values only ever *throttle*
// drawing — they never push it past the monitor. The top option sits above any
// common refresh rate, so it effectively means "draw every frame / uncapped".
// Pure (no audio/store imports) so the pop-out window can use it too.

export const VIZ_FPS_OPTIONS = [24, 30, 60, 120, 144, 240] as const
export const DEFAULT_VIZ_FPS = 60

// A frame-rate gate for a rAF loop. Call it with the rAF timestamp and the live
// cap; it returns true on frames that should draw. It accumulates the target
// interval (rather than snapping to `now`) so caps that don't divide the refresh
// rate evenly still average out correctly, and resyncs after a stall or an fps
// change so it never bursts to "catch up".
export function makeFpsGate(): (now: number, fps: number) => boolean {
  let next = 0
  return (now, fps) => {
    if (now < next) return false
    const interval = 1000 / fps
    next += interval
    if (next <= now) next = now + interval // behind (first frame, stall, fps drop) → resync
    return true
  }
}
