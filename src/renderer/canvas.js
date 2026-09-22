/**
 * The infinite surface. Windows are positioned in *canvas* coordinates and the
 * whole plane is moved with one transform, so panning and zooming cost one
 * composited layer no matter how many windows are open — a terminal repainting
 * at 60fps would stutter badly if every window were re-laid-out per frame.
 *
 * Input never touches the DOM directly. A wheel notch or a pointer move only
 * adds to what is pending; one animation frame turns all of it into a single
 * write. That is what makes a 144 Hz screen worth having: a gaming mouse sends
 * a thousand moves a second, and writing a transform for each one means seven
 * layouts per frame and a browser that falls behind the hand holding it.
 */

/**
 * The floor is deliberately low. A workspace spread over a few thousand pixels
 * has to be able to fit on screen in one move, and at 0.2 "fit everything"
 * failed as soon as the work was wider than five screens — which is nothing at
 * all on an infinite canvas; three hundred windows reach fifty. Nothing inside
 * a window is drawn below DETAIL_ZOOM anyway, so the widest view is also the
 * cheapest one: a map of coloured frames.
 */
const MIN_ZOOM = 0.02
const MAX_ZOOM = 2.5

/** Below this, window contents are unreadable — so they stop being drawn. */
const DETAIL_ZOOM = 0.45

/** Time constants, in milliseconds. Framerate-independent by construction. */
const ZOOM_TAU = 55 // how quickly the zoom catches up with the wheel
const GLIDE_TAU = 110 // how long a flick keeps gliding
const GLIDE_STOP = 0.02 // px per ms below which the glide is over
const JUMP_MS = 260 // a jump across the canvas, as a CSS transition

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

export function createCanvas(viewport, plane) {
  const view = { x: 0, y: 0, zoom: 1 }
  const listeners = new Set()
  const grid = viewport.querySelector('.w20-plane-bg')

  // Input lands here and is spent one frame at a time.
  let panX = 0
  let panY = 0
  let zoomTarget = 1
  let anchorX = 0
  let anchorY = 0
  let glideX = 0
  let glideY = 0

  let frame = 0
  let last = 0
  let dirty = false

  // Layout reads are the other half of a slow frame. The viewport only changes
  // size when the window does, so it is measured then, not every frame.
  let vw = viewport.clientWidth
  let vh = viewport.clientHeight
  let vleft = 0
  let vtop = 0

  function measure() {
    const rect = viewport.getBoundingClientRect()
    vw = viewport.clientWidth
    vh = viewport.clientHeight
    vleft = rect.left
    vtop = rect.top
  }

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

  /**
   * The one place the transform is written. Called at most once per frame.
   *
   * The dot grid moves by transform, not by background-position. It used to
   * follow the view through CSS variables, which repainted a full-screen
   * gradient on every frame of every pan — by far the most expensive thing on
   * the canvas. A grid repeats, so moving it by one cell is the same as moving
   * it by a hundred: the offset is taken modulo the cell and the compositor
   * does the rest, with nothing repainted until the zoom changes.
   */
  let gridSize = 0
  function paint() {
    viewport.classList.toggle('is-far', view.zoom < DETAIL_ZOOM)
    // Whole device pixels, and a 2D transform: a plane sitting half a pixel off
    // the grid, or kept on its own layer, is what turns text soft. The layer is
    // only asked for while moving (see .is-moving in the stylesheet) — once the
    // plane settles, it is painted again at its real scale, sharp.
    const ratio = window.devicePixelRatio || 1
    const x = Math.round(view.x * ratio) / ratio
    const y = Math.round(view.y * ratio) / ratio
    plane.style.transform = view.zoom === 1 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) scale(${view.zoom})`

    if (grid) {
      const size = 32 * view.zoom
      if (size !== gridSize) {
        gridSize = size
        grid.style.backgroundSize = `${size}px ${size}px`
      }
      const ox = (((view.x % size) + size) % size) - size
      const oy = (((view.y % size) + size) % size) - size
      grid.style.transform = `translate3d(${ox}px, ${oy}px, 0)`
    }
    emit()
  }

  /**
   * One frame of movement. Everything that happened since the last frame is
   * spent here at once, so the cost of a move is per frame and not per event.
   */
  function tick(now) {
    frame = 0
    const dt = Math.min(64, last ? now - last : 16)
    last = now
    let moved = false

    if (panX || panY) {
      view.x += panX
      view.y += panY
      panX = 0
      panY = 0
      moved = true
    }

    if (glideX || glideY) {
      view.x += glideX * dt
      view.y += glideY * dt
      const decay = Math.exp(-dt / GLIDE_TAU)
      glideX *= decay
      glideY *= decay
      if (Math.hypot(glideX, glideY) < GLIDE_STOP) {
        glideX = 0
        glideY = 0
      }
      moved = true
    }

    if (view.zoom !== zoomTarget) {
      // Exponential approach, driven by elapsed time rather than frame count,
      // so it feels identical at 60 Hz and at 144.
      const k = reduced.matches ? 1 : 1 - Math.exp(-dt / ZOOM_TAU)
      let next = view.zoom + (zoomTarget - view.zoom) * k
      if (Math.abs(zoomTarget - next) < zoomTarget * 0.0005) next = zoomTarget
      // Keep the point under the cursor fixed while the scale changes.
      view.x = anchorX - ((anchorX - view.x) / view.zoom) * next
      view.y = anchorY - ((anchorY - view.y) / view.zoom) * next
      view.zoom = next
      moved = true
    }

    if (moved || dirty) {
      dirty = false
      markMoving()
      paint()
    }

    if (panX || panY || glideX || glideY || view.zoom !== zoomTarget) schedule()
    else last = 0
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick)
  }

  /* ------------------------------------------------------------ actions */

  /**
   * A station laid out in fields does not move: one pixel of layout is one
   * pixel of screen, always. Zooming out from it asks for the overview instead.
   */
  let locked = false
  let onZoomOut = null

  function setLocked(flag) {
    locked = Boolean(flag)
    viewport.classList.toggle('is-locked', locked)
    if (locked) {
      stopJump()
      panX = 0
      panY = 0
      glideX = 0
      glideY = 0
      view.x = 0
      view.y = 0
      view.zoom = 1
      zoomTarget = 1
      dirty = true
      schedule()
    }
  }

  function panBy(dx, dy) {
    if (locked) return
    stopJump()
    panX += dx
    panY += dy
    schedule()
  }

  /** `px`/`py` are viewport-local — the point the zoom should hold still. */
  function zoomAt(px, py, factor) {
    if (locked) return
    stopJump()
    anchorX = px
    anchorY = py
    zoomTarget = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomTarget * factor))
    schedule()
  }

  /** Screen pixel → canvas coordinate. Needed to drop a window where the cursor is. */
  function toCanvas(clientX, clientY) {
    return {
      x: (clientX - vleft - view.x) / view.zoom,
      y: (clientY - vtop - view.y) / view.zoom
    }
  }

  /**
   * Jump the view somewhere else. The maths happens at once — everything that
   * asks "does it fit now?" needs a truthful answer immediately — and only the
   * presentation glides, as a transition the compositor runs on its own.
   */
  let jumpTimer = 0
  /** A jump that the user interrupts stops being a jump. */
  function stopJump() {
    if (!jumpTimer) return
    clearTimeout(jumpTimer)
    jumpTimer = 0
    plane.classList.remove('is-jumping')
    viewport.classList.remove('is-jumping')
  }

  function glideOnce() {
    if (reduced.matches) return
    clearTimeout(jumpTimer)
    plane.classList.add('is-jumping')
    viewport.classList.add('is-jumping')
    jumpTimer = setTimeout(() => {
      jumpTimer = 0
      plane.classList.remove('is-jumping')
      viewport.classList.remove('is-jumping')
    }, JUMP_MS)
  }

  /** Centre the viewport on a canvas rect, optionally fitting it. */
  function focus(rect, { fit = false, padding = 120, glide = true } = {}) {
    if (locked) return
    glideX = 0
    glideY = 0
    if (fit && rect.width && rect.height) {
      const scale = Math.min((vw - padding * 2) / rect.width, (vh - padding * 2) / rect.height)
      view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
    }
    zoomTarget = view.zoom
    view.x = vw / 2 - (rect.x + (rect.width || 0) / 2) * view.zoom
    view.y = vh / 2 - (rect.y + (rect.height || 0) / 2) * view.zoom
    if (glide) glideOnce()
    dirty = true
    schedule()
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
      right: (vw - view.x) / view.zoom + m,
      bottom: (vh - view.y) / view.zoom + m
    }
  }

  function setView(next) {
    if (!next || locked) return
    glideX = 0
    glideY = 0
    view.x = next.x ?? view.x
    view.y = next.y ?? view.y
    view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom ?? view.zoom))
    zoomTarget = view.zoom
    dirty = true
    schedule()
  }

  /* ------------------------------------------------------------ input */

  viewport.addEventListener(
    'wheel',
    (e) => {
      if (locked) {
        // Scrolling belongs to whatever is under the pointer; only a pinch or
        // Ctrl+wheel outwards means something to the station itself.
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (e.deltaY > 0 && onZoomOut) onZoomOut()
        }
        return
      }
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - vleft, e.clientY - vtop, e.deltaY < 0 ? 1.12 : 1 / 1.12)
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
    if (!wantsPan || locked) return
    stopJump()
    glideX = 0
    glideY = 0
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: 0, vy: 0, at: e.timeStamp }
    try {
      viewport.setPointerCapture(e.pointerId)
    } catch {
      // capture only keeps the pan alive past the edge; the pan still works
    }
    viewport.classList.add('is-panning')
  })

  viewport.addEventListener('pointermove', (e) => {
    if (!panning || panning.id !== e.pointerId) return
    // A high-rate mouse reports several positions between two frames. They all
    // arrive in one event; taking only the last would throw the travel away.
    const steps = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
    for (const step of steps.length ? steps : [e]) {
      const dx = step.clientX - panning.x
      const dy = step.clientY - panning.y
      const gap = Math.max(1, step.timeStamp - panning.at)
      panBy(dx, dy)
      // Exponentially weighted, so one stuttering sample cannot define a flick.
      panning.vx = panning.vx * 0.7 + (dx / gap) * 0.3
      panning.vy = panning.vy * 0.7 + (dy / gap) * 0.3
      panning.x = step.clientX
      panning.y = step.clientY
      panning.at = step.timeStamp
    }
  })

  function endPan(e) {
    if (!panning || panning.id !== e.pointerId) return
    // Let go mid-sweep and the canvas keeps going, the way a map does.
    if (!reduced.matches && e.timeStamp - panning.at < 90) {
      glideX = panning.vx
      glideY = panning.vy
      schedule()
    }
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

  window.addEventListener('resize', () => {
    measure()
    dirty = true
    schedule()
  })

  measure()
  paint()

  return {
    view,
    setLocked,
    get locked() {
      return locked
    },
    /** Called when the user zooms out of a locked station. */
    onZoomOut: (fn) => {
      onZoomOut = fn
    },
    toCanvas,
    panBy,
    focus,
    setView,
    visibleRect,
    /** The viewport's size without touching layout — already measured. */
    size: () => ({ width: vw, height: vh }),
    zoomIn: () => zoomAt(vw / 2, vh / 2, 1.2),
    zoomOut: () => zoomAt(vw / 2, vh / 2, 1 / 1.2),
    resetZoom: () => setView({ zoom: 1 }),
    /** Where a new window should land: the middle of what the user is looking at. */
    viewportCenter: () => ({
      x: (vw / 2 - view.x) / view.zoom,
      y: (vh / 2 - view.y) / view.zoom
    }),
    onChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
