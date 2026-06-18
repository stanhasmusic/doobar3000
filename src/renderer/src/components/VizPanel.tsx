import { ALL_VIZ_SCOPES, VIZ_SCOPE_LABELS, type VizScope } from '../../../shared/types'
import { liveSource } from '../liveSource'
import { useStore } from '../store'
import { VizCanvas } from './VizScopes'

// The docked, in-app visualizer panel (Phase C, redesign). Lives on the right of
// the track list — never covers the app. Shows one scope at a time (live
// analysers); a left-edge handle resizes it; ⇱ pops the scope into its own window.
//
// PARKED 2026-06-16 (Stan's call): the pop-out windows are the keeper; the docked
// panel is parked — kept intact behind this flag, exactly like VIBE_ENABLED. When
// false, the panel never renders and the top-bar viz widget opens a pop-out menu
// instead (see TopBar). Flip to true to bring the docked panel back — zero rework.
export const VIZ_PANEL_ENABLED = false

export function VizPanel(): React.ReactNode {
  const open = useStore((s) => s.vizPanelOpen)
  const nerdMode = useStore((s) => s.nerdMode)
  const enabled = useStore((s) => s.visualizers)
  const scope = useStore((s) => s.vizScope)
  const width = useStore((s) => s.vizPanelWidth)
  const fps = useStore((s) => s.vizFps)
  const { setVizScope, closeVizPanel, setVizPanelWidth } = useStore.getState()

  if (!VIZ_PANEL_ENABLED || !open || !nerdMode) return null

  const available = ALL_VIZ_SCOPES.filter((s) => enabled.includes(s))
  const active = available.includes(scope) ? scope : available[0]

  // drag the left edge to resize (panel is flush-right, so width = viewport − x)
  const onResizeDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const move = (ev: PointerEvent): void => setVizPanelWidth(window.innerWidth - ev.clientX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const popOut = (): void => {
    if (active) void window.api.openVizPopout(active)
  }

  return (
    <div className="viz-panel" style={{ width }}>
      <div className="viz-panel-resize" onPointerDown={onResizeDown} title="Drag to resize" />
      <div className="viz-panel-head">
        <select
          className="viz-panel-select"
          value={active ?? ''}
          onChange={(e) => setVizScope(e.target.value as VizScope)}
        >
          {available.map((s) => (
            <option key={s} value={s}>
              {VIZ_SCOPE_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="viz-panel-actions">
          <button
            className="viz-panel-btn"
            onClick={popOut}
            disabled={!active}
            title="Pop out into a floating window"
          >
            ⇱
          </button>
          <button className="viz-panel-btn" onClick={closeVizPanel} title="Close panel">
            ×
          </button>
        </div>
      </div>
      <div className="viz-panel-stage">
        {active ? (
          <VizCanvas key={active} scope={active} source={liveSource} fps={fps} />
        ) : (
          <div className="viz-empty">
            No visualizers enabled — turn some on in Settings → Display → Visualizers.
          </div>
        )}
      </div>
    </div>
  )
}
