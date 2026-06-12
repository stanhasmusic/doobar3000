import { formatTime, trackByPath, useStore } from '../store'
import { SettingsMenu } from './SettingsMenu'
import { Spectrum, VuMeter } from './Visualizers'

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
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z'
}

export function TopBar() {
  const playing = useStore((s) => s.playing)
  const currentPath = useStore((s) => s.currentPath)
  const position = useStore((s) => s.position)
  const volume = useStore((s) => s.volume)
  const library = useStore((s) => s.library)
  const { togglePlay, next, prev, setVolume } = useStore.getState()

  const track = trackByPath(library, currentPath)

  return (
    <div className="topbar">
      <div className="transport">
        <button className="btn-icon" onClick={prev} title="Previous">
          <Icon d={PATHS.prev} />
        </button>
        <button className="btn-icon btn-play" onClick={togglePlay} title="Play/Pause">
          <Icon d={playing ? PATHS.pause : PATHS.play} size={22} />
        </button>
        <button className="btn-icon" onClick={next} title="Next">
          <Icon d={PATHS.next} />
        </button>
      </div>

      <div className="now-playing">
        {track ? (
          <>
            <div className="np-title">{track.title}</div>
            <div className="np-sub">
              {track.artist} — {track.album}
            </div>
            <div className="np-time">
              {formatTime(position)} / {formatTime(track.duration)}
            </div>
          </>
        ) : (
          <div className="np-idle">Doobar 3000</div>
        )}
      </div>

      <div className="viz">
        <Spectrum />
        <VuMeter />
      </div>

      <SettingsMenu />

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
    </div>
  )
}
