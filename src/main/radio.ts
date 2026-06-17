// radio-browser client: searches the community radio directory for stations.
// Like art.ts/acoustid.ts this lives in the main process (no CORS, real
// User-Agent). radio-browser asks clients to (a) send a descriptive UA and
// (b) spread load across its mirrors rather than hammering one host — so we
// resolve the round-robin DNS name `all.api.radio-browser.info` to the live
// server list and pick one per session. Playback itself goes through the
// radio:// proxy (index.ts); this module only finds stations.

import { net } from 'electron'
import dns from 'node:dns/promises'
import type { RadioQuery, RadioStation } from '../shared/types'

const UA = 'Doobar3000/0.3 (stanhasmusic@gmail.com)'

// Hardcoded fallbacks in case DNS discovery fails (offline-ish / locked-down
// networks). These are stable radio-browser mirrors.
const FALLBACK_HOSTS = ['de2.api.radio-browser.info', 'at1.api.radio-browser.info']

let baseHostP: Promise<string> | null = null

// Resolve the round-robin name to its A records, reverse-lookup each to a real
// mirror hostname, and keep one at random for the whole session.
async function pickHost(): Promise<string> {
  try {
    const ips = await dns.resolve4('all.api.radio-browser.info')
    const names: string[] = []
    for (const ip of ips) {
      try {
        const [host] = await dns.reverse(ip)
        if (host) names.push(host)
      } catch {
        /* skip an IP with no PTR record */
      }
    }
    const pool = names.length ? names : FALLBACK_HOSTS
    return pool[Math.floor(Math.random() * pool.length)]
  } catch {
    return FALLBACK_HOSTS[Math.floor(Math.random() * FALLBACK_HOSTS.length)]
  }
}

function host(): Promise<string> {
  if (!baseHostP) baseHostP = pickHost()
  return baseHostP
}

// the raw shape radio-browser returns (only the fields we use)
interface RbStation {
  stationuuid: string
  name: string
  url_resolved?: string
  url: string
  codec: string
  bitrate: number
  votes: number
  countrycode?: string
  country?: string
  favicon?: string
  hls?: number
}

export async function searchStations(query: RadioQuery): Promise<RadioStation[]> {
  const params = new URLSearchParams({
    hidebroken: 'true',
    order: 'votes',
    reverse: 'true',
    limit: '100'
  })
  if (query.name?.trim()) params.set('name', query.name.trim())
  if (query.tag?.trim()) params.set('tag', query.tag.trim())
  if (query.country?.trim()) params.set('country', query.country.trim())

  let rows: RbStation[]
  try {
    const h = await host()
    const res = await net.fetch(`https://${h}/json/stations/search?${params}`, {
      headers: { 'User-Agent': UA }
    })
    if (!res.ok) return []
    rows = (await res.json()) as RbStation[]
  } catch (err) {
    console.error('radio-browser search failed:', err)
    // a dead mirror shouldn't poison the rest of the session
    baseHostP = null
    return []
  }

  return rows
    .map((r) => ({ ...r, stream: r.url_resolved || r.url }))
    // HLS won't play through a single proxied stream — drop it (v1 codec scope)
    .filter((r) => r.hls !== 1 && !!r.stream && !/\.m3u8(\?|$)/i.test(r.stream))
    .map(
      (r): RadioStation => ({
        id: r.stationuuid,
        name: r.name.trim() || '(unnamed station)',
        url: r.stream,
        codec: (r.codec || '').toUpperCase(),
        bitrate: r.bitrate || 0,
        country: r.country || r.countrycode || '',
        favicon: r.favicon || undefined,
        votes: r.votes || 0
      })
    )
}
