import { audio } from './audio'
import type { VizSource } from './components/VizScopes'
import { trackByPath, useStore } from './store'
import { makeFpsGate } from './vizFps'

// The live VizSource: the main window's own analyser nodes. Lives in its own
// module (imports `audio`) so VizScopes can stay audio-free for the pop-out.
export const liveSource: VizSource = {
  // casts: the analyser DOM types want ArrayBuffer-backed views; the VizSource
  // interface uses the looser ArrayBufferLike (so pop-out/IPC buffers also fit).
  getFrequencyData: (o) => audio.spectrumAnalyser.getByteFrequencyData(o as Uint8Array<ArrayBuffer>),
  getTimeDomainData: (ch, o) =>
    audio.vuAnalysers[ch].getFloatTimeDomainData(o as Float32Array<ArrayBuffer>),
  get sampleRate() {
    return audio.context.sampleRate
  },
  freqBinCount: audio.spectrumAnalyser.frequencyBinCount,
  fftSize: audio.vuAnalysers[0].fftSize
}

// The main window feeds pop-out windows: while ≥1 pop-out is open, the main
// process asks us (via 'viz-feed' → onVizFeed) to read the analysers each frame
// and ship a VizFrame. The rAF only runs while feeding, so closed pop-outs cost
// nothing.
let feedRaf = 0
const freq = new Uint8Array(audio.spectrumAnalyser.frequencyBinCount)
const timeL = new Float32Array(audio.vuAnalysers[0].fftSize)
const timeR = new Float32Array(audio.vuAnalysers[1].fftSize)

// Throttle the feed itself to the chosen cap — no point serialising frames the
// pop-out would only drop. The pop-out re-gates to the same fps on its end.
const feedGate = makeFpsGate()

function tick(now: number): void {
  feedRaf = requestAnimationFrame(tick)
  const s = useStore.getState()
  const fps = s.vizFps
  if (!feedGate(now, fps)) return
  audio.spectrumAnalyser.getByteFrequencyData(freq)
  audio.vuAnalysers[0].getFloatTimeDomainData(timeL)
  audio.vuAnalysers[1].getFloatTimeDomainData(timeR)
  const title = trackByPath(s.library, s.currentPath)?.title ?? ''
  window.api.sendVizFrame({
    freq,
    timeL,
    timeR,
    sampleRate: audio.context.sampleRate,
    title,
    fps
  })
}

export function startVizFeedBridge(): void {
  // A pop-out asked to change the cap — apply it to the store (persists + the feed
  // restamps it, so the in-bar widgets and every pop-out converge on the new fps).
  window.api.onVizSetFps((fps) => useStore.getState().setVizFps(fps))
  window.api.onVizFeed((active) => {
    if (active && !feedRaf) {
      feedRaf = requestAnimationFrame(tick)
    } else if (!active && feedRaf) {
      cancelAnimationFrame(feedRaf)
      feedRaf = 0
    }
  })
}
