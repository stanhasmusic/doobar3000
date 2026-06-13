import type { Track } from '../../shared/types'

// Smart playlists are derived live from the library, so they auto-update as
// tracks are imported, removed, or retagged — there's nothing to persist. Each
// is identified by a stable string id encoding its rule (e.g. 'genre:Trip-Hop').

export type SmartKind = 'recent' | 'genre' | 'decade'

export interface SmartPlaylist {
  id: string
  name: string
  kind: SmartKind
  icon: string
}

const RECENT_LIMIT = 50
// a genre/decade needs at least this many tracks to be worth its own playlist
const MIN_TRACKS = 2

const decadeOf = (year: number | null): number | null =>
  year && year > 0 ? Math.floor(year / 10) * 10 : null

/** The smart playlists the current library warrants, in sidebar display order. */
export function smartPlaylists(library: Track[]): SmartPlaylist[] {
  if (!library.length) return []
  const out: SmartPlaylist[] = [
    { id: 'recent', name: 'Recently Added', kind: 'recent', icon: '✦' }
  ]

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
 * whose whole point is newest-first order (like a manual playlist); genre and
 * decade lists sort like the main library.
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
  return { tracks: [], sortable: true }
}

/** Display name for a smart-playlist id (for the status bar / titles). */
export function smartName(id: string): string {
  if (id === 'recent') return 'Recently Added'
  if (id.startsWith('genre:')) return id.slice('genre:'.length)
  if (id.startsWith('decade:')) return `${id.slice('decade:'.length)}s`
  return ''
}
