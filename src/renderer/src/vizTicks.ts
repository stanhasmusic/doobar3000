// Adaptive axis tick selection for the nerd-mode visualizers. Given a
// prioritized candidate list, keep the highest-priority ticks that still sit at
// least `minPx` apart along the axis — so a narrow widget shows just a few
// landmarks and a wide one fills the empty space with finer graduations. Pure
// (no audio/store imports) so the pop-out scope renderer can use it too.

export interface Tick {
  label: string
  frac: number // 0..1 position along the axis (caller maps Hz/dB → frac)
}

// Frequency markers, ordered most- to least-important: decade landmarks first,
// then the half-decades, then the in-between fillers. Callers map Hz → frac with
// their own log scale; anything that lands outside [0,1] is dropped by fitTicks.
const FREQ_CANDIDATES: { f: number; label: string }[] = [
  { f: 1000, label: '1k' },
  { f: 100, label: '100' },
  { f: 10000, label: '10k' },
  { f: 30, label: '30' },
  { f: 300, label: '300' },
  { f: 3000, label: '3k' },
  { f: 50, label: '50' },
  { f: 200, label: '200' },
  { f: 500, label: '500' },
  { f: 2000, label: '2k' },
  { f: 5000, label: '5k' },
  { f: 15000, label: '15k' }
]

// dB marks for the linear VU scale, most- to least-important. The 12 dB grid
// (0/−12/−24/−36) wins first, then the 6 dB marks, then the 3 dB ones.
const DB_CANDIDATES = [0, -12, -24, -36, -6, -18, -30, -3, -9, -42]

// Greedy: walk candidates in priority order, keeping one only if it clears
// `minPx` from every tick already kept. Out-of-range ticks are skipped. The
// result is sorted by position so callers can treat first/last as the edges.
export function fitTicks(candidates: Tick[], lengthPx: number, minPx: number): Tick[] {
  const kept: Tick[] = []
  for (const c of candidates) {
    if (c.frac < 0 || c.frac > 1) continue
    const px = c.frac * lengthPx
    if (kept.every((k) => Math.abs(k.frac * lengthPx - px) >= minPx)) kept.push(c)
  }
  return kept.sort((a, b) => a.frac - b.frac)
}

export function pickFreqTicks(
  freqFrac: (f: number) => number,
  lengthPx: number,
  minPx: number
): Tick[] {
  return fitTicks(
    FREQ_CANDIDATES.map((c) => ({ label: c.label, frac: freqFrac(c.f) })),
    lengthPx,
    minPx
  )
}

export function pickDbTicks(dbFrac: (db: number) => number, lengthPx: number, minPx: number): Tick[] {
  return fitTicks(
    DB_CANDIDATES.map((db) => ({ label: String(db), frac: dbFrac(db) })),
    lengthPx,
    minPx
  )
}
