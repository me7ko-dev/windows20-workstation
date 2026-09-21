/**
 * The infinite surface. Windows are positioned in *canvas* coordinates and the
 * whole plane is moved with one transform, so panning and zooming cost one
 * composited layer no matter how many windows are open — a terminal repainting
 * at 60fps would stutter badly if every window were re-laid-out per frame.
 */

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5

/** Below this, window contents are unreadable — so they stop being drawn. */
const DETAIL_ZOOM = 0.45

export function createCanvas(viewport, plane) {
  const view = { x: 0, y: 0, zoom: 1 }
  const listeners = new Set()

  function emit() {
    for (const fn of listeners) fn(view)
  }

  /**
   * Marks the canvas as moving until it settles. The expensive part of a window
   * is the blur behind it, which nobody can see mid-pan — the stylesheet drops
   * it while this class is on.
   */
  let settleTimer = 0
  function markMoving() {
    if (!settleTimer) viewport.classList.add('is-moving')
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = 0
      viewport.classList.remove('is-moving')
    }, 140)
  }

  function apply() {
    markMoving()
    viewport.classList.toggle('is-far', view.zoom < DETAIL_ZOOM)
    plane.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
    viewport.style.setProperty('--grid-size', `${32 * view.zoom}px`)
    viewport.style.setProperty('--grid-x', `${view.x}px`)
    viewport.style.setProperty('--grid-y', `${view.y}px`)
    emit()
  }

  /** Screen pixel → canvas coordinate. Needed to drop a window where the cursor is. */
  function toCanvas(clientX, clientY) {
    const rect = viewport.getBoundingClientRect()
    return {
      x: (clientX - rect.left - view.x) / view.zoom,
      y: (clientY - rect.top - view.y) / view.zoom
    }
  }

  function zoomAt(clientX, clientY, factor) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor))
    if (next === view.zoom) return
    const rect = viewport.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    // Keep the point under the cursor fixed while the scale changes.
    view.x = px - ((px - view.x) / view.zoom) * next
    view.y = py - ((py - view.y) / view.zoom) * next
    view.zoom = next
    apply()
  }

  function panBy(dx, dy) {
    view.x += dx
    view.y += dy
    apply()
  }

  /** Centre the viewport on a canvas rect, optionally fitting it. */
  function focus(rect, { fit = false, padding = 120 } = {}) {
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    if (fit && rect.width && rect.height) {
      const scale = Math.min((vw - padding * 2) / rect.width, (vh - padding * 2) / rect.height)
      view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
    }
    view.x = vw / 2 - (rect.x + (rect.width || 0) / 2) * view.zoom
    view.y = vh / 2 - (rect.y + (rect.height || 0) / 2) * view.zoom
    apply()
  }

  /**
   * What the viewport currently covers, in canvas coordinates. Windows outside
   * it are not painted — with a few hundred open, painting them all is the
   * difference between a smooth pan and a slideshow.
   */
  function visibleRect(margin = 0) {
    const m = margin / view.zoom
    return {
      left: -view.x / view.zoom - m,
      top: -view.y / view.zoom - m,
      right: (viewport.clientWidth - view.x) / view.zoom + m,
      bottom: (viewport.clientHeight - view.y) / view.zoom + m
    }
  }

  function setView(next) {
    if (!next) return
    view.x = next.x ?? view.x
    view.y = next.y ?? view.y
    view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom ?? view.zoom))
    apply()
  }

  /* ------------------------------------------------------------ input */

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12)
      } else {
        panBy(-e.deltaX, -e.deltaY)
      }
    },
    { passive: false }
  )

  let panning = null

  viewport.addEventListener('pointerdown', (e) => {
    const onBackground = e.target === viewport || e.target === plane || e.target.classList.contains('w20-plane-bg')
    const wantsPan = e.button === 1 || (e.button === 0 && onBackground)
    if (!wantsPan) return
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY }
    viewport.setPointerCapture(e.pointerId)
    viewport.classList.add('is-panning')
  })

  viewport.addEventListener('pointermove', (e) => {
    if (!panning || panning.id !== e.pointerId) return
    panBy(e.clientX - panning.x, e.clientY - panning.y)
    panning.x = e.clientX
    panning.y = e.clientY
  })

  function endPan(e) {
    if (!panning || panning.id !== e.pointerId) return
    panning = null
    viewport.classList.remove('is-panning')
    try {
      viewport.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released by the browser
    }
  }
  viewport.addEventListener('pointerup', endPan)
  viewport.addEventListener('pointercancel', endPan)

  apply()

  return {
    view,
    toCanvas,
    panBy,
    focus,
    setView,
    visibleRect,
    zoomIn: () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1.2),
    zoomOut: () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1 / 1.2),
    resetZoom: () => setView({ zoom: 1 }),
    /** Where a new window should land: the middle of what the user is looking at. */
    viewportCenter: () => toCanvas(
      viewport.getBoundingClientRect().left + viewport.clientWidth / 2,
      viewport.getBoundingClientRect().top + viewport.clientHeight / 2
    ),
    onChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
