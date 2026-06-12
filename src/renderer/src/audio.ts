// Audio engine: <audio> element streamed through Web Audio so Phase 2's
// analyser nodes can tap the signal. Volume is applied in the float domain
// via a GainNode rather than the element's volume property.

export function toMediaUrl(filePath: string): string {
  return `media://${encodeURIComponent(filePath)}`
}

const el = new Audio()
el.crossOrigin = 'anonymous'
el.preload = 'auto'

// Graph: source → levelGain (LUFS auto-level) → userGain (volume) → spectrum
// analyser → destination, with a stereo splitter tapped off for the VU meter.
const ctx = new AudioContext()
const source = ctx.createMediaElementSource(el)
const levelGain = ctx.createGain()
const gain = ctx.createGain()
const spectrumAnalyser = ctx.createAnalyser()
spectrumAnalyser.fftSize = 4096
spectrumAnalyser.smoothingTimeConstant = 0.75
spectrumAnalyser.minDecibels = -78
spectrumAnalyser.maxDecibels = -22
const splitter = ctx.createChannelSplitter(2)
const vuAnalysers = [ctx.createAnalyser(), ctx.createAnalyser()]
for (const a of vuAnalysers) a.fftSize = 1024

source.connect(levelGain)
levelGain.connect(gain)
gain.connect(spectrumAnalyser)
spectrumAnalyser.connect(ctx.destination)
gain.connect(splitter) // analysers are taps; they don't pass audio onward
splitter.connect(vuAnalysers[0], 0)
splitter.connect(vuAnalysers[1], 1)

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
  setLevelGainDb(db: number): void {
    levelGain.gain.value = Math.pow(10, db / 20)
  },
  currentTime: () => el.currentTime,
  duration: () => (Number.isFinite(el.duration) ? el.duration : 0),
  context: ctx,
  gainNode: gain,
  spectrumAnalyser,
  vuAnalysers
}

el.addEventListener('error', () => {
  console.error(`audio element error code=${el.error?.code} msg=${el.error?.message} src=${el.src.slice(0, 120)}`)
  audio.onError()
})
el.addEventListener('ended', () => audio.onEnded())
el.addEventListener('timeupdate', () => audio.onTimeUpdate(el.currentTime))
