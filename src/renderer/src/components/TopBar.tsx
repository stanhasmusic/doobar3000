import { useEffect, useState } from 'react'
import {
  ALL_VIZ_SCOPES,
  VIZ_SCOPE_LABELS,
  type TopbarWidget,
  type VizScope
} from '../../../shared/types'
import { formatChip, formatTime, trackByPath, useStore } from '../store'
import { LogoMark } from './LogoMark'
import { SettingsMenu } from './SettingsMenu'
import { Spectrum, VuMeter } from './Visualizers'
import { VIZ_PANEL_ENABLED } from './VizPanel'
import { clampToViewport } from '../clampMenu'
import { VIZ_FPS_OPTIONS } from '../vizFps'

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d={d} />
  </svg>
)

const PATHS = {
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M16 6h2v12h-2zm-1.5 6L6 18V6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  shuffle:
    'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'
}

const WIDGET_LABELS: Record<TopbarWidget, string> = {
  logo: 'Doobar 3000',
  transport: 'Transport',
  nowPlaying: 'Now playing',
  viz: 'Visualizers',
  settings: 'Settings',
  volume: 'Volume'
}

interface Drag {
  key: TopbarWidget
  x: number
  y: number
  over: TopbarWidget | null
}

export function TopBar() {
  const playing = useStore((s) => s.playing)
  const currentPath = useStore((s) => s.currentPath)
  const station = useStore((s) => s.currentStation)
  const stationTitle = useStore((s) => s.stationTitle)
  const position = useStore((s) => s.position)
  const volume = useStore((s) => s.volume)
  const library = useStore((s) => s.library)
  const shuffle = useStore((s) => s.shuffle)
  const repeat = useStore((s) => s.repeat)
  const layout = useStore((s) => s.topbarLayout)
  const nerdMode = useStore((s) => s.nerdMode)
  const visualizers = useStore((s) => s.visualizers)
  const vizFps = useStore((s) => s.vizFps)
  const { togglePlay, next, prev, setVolume, toggleShuffle, cycleRepeat } = useStore.getState()

  const [arranging, setArranging] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [vizMenu, setVizMenu] = useState<{ x: number; y: number } | null>(null)
  const [fpsMenu, setFpsMenu] = useState<{ x: number; y: number } | null>(null)

  // Clicking the viz widget either toggles the docked panel (if enabled) or opens
  // a menu to pop a scope into its own window (the panel is parked by default).
  const onVizClick = (e: React.MouseEvent): void => {
    if (VIZ_PANEL_ENABLED) {
      useStore.getState().toggleVizPanel()
      return
    }
    e.stopPropagation() // don't let this click immediately dismiss the menu
    setVizMenu({ x: e.clientX, y: e.clientY })
  }

  // Right-clicking the viz widget picks the render-rate cap (it stops propagation
  // so the top-bar's own context menu doesn't open instead).
  const onVizContext = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setFpsMenu({ x: e.clientX, y: e.clientY })
  }

  const track = trackByPath(library, currentPath)

  // Dismiss the right-click menu on any click (matches the column-header menu).
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  // Same for the viz pop-out menu.
  useEffect(() => {
    if (!vizMenu) return
    const close = () => setVizMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [vizMenu])

  // …and the render-rate menu.
  useEffect(() => {
    if (!fpsMenu) return
    const close = () => setFpsMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [fpsMenu])

  // Esc leaves rearrange mode (so does the Done pill / clicking outside the bar).
  // Click-away uses pointerdown so it never fires mid-drag (a widget drag starts
  // on a pointerdown inside the bar).
  useEffect(() => {
    if (!arranging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArranging(false)
    }
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest?.('.topbar')) setArranging(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [arranging])

  // The inner content of each widget, keyed. Rendered in `layout` order below.
  const content: Record<TopbarWidget, React.ReactNode> = {
    logo: <LogoMark />,
    transport: (
      <div className="transport">
        <button
          className={`btn-icon ${shuffle ? 'active' : ''}`}
          onClick={toggleShuffle}
          title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
        >
          <Icon d={PATHS.shuffle} size={15} />
        </button>
        <button className="btn-icon" onClick={prev} title="Previous">
          <Icon d={PATHS.prev} />
        </button>
        <button className="btn-icon btn-play" onClick={togglePlay} title="Play/Pause">
          <Icon d={playing ? PATHS.pause : PATHS.play} size={22} />
        </button>
        <button className="btn-icon" onClick={next} title="Next">
          <Icon d={PATHS.next} />
        </button>
        <button
          className={`btn-icon ${repeat !== 'off' ? 'active' : ''}`}
          onClick={cycleRepeat}
          title={`Repeat: ${repeat}`}
        >
          <span className="icon-stack">
            <Icon d={PATHS.repeat} size={15} />
            {repeat === 'one' && <span className="repeat-one">1</span>}
          </span>
        </button>
      </div>
    ),
    nowPlaying: (
      <div className="now-playing">
        {station ? (
          // Radio: the current song (from ICY metadata) is the headline once it
          // arrives; the station name drops to the sub-line. Until then the
          // station name is the headline. Nerd mode adds a stream-format chip.
          <>
            <div className="np-title">{stationTitle || station.name}</div>
            <div className="np-sub">
              {stationTitle
                ? station.name
                : [station.codec?.toUpperCase(), station.bitrate ? `${station.bitrate}kbps` : '']
                    .filter(Boolean)
                    .join(' · ') || 'Internet radio'}
            </div>
            <div className="np-time">
              <span className="np-live">● LIVE</span>
              {nerdMode && (station.codec || station.bitrate) && (
                <span className="np-format" title="radio stream format">
                  {[station.codec?.toUpperCase(), station.bitrate ? `${station.bitrate}k` : '']
                    .filter(Boolean)
                    .join(' ')}
                </span>
              )}
            </div>
          </>
        ) : track ? (
          <>
            <div className="np-title">{track.title}</div>
            <div className="np-sub">
              {track.artist} — {track.album}
            </div>
            <div className="np-time">
              {formatTime(position)} / {formatTime(track.duration)}
              {nerdMode && formatChip(track) && (
                <span className="np-format" title="source format → output mix (WASAPI shared)">
                  {formatChip(track)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="np-idle">Doobar 3000</div>
        )}
      </div>
    ),
    viz: (
      <div
        className={`viz ${nerdMode && !arranging ? 'viz-expandable' : ''}`}
        onClick={nerdMode && !arranging ? onVizClick : undefined}
        onContextMenu={nerdMode && !arranging ? onVizContext : undefined}
        title={
          nerdMode && !arranging
            ? VIZ_PANEL_ENABLED
              ? 'Toggle visualizer panel'
              : 'Pop out a visualizer · right-click for frame rate'
            : undefined
        }
      >
        <Spectrum />
        <VuMeter />
      </div>
    ),
    settings: <SettingsMenu />,
    volume: (
      <div className="volume">
        <Icon d={PATHS.volume} size={15} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    )
  }

  // True swap: the dragged widget and its drop target trade places.
  const swap = (a: TopbarWidget, b: TopbarWidget) => {
    if (a === b) return
    const cur = useStore.getState().topbarLayout
    const ia = cur.indexOf(a)
    const ib = cur.indexOf(b)
    if (ia < 0 || ib < 0) return
    const next = [...cur]
    ;[next[ia], next[ib]] = [next[ib], next[ia]]
    useStore.getState().setTopbarLayout(next)
  }

  const widgetAt = (x: number, y: number): TopbarWidget | null =>
    (document
      .elementFromPoint(x, y)
      ?.closest('[data-widgetkey]')
      ?.getAttribute('data-widgetkey') ?? null) as TopbarWidget | null

  // In rearrange mode, pressing a widget drags it: a floating chip follows the
  // cursor, the hovered target animates, and release swaps. Inner controls are
  // suspended (CSS) while arranging, so the grab never triggers play/volume/etc.
  const widgetPointerDown = (e: React.PointerEvent, key: TopbarWidget) => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
      moved = true
      const over = widgetAt(ev.clientX, ev.clientY)
      setDrag({ key, x: ev.clientX, y: ev.clientY, over: over && over !== key ? over : null })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        const over = widgetAt(ev.clientX, ev.clientY)
        if (over) swap(key, over)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`topbar ${arranging ? 'arranging' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {layout.map((key) => (
        <div
          key={key}
          data-widgetkey={key}
          className={`tb-widget ${arranging ? 'tb-edit' : ''} ${
            drag?.key === key ? 'tb-dragging' : ''
          } ${drag?.over === key ? 'tb-over' : ''}`}
          title={arranging ? `Drag to move ${WIDGET_LABELS[key]}` : undefined}
          onPointerDown={arranging ? (e) => widgetPointerDown(e, key) : undefined}
        >
          <div className="tb-content">{content[key]}</div>
        </div>
      ))}

      {arranging && (
        <button className="tb-done" onClick={() => setArranging(false)}>
          Done
        </button>
      )}

      {drag && (
        <div className="tb-drag-chip" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {WIDGET_LABELS[drag.key]}
        </div>
      )}

      {vizMenu && (
        <div ref={clampToViewport} className="context-menu" style={{ left: vizMenu.x, top: vizMenu.y }}>
          <div className="menu-head">Pop out visualizer</div>
          {ALL_VIZ_SCOPES.filter((s) => visualizers.includes(s)).map((s) => (
            <div
              key={s}
              className="menu-item"
              onClick={() => {
                void window.api.openVizPopout(s as VizScope)
                setVizMenu(null)
              }}
            >
              ⇱ {VIZ_SCOPE_LABELS[s]}
            </div>
          ))}
        </div>
      )}

      {fpsMenu && (
        <div ref={clampToViewport} className="context-menu" style={{ left: fpsMenu.x, top: fpsMenu.y }}>
          <div className="menu-head">Frame-rate cap</div>
          {VIZ_FPS_OPTIONS.map((f) => (
            <div
              key={f}
              className="menu-item"
              onClick={() => {
                useStore.getState().setVizFps(f)
                setFpsMenu(null)
              }}
            >
              {f === vizFps ? '✓' : '  '} {f} fps
            </div>
          ))}
        </div>
      )}

      {menu && (
        <div ref={clampToViewport} className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="menu-head">Top bar</div>
          {!arranging && (
            <div
              className="menu-item"
              onClick={() => {
                setArranging(true)
                setMenu(null)
              }}
            >
              Rearrange…
            </div>
          )}
          {arranging && (
            <div
              className="menu-item"
              onClick={() => {
                setArranging(false)
                setMenu(null)
              }}
            >
              Done
            </div>
          )}
          <div
            className="menu-item"
            onClick={() => {
              useStore.getState().resetTopbarLayout()
              setMenu(null)
            }}
          >
            Reset layout
          </div>
        </div>
      )}
    </div>
  )
}
