import type { Track } from '../../shared/types'
import type { SortKey } from './store'

// Text matching for the search bar and the type-ahead jump. Both need the same
// notion of "same string" — a user typing `bjork` should reach Björk, and typing
// `PANIC` should reach "Panic! At The Disco" — so normalization lives here once
// rather than being re-derived slightly differently in each feature.
export function normalize(s: string): string {
  // NFD splits an accented letter into base + combining mark; dropping the marks
  // leaves the plain ASCII letter, which is what an English keyboard produces.
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Fields the search bar looks at — the ones a person searches a music library by. */
const SEARCH_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'genre'] as const

/**
 * path → one normalized blob per track, built once per library rather than per
 * keystroke. At 58k tracks re-normalizing five fields on every character typed
 * is tens of milliseconds of jank; a prebuilt blob makes each keystroke a
 * handful of substring scans.
 */
export function buildHaystacks(library: Track[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of library) {
    map.set(t.path, normalize(SEARCH_FIELDS.map((f) => t[f] ?? '').join(' ')))
  }
  return map
}

/**
 * All terms must match, in any field and any order, so "panic dance" finds
 * "Time to Dance" by "Panic! At The Disco" — the way people actually half-remember
 * a track. A single term behaves like a plain substring search.
 */
export function filterTracks(
  tracks: Track[],
  query: string,
  haystacks: Map<string, string>
): Track[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return tracks
  return tracks.filter((t) => {
    const hay = haystacks.get(t.path)
    if (hay === undefined) return false
    return terms.every((term) => hay.includes(term))
  })
}

/**
 * The value the type-ahead compares against: whatever the list is sorted by, so
 * typing follows the column you're actually looking at. Numeric columns get their
 * digits, which makes typing "198" under a Year sort land on the 1980s.
 */
export function typeaheadValue(t: Track, key: SortKey): string {
  const raw = t[key as keyof Track]
  return normalize(String(raw ?? ''))
}
