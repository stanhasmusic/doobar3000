import { useEffect, useRef, useState } from 'react'
import type { RadioStation, Station } from '../../../shared/types'
import { useStore } from '../store'

// A small hand-picked set of reliable streams so the Known Stations tab is never
// empty on first open. It's shown beneath the stations you've played this
// session; Phase D4 turns this tab into persisted favorites (radio.json).
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

type Tab = 'search' | 'known'

export function RadioDialog({ onClose }: { onClose: () => void }) {
  const currentStation = useStore((s) => s.currentStation)
  const recentStations = useStore((s) => s.recentStations)
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

  // Known tab = stations played this session, then the seed list, de-duped by url
  const knownUrls = new Set(recentStations.map((s) => s.url))
  const known: Station[] = [...recentStations, ...SEEDS.filter((s) => !knownUrls.has(s.url))]
  const rows: Station[] | null = tab === 'known' ? known : results

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
            className={`radio-tab ${tab === 'known' ? 'active' : ''}`}
            onClick={() => setTab('known')}
          >
            Known Stations
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
          {rows === null ? (
            <div className="radio-empty">Search by name, tag, or country to find stations.</div>
          ) : rows.length === 0 ? (
            <div className="radio-empty">
              {searching ? 'Searching…' : 'No stations matched — try a broader search.'}
            </div>
          ) : (
            <div className="station-list">
              {rows.map((st) => {
                const live = currentStation?.url === st.url
                return (
                  <div className={`station-row ${live ? 'live' : ''}`} key={st.id}>
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
