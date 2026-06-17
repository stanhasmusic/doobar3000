// Audio engine: <audio> element streamed through Web Audio so Phase 2's
// analyser nodes can tap the signal. Volume is applied in the float domain
// via a GainNode rather than the element's volume property.

export function toMediaUrl(filePath: string): string {
  return `media://${encodeURIComponent(filePath)}`
}

// Internet-radio streams play through the main-process proxy (radio://) so they
// arrive same-origin with ACAO and the Web Audio graph still sees them (Phase D).
export function toRadioUrl(streamUrl: string): string {
  return `radio://${encodeURIComponent(streamUrl)}`
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
  // Load a ready-made URL (e.g. a radio:// proxy URL). Same graph, same crossOrigin.
  loadUrl(url: string, play: boolean): void {
    el.src = url
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
  // Route the whole graph to a chosen output device. NOTE: this must be
  // AudioContext.setSinkId, NOT the <audio> element's — the element's output was
  // taken over by ctx.destination, so its sink id is ignored. ''/'default' = the
  // system default. Chromium 110+ (we're on Electron 35 ≈ Chromium 134).
  async setSinkId(deviceId: string): Promise<boolean> {
    const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (typeof c.setSinkId !== 'function') return false
    try {
      await c.setSinkId(deviceId || '')
      return true
    } catch (e) {
      console.warn('setSinkId failed', e) // device gone → caller falls back to default
      return false
    }
  },
  /** the mix (output) format the graph runs at — WASAPI shared decides this */
  mixFormat: (): { sampleRate: number; channels: number } => ({
    sampleRate: ctx.sampleRate,
    channels: ctx.destination.channelCount
  }),
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
