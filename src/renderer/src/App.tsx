import { useEffect } from 'react'
import { DuplicatesView } from './components/DuplicatesView'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { TrackList } from './components/TrackList'
import { WaveformBar } from './components/WaveformBar'
import { WelcomeDialog } from './components/WelcomeDialog'
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

export function App() {
  useEffect(() => {
    if (initRan) return
    initRan = true
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
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        useStore.getState().togglePlay()
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
      </div>
      <WaveformBar />
      <Welcome />
    </div>
  )
}
