import { useEffect } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DuplicatesView } from './components/DuplicatesView'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { TrackList } from './components/TrackList'
import { VizPanel } from './components/VizPanel'
import { WaveformBar } from './components/WaveformBar'
import { WelcomeDialog } from './components/WelcomeDialog'
import { startVizFeedBridge } from './liveSource'
import { useStore } from './store'

// React StrictMode double-mounts in dev; init must run exactly once
let initRan = false

function Content() {
  const view = useStore((s) => s.view)
  return view.type === 'duplicates' ? <DuplicatesView /> : <TrackList />
}

function Welcome() {
  const seenWelcome = useStore((s) => s.seenWelcome)
  return seenWelcome ? null : <WelcomeDialog />
}

// Asked after an import (or decoder-pack install) leaves thousands of tracks
// needing loudness analysis — long enough that it's worth a choice rather than
// silently pinning the CPU. Declining just pauses; Settings → Playback →
// Leveling can start it later.
function AnalysisPrompt() {
  const prompt = useStore((s) => s.analysisPrompt)
  const concurrency = useStore((s) => s.analysisConcurrency)
  const { answerAnalysisPrompt } = useStore.getState()
  if (!prompt) return null
  // ~0.85 tracks/s per worker, measured on mixed mp3/m4a at 4-min average.
  const minutes = Math.max(1, Math.round(prompt.pending / (0.85 * concurrency) / 60))
  return (
    <ConfirmDialog
      title="Analyze loudness now?"
      message={
        <>
          {prompt.pending.toLocaleString()} tracks still need loudness analysis — roughly{' '}
          {minutes} minute{minutes === 1 ? '' : 's'} in the background. Auto-leveling stays
          approximate until it finishes. You can pause or resume any time in Settings → Playback →
          Leveling.
        </>
      }
      confirmLabel="Analyze now"
      danger={false}
      onConfirm={() => answerAnalysisPrompt(true)}
      onCancel={() => answerAnalysisPrompt(false)}
    />
  )
}

export function App() {
  useEffect(() => {
    if (initRan) return
    initRan = true
    startVizFeedBridge() // feed analyser frames to pop-out windows while any are open
    void useStore
      .getState()
      .init()
      .then(() => {
        // dev harness: DEV_AUTOPLAY=1 starts the first track for automated checks
        if (window.api.flags.autoplay) {
          const { library, playQueue } = useStore.getState()
          if (library.length) {
            playQueue(
              library.map((t) => t.path),
              0
            )
            if (window.api.flags.seek) {
              setTimeout(() => useStore.getState().seek(window.api.flags.seek), 2500)
            }
          }
        }
      })
  }, [])

  useEffect(() => {
    // stop Chromium from navigating to dropped files outside our drop zones
    const block = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        useStore.getState().togglePlay()
      }
      // Ctrl+F opens the search bar; pressing it again re-focuses rather than
      // toggling shut, matching how find behaves everywhere else.
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        useStore.getState().openSearch()
      }
      // Esc closes search from anywhere, not just with the box focused.
      if (e.key === 'Escape' && !typing && useStore.getState().searchOpen) {
        useStore.getState().closeSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar />
      <div className="middle">
        <Sidebar />
        <Content />
        <VizPanel />
      </div>
      <WaveformBar />
      <Welcome />
      <AnalysisPrompt />
    </div>
  )
}
