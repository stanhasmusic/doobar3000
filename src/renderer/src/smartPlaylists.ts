import type { Track } from '../../shared/types'

// Smart playlists are derived live from the library, so they auto-update as
// tracks are imported, removed, or retagged — there's nothing to persist. Each
// is identified by a stable string id encoding its rule (e.g. 'genre:Trip-Hop').

// Master switch for the audio "vibe" feature. Cut for now (2026-06-13): three
// audio numbers + a genre nudge can't reliably capture mood, so we're parking it
// to focus on the core player. Everything below stays intact and dormant — flip
// this back to `true` to bring the ◓ buckets and their background analysis back.
export const VIBE_ENABLED = false

export type SmartKind = 'recent' | 'genre' | 'decade' | 'vibe'

export interface SmartPlaylist {
  id: string
  name: string
  kind: SmartKind
  icon: string
}

const RECENT_LIMIT = 50
// a genre/decade/vibe needs at least this many tracks to be worth its own playlist
const MIN_TRACKS = 2

const decadeOf = (year: number | null): number | null =>
  year && year > 0 ? Math.floor(year / 10) * 10 : null

// ─── Vibe (audio "mood") playlists ───────────────────────────────────────────
// Each track is placed in a fixed, named mood bucket by its analyzed sound:
// energy (reuses the EBU R128 `lufs`), brightness (mean spectral centroid), and
// tempo (`bpm`). The three features are normalized 0..1 across the *analyzed*
// part of the library, so the buckets are relative to your own collection. Each
// bucket is a prototype point in that normalized [energy, brightness, tempo]
// space; a track joins the nearest prototype. Coordinates are deliberately
// spread out and easy to tune.
type Vec3 = [number, number, number]

const VIBE_BUCKETS: { id: string; name: string; proto: Vec3 }[] = [
  { id: 'chill', name: 'Chill', proto: [0.25, 0.45, 0.35] },
  { id: 'mellow', name: 'Mellow', proto: [0.2, 0.13, 0.5] },
  { id: 'upbeat', name: 'Upbeat', proto: [0.6, 0.7, 0.62] },
  { id: 'energetic', name: 'Energetic', proto: [0.85, 0.6, 0.82] },
  // Dark = low-brightness but *not* low-energy (brooding/heavy), which keeps it
  // from competing with Mellow (low-brightness + low-energy, i.e. soft & warm)
  // for the same tracks — that overlap was dumping quiet jazz into Dark.
  { id: 'dark', name: 'Dark', proto: [0.55, 0.1, 0.45] }
]

// Per-axis weights in the nearest-prototype distance. Energy (lufs) is partly
// mastering loudness rather than musical energy, so it's down-weighted a touch
// to let brightness and tempo carry more of the decision.
const AXIS_WEIGHTS: Vec3 = [0.7, 1, 1]

// Genre nudge: three audio numbers can't tell that reggae *feels* chill — that's
// cultural knowledge living in the genre tag. So when a track has a clear genre,
// we give its matching mood bucket a head start (subtract GENRE_PULL from that
// bucket's squared distance). It's a nudge, not a verdict: the audio still
// decides, genre only tips close calls. Broad/ambiguous genres ("Electronica",
// "Other") are deliberately left out so they stay audio-driven.
const GENRE_PULL = 0.25
const GENRE_AFFINITY: { match: RegExp; bucket: string }[] = [
  { match: /reggae|ska|dub|roots/, bucket: 'chill' },
  { match: /jazz|bossa|swing|lounge/, bucket: 'mellow' },
  { match: /acoustic|folk|singer|country/, bucket: 'chill' },
  { match: /trip.?hop|down.?tempo|chill|ambient/, bucket: 'chill' },
  { match: /classical|piano|orchestr/, bucket: 'mellow' },
  { match: /grunge|metal|punk|hardcore|hard rock/, bucket: 'energetic' },
  { match: /\brock\b/, bucket: 'energetic' },
  { match: /trance|techno|drum.?&.?bass|\bdnb\b|hard.?style/, bucket: 'energetic' },
  { match: /house|disco|dance|pop|funk|soul|r&b|hip.?hop|rap/, bucket: 'upbeat' },
  { match: /industrial|doom|goth|darkwave|drone|black metal/, bucket: 'dark' }
]

/** The mood bucket a track's genre tag favors, or null if no clear match. */
function genreFavoredBucket(genre: string | null): string | null {
  const g = genre?.trim().toLowerCase()
  if (!g) return null
  for (const { match, bucket } of GENRE_AFFINITY) if (match.test(g)) return bucket
  return null
}

/** A track is "vibe-analyzed" once all three features are present. */
const vibeReady = (t: Track): boolean => t.lufs != null && t.brightness != null && t.bpm != null

/** Linear-interpolated percentile of a pre-sorted (ascending) array. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length <= 1) return sorted[0] ?? 0
  const idx = q * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** path → bucket id, for every fully-analyzed track in the library. */
function assignVibes(library: Track[]): Map<string, string> {
  const analyzed = library.filter(vibeReady)
  const out = new Map<string, string>()
  if (!analyzed.length) return out

  const raw: Vec3[] = analyzed.map((t) => [t.lufs!, t.brightness!, t.bpm!])
  // Normalize each axis to its robust 5th–95th-percentile range. Plain min-max
  // is too outlier-sensitive — a single very bright/loud track stretches the
  // scale and squashes everything else into one bucket — so we clamp the tails.
  const lo: Vec3 = [0, 0, 0]
  const hi: Vec3 = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const col = raw.map((v) => v[i]).sort((a, b) => a - b)
    lo[i] = percentile(col, 0.05)
    hi[i] = percentile(col, 0.95)
  }
  const norm = (v: Vec3): Vec3 =>
    v.map((x, i) =>
      hi[i] > lo[i] ? Math.min(1, Math.max(0, (x - lo[i]) / (hi[i] - lo[i]))) : 0.5
    ) as Vec3

  analyzed.forEach((t, k) => {
    const nv = norm(raw[k])
    const favored = genreFavoredBucket(t.genre)
    let best = VIBE_BUCKETS[0].id
    let bestD = Infinity
    for (const b of VIBE_BUCKETS) {
      let d =
        AXIS_WEIGHTS[0] * (nv[0] - b.proto[0]) ** 2 +
        AXIS_WEIGHTS[1] * (nv[1] - b.proto[1]) ** 2 +
        AXIS_WEIGHTS[2] * (nv[2] - b.proto[2]) ** 2
      if (b.id === favored) d -= GENRE_PULL
      if (d < bestD) {
        bestD = d
        best = b.id
      }
    }
    out.set(t.path, best)
  })
  return out
}

/** The smart playlists the current library warrants, in sidebar display order. */
export function smartPlaylists(library: Track[]): SmartPlaylist[] {
  if (!library.length) return []
  const out: SmartPlaylist[] = [
    { id: 'recent', name: 'Recently Added', kind: 'recent', icon: '✦' }
  ]

  // vibe buckets (by analyzed sound), in calm→energetic order, right under Recently Added
  if (VIBE_ENABLED) {
    const vibeCounts = new Map<string, number>()
    for (const id of assignVibes(library).values())
      vibeCounts.set(id, (vibeCounts.get(id) ?? 0) + 1)
    for (const b of VIBE_BUCKETS)
      if ((vibeCounts.get(b.id) ?? 0) >= MIN_TRACKS)
        out.push({ id: `vibe:${b.id}`, name: b.name, kind: 'vibe', icon: '◓' })
  }

  const genres = new Map<string, number>()
  const decades = new Map<number, number>()
  for (const t of library) {
    const g = t.genre?.trim()
    if (g) genres.set(g, (genres.get(g) ?? 0) + 1)
    const d = decadeOf(t.year)
    if (d !== null) decades.set(d, (decades.get(d) ?? 0) + 1)
  }

  // genres, busiest first
  for (const [g] of [...genres]
    .filter(([, n]) => n >= MIN_TRACKS)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
    out.push({ id: `genre:${g}`, name: g, kind: 'genre', icon: '◆' })

  // decades, oldest first
  for (const [d] of [...decades].filter(([, n]) => n >= MIN_TRACKS).sort((a, b) => a[0] - b[0]))
    out.push({ id: `decade:${d}`, name: `${d}s`, kind: 'decade', icon: '◷' })

  return out
}

/**
 * The tracks for a smart-playlist id. `sortable` is false for Recently Added,
 * whose whole point is newest-first order (like a manual playlist); genre,
 * decade, and vibe lists sort like the main library.
 */
export function resolveSmart(
  id: string,
  library: Track[]
): { tracks: Track[]; sortable: boolean } {
  if (id === 'recent')
    return {
      tracks: [...library].sort((a, b) => b.addedAt - a.addedAt).slice(0, RECENT_LIMIT),
      sortable: false
    }
  if (id.startsWith('genre:')) {
    const g = id.slice('genre:'.length)
    return { tracks: library.filter((t) => t.genre?.trim() === g), sortable: true }
  }
  if (id.startsWith('decade:')) {
    const d = Number(id.slice('decade:'.length))
    return { tracks: library.filter((t) => decadeOf(t.year) === d), sortable: true }
  }
  if (id.startsWith('vibe:')) {
    const b = id.slice('vibe:'.length)
    const map = assignVibes(library)
    return { tracks: library.filter((t) => map.get(t.path) === b), sortable: true }
  }
  return { tracks: [], sortable: true }
}

/** Display name for a smart-playlist id (for the status bar / titles). */
export function smartName(id: string): string {
  if (id === 'recent') return 'Recently Added'
  if (id.startsWith('genre:')) return id.slice('genre:'.length)
  if (id.startsWith('decade:')) return `${id.slice('decade:'.length)}s`
  if (id.startsWith('vibe:'))
    return VIBE_BUCKETS.find((b) => b.id === id.slice('vibe:'.length))?.name ?? 'Vibe'
  return ''
}
