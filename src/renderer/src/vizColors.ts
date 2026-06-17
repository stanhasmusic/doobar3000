import { type Theme } from '../../shared/types'

// Theme color application + the canvas-visualizer color snapshot, kept free of any
// `audio`/`store` imports so the pop-out visualizer windows can apply the theme and
// read colors without instantiating a second AudioContext or the whole app store.

// Themes are driven by CSS variables; presets live in styles.css under
// `:root[data-theme='…']`. 'custom' reuses the dark base and overrides the accent.
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.slice(1)
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// Set the document theme + accent vars and refresh the canvas color snapshot.
// Does NOT touch the native titlebar overlay (that's main-window only — see
// applyTheme in store.ts, which wraps this).
export function applyThemeColors(theme: Theme, accentColor: string): void {
  const root = document.documentElement
  root.dataset.theme = theme === 'custom' ? 'dark' : theme
  const accentVars = ['--accent', '--accent-hover', '--accent-soft'] as const
  if (theme === 'custom' && HEX.test(accentColor)) {
    root.style.setProperty('--accent', accentColor)
    root.style.setProperty('--accent-hover', accentColor)
    root.style.setProperty('--accent-soft', hexToRgba(accentColor, 0.16))
  } else {
    for (const v of accentVars) root.style.removeProperty(v)
  }
  refreshVizColors()
}

// Canvas visualizers (spectrum, waveform, VU) can't read CSS vars directly, so we
// snapshot the active theme's colors here and refresh on every theme change.
// Spectrum/waveform tones derive from the accent so a Custom accent flows through too.
export const vizColors = {
  accent: '#e0556e',
  accentLight: '#ff9aa8',
  accentDark: '#8a3b50',
  text: '#e8e8ec',
  faint: '#45454e',
  track: '#2a2a31'
}
const readVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(c: [number, number, number], t: [number, number, number], k: number): string {
  const m = (a: number, b: number): number => Math.round(a + (b - a) * k)
  return `rgb(${m(c[0], t[0])}, ${m(c[1], t[1])}, ${m(c[2], t[2])})`
}
export function refreshVizColors(): void {
  const accent = readVar('--accent') || '#e0556e'
  const rgb = toRgb(accent)
  vizColors.accent = accent
  vizColors.accentLight = mix(rgb, [255, 255, 255], 0.45)
  vizColors.accentDark = mix(rgb, [0, 0, 0], 0.4)
  vizColors.text = readVar('--text') || '#e8e8ec'
  vizColors.faint = readVar('--text-faint') || '#45454e'
  vizColors.track = readVar('--border') || '#2a2a31'
}
