import { useEffect, useRef, useState } from 'react'
import type { RadioStation, Station } from '../../../shared/types'
import { useStore } from '../store'

// A small hand-picked set of reliable streams so the Recent tab is never empty on
// first run. Shown only when you haven't played anything yet; once you do, your
// own play-history (persisted in radio.json) takes over.
const SEEDS: Station[] = [
  {
    id: 'seed-groovesalad',
    name: 'SomaFM — Groove Salad',
    url: 'http://ice1.somafm.com/groovesalad-128-mp3',
    codec: 'MP3',
    bitrate: 128,
    country: 'United States'
  },
  {
    id: 'seed-dronezone',
    name: 'SomaFM — Drone Zone',
    url: 'http://ice1.somafm.com/dronezone-128-mp3',
    codec: 'MP3',
    bitrate: 128,
    country: 'United States'
  },
  {
    id: 'seed-secretagent',
    name: 'SomaFM — Secret Agent',
    url: 'http://ice1.somafm.com/secretagent-128-mp3',
    codec: 'MP3',
    bitrate: 128,
    country: 'United States'
  }
]

type Tab = 'search' | 'favorites' | 'recent'

export function RadioDialog({ onClose }: { onClose: () => void }) {
  const currentStation = useStore((s) => s.currentStation)
  const recentStations = useStore((s) => s.recentStations)
  const favorites = useStore((s) => s.favorites)
  const [tab, setTab] = useState<Tab>('search')
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [country, setCountry] = useState('')
  const [results, setResults] = useState<RadioStation[] | null>(null)
  const [searching, setSearching] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    nameRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const search = async () => {
    if (!name.trim() && !tag.trim() && !country.trim()) return
    setSearching(true)
    setResults(null)
    try {
      const r = await window.api.radioSearch({ name, tag, country })
      setResults(r)
    } finally {
      setSearching(false)
    }
  }

  const play = (station: Station) => {
    useStore.getState().playStation(station)
    onClose()
  }

  const favUrls = new Set(favorites.map((s) => s.url))

  // Recent = your play-history; fall back to the seed list while it's empty so
  // there's always something to play on first run.
  const recent: Station[] = recentStations.length ? recentStations : SEEDS
  const rows: Station[] | null =
    tab === 'search' ? results : tab === 'favorites' ? favorites : recent

  const emptyMsg =
    tab === 'search'
      ? searching
        ? 'Searching…'
        : results === null
          ? 'Search by name, tag, or country to find stations.'
          : 'No stations matched — try a broader search.'
      : tab === 'favorites'
        ? 'No favorites yet — tap ☆ on any station to save it here.'
        : 'No stations played yet.'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-radio" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Internet radio</div>
            <div className="modal-sub">Search thousands of stations · radio-browser.info</div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="radio-tabs">
          <button
            className={`radio-tab ${tab === 'search' ? 'active' : ''}`}
            onClick={() => setTab('search')}
          >
            Search
          </button>
          <button
            className={`radio-tab ${tab === 'favorites' ? 'active' : ''}`}
            onClick={() => setTab('favorites')}
          >
            Favorites
          </button>
          <button
            className={`radio-tab ${tab === 'recent' ? 'active' : ''}`}
            onClick={() => setTab('recent')}
          >
            Recent
          </button>
        </div>

        {tab === 'search' && (
          <form
            className="radio-search"
            onSubmit={(e) => {
              e.preventDefault()
              void search()
            }}
          >
            <input
              ref={nameRef}
              placeholder="Name (e.g. SomaFM)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              placeholder="Tag (e.g. jazz)"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
            <input
              placeholder="Country (e.g. Germany)"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
            <button className="btn-apply" type="submit" disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
        )}

        <div className="modal-body radio-results">
          {rows === null || rows.length === 0 ? (
            <div className="radio-empty">{emptyMsg}</div>
          ) : (
            <div className="station-list">
              {rows.map((st) => {
                const live = currentStation?.url === st.url
                const faved = favUrls.has(st.url)
                return (
                  <div className={`station-row ${live ? 'live' : ''}`} key={st.id}>
                    <button
                      className={`station-star ${faved ? 'on' : ''}`}
                      title={faved ? 'Remove from favorites' : 'Add to favorites'}
                      onClick={() => useStore.getState().toggleFavorite(st)}
                    >
                      {faved ? '★' : '☆'}
                    </button>
                    <div className="station-main">
                      <div className="station-name">
                        {st.name}
                        {live ? ' · ♪ playing' : ''}
                      </div>
                      <div className="station-meta">
                        {[st.codec, st.bitrate ? `${st.bitrate}k` : null, st.country]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {tab === 'search' && (
                      <div className="station-votes" title="listener votes">
                        ▲ {(st as RadioStation).votes}
                      </div>
                    )}
                    <button className="btn-apply" onClick={() => play(st)}>
                      Play
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
