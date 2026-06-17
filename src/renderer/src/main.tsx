import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// A pop-out visualizer window loads the same bundle with a #popout=<scope> hash
// (see preload.popoutScope). It renders the minimal Popout; the full App otherwise.
// The two trees are *dynamically* imported so the pop-out never pulls in App's
// audio graph (importing audio.ts would spin up a second AudioContext).
const popoutScope = window.api.popoutScope
const root = createRoot(document.getElementById('root')!)

if (popoutScope) {
  void import('./components/Popout').then(({ Popout }) =>
    root.render(<Popout initialScope={popoutScope} />)
  )
} else {
  void import('./App').then(({ App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  )
}
