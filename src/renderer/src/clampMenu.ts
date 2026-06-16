// Callback ref for a `position: fixed` popup/context menu. Menus open at the
// cursor, so one opened near the right or bottom edge of the window would spill
// off-screen. Once the element has rendered (and its size is known), nudge it
// back so it stays fully visible.
export function clampToViewport(el: HTMLDivElement | null): void {
  if (!el) return
  const pad = 8
  const r = el.getBoundingClientRect()
  const maxLeft = Math.max(pad, window.innerWidth - r.width - pad)
  const maxTop = Math.max(pad, window.innerHeight - r.height - pad)
  if (r.left > maxLeft) el.style.left = `${maxLeft}px`
  if (r.top > maxTop) el.style.top = `${maxTop}px`
}
