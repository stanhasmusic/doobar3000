// Audio engine: <audio> element streamed through Web Audio so Phase 2's
// analyser nodes can tap the signal. Volume is applied in the float domain
// via a GainNode rather than the element's volume property.

export function toMediaUrl(filePath: string): string {
  return `media://${encodeURIComponent(filePath)}`
}

const el = new Audio()
el.crossOrigin = 'anonymous'
el.preload = 'auto'

const ctx = new AudioContext()
const source = ctx.createMediaElementSource(el)
const gain = ctx.createGain()
source.connect(gain)
gain.connect(ctx.destination)

export const audio = {
  // wired up by the store after creation (avoids a circular import)
  onEnded: () => {},
  onError: () => {},
  onTimeUpdate: (_time: number) => {},

  load(filePath: string, play: boolean): void {
    el.src = toMediaUrl(filePath)
    if (play) void this.play()
  },
  async play(): Promise<void> {
    if (ctx.state === 'suspended') await ctx.resume()
    await el.play().catch(() => {})
  },
  pause(): void {
    el.pause()
  },
  stop(): void {
    el.pause()
    el.removeAttribute('src')
    el.load()
  },
  seek(time: number): void {
    el.currentTime = time
  },
  setVolume(v: number): void {
    gain.gain.value = v * v // perceptual curve: linear sliders feel top-heavy
  },
  currentTime: () => el.currentTime,
  duration: () => (Number.isFinite(el.duration) ? el.duration : 0),
  context: ctx,
  gainNode: gain
}

el.addEventListener('error', () => {
  console.error(`audio element error code=${el.error?.code} msg=${el.error?.message} src=${el.src.slice(0, 120)}`)
  audio.onError()
})
el.addEventListener('ended', () => audio.onEnded())
el.addEventListener('timeupdate', () => audio.onTimeUpdate(el.currentTime))
