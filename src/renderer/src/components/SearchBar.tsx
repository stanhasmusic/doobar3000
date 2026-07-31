import { useEffect, useRef } from 'react'
import { useStore } from '../store'

// The Ctrl+F bar. Deliberately not permanent chrome: it slides in over the list,
// takes focus, and Esc puts it away — the app's resting layout stays clean.
export function SearchBar({ matches }: { matches: number }) {
  const query = useStore((s) => s.searchQuery)
  const searchAll = useStore((s) => s.searchAll)
  const view = useStore((s) => s.view)
  const { setSearchQuery, setSearchAll, closeSearch } = useStore.getState()
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus on open, and again on every subsequent Ctrl+F — the bar is already
  // mounted by then, so a mount-only effect would silently do nothing.
  const focusNonce = useStore((s) => s.searchFocusNonce)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusNonce])

  const scoped = view.type !== 'library'
  return (
    <div className="search-bar">
      <span className="search-icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder={searchAll || !scoped ? 'Search library…' : 'Search this view…'}
        value={query}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            closeSearch()
          }
        }}
      />
      {query.trim() && (
        <span className="search-count">
          {matches.toLocaleString()} match{matches === 1 ? '' : 'es'}
        </span>
      )}
      {/* Only meaningful when the view is narrower than the library — in the
          library view there is nothing wider to widen to. */}
      {scoped && (
        <label className="search-all">
          <input
            type="checkbox"
            checked={searchAll}
            onChange={(e) => setSearchAll(e.target.checked)}
          />
          All library
        </label>
      )}
      <button className="search-close" onClick={closeSearch} title="Close (Esc)">
        ✕
      </button>
    </div>
  )
}
