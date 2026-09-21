/**
 * A map of the whole workspace, in the corner.
 *
 * An infinite canvas has one real failure mode: work you cannot find. Windows
 * outside the viewport are not even painted (see `cull` in workspaces.js), so
 * without a map the only way to know a terminal is still out there is to
 * remember where you put it. This draws every window of the active workspace,
 * however far out it sits, and the rectangle showing what the screen covers.
 *
 * It is a 2D canvas rather than DOM nodes on purpose: three hundred windows is
 * three hundred more elements to lay out on every pan, and this has to stay
 * cheap enough to redraw while the canvas is moving.
 */

const WIDTH = 240
const HEIGHT = 160
const PAD = 10

export function createMinimap({ root, desktop, canvas, viewport }) {
  const el = document.createElement('div')
  el.className = 'w20-map'
  el.innerHTML = `
    <canvas class="w20-map-canvas" width="${WIDTH}" height="${HEIGHT}"></canvas>
    <span class="w20-map-label"></span>
  `
  root.appendChild(el)

  const surface = el.querySelector('.w20-map-canvas')
  const label = el.querySelector('.w20-map-label')
  const ctx = surface.getContext('2d')

  let visible = true
  let frame = 0
  let fit = null // last projection, needed to turn a click back into coordinates

  /* Crisp on a high-DPI screen: the element keeps its CSS size, the bitmap grows. */
  const ratio = Math.min(3, window.devicePixelRatio || 1)
  surface.width = WIDTH * ratio
  surface.height = HEIGHT * ratio
  surface.style.width = `${WIDTH}px`
  surface.style.height = `${HEIGHT}px`
  ctx.scale(ratio, ratio)

  /** Everything the map has to contain: the windows, plus where the user is looking. */
  function extent() {
    const view = canvas.visibleRect(0)
    let box = { left: view.left, top: view.top, right: view.right, bottom: view.bottom }
    for (const node of desktop.activeWorkspace().nodes) {
      box.left = Math.min(box.left, node.x)
      box.top = Math.min(box.top, node.y)
      box.right = Math.max(box.right, node.x + node.width)
      box.bottom = Math.max(box.bottom, node.y + node.height)
    }
    return box
  }

  function project(box) {
    const w = Math.max(1, box.right - box.left)
    const h = Math.max(1, box.bottom - box.top)
    const scale = Math.min((WIDTH - PAD * 2) / w, (HEIGHT - PAD * 2) / h)
    return {
      scale,
      // Centre whatever is left over, so a wide workspace is not glued to the top.
      ox: PAD + (WIDTH - PAD * 2 - w * scale) / 2 - box.left * scale,
      oy: PAD + (HEIGHT - PAD * 2 - h * scale) / 2 - box.top * scale
    }
  }

  function draw() {
    if (!visible) return
    const nodes = desktop.activeWorkspace().nodes
    fit = project(extent())
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // Read once, not once per window. Asking for a computed style inside the
    // loop meant three hundred style recalculations on every frame of a pan —
    // the map was cheap to draw and expensive to ask about.
    const fallback = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#5ee0ff'

    for (const node of nodes) {
      const x = node.x * fit.scale + fit.ox
      const y = node.y * fit.scale + fit.oy
      // Never smaller than a dot: a window shrunk to nothing is a window lost.
      const w = Math.max(3, node.width * fit.scale)
      const h = Math.max(3, node.height * fit.scale)
      ctx.fillStyle = node.accent || fallback
      ctx.globalAlpha = node.type === 'terminal' ? 0.85 : 0.5
      ctx.fillRect(x, y, w, h)
    }
    ctx.globalAlpha = 1

    const view = canvas.visibleRect(0)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
    ctx.lineWidth = 1
    ctx.strokeRect(
      view.left * fit.scale + fit.ox + 0.5,
      view.top * fit.scale + fit.oy + 0.5,
      Math.max(2, (view.right - view.left) * fit.scale),
      Math.max(2, (view.bottom - view.top) * fit.scale)
    )

    const ws = desktop.activeWorkspace()
    label.textContent = `${ws.name} · ${nodes.length}`
  }

  function schedule() {
    if (frame || !visible) return
    frame = requestAnimationFrame(() => {
      frame = 0
      draw()
    })
  }

  /* ------------------------------------------------------------- input */

  /** A click on the map is a jump: the point under the cursor becomes the centre. */
  function jump(e) {
    if (!fit) return
    const rect = surface.getBoundingClientRect()
    canvas.focus({
      x: (e.clientX - rect.left - fit.ox) / fit.scale,
      y: (e.clientY - rect.top - fit.oy) / fit.scale
    })
  }

  let dragging = false
  surface.addEventListener('pointerdown', (e) => {
    dragging = true
    e.stopPropagation()
    // The jump comes first: capture is a convenience for dragging on across the
    // map, and a pointer the browser will not let us capture must not cost the
    // user the click they actually made.
    jump(e)
    try {
      surface.setPointerCapture(e.pointerId)
    } catch {
      // nothing to capture — dragging just ends at the map's edge
    }
  })
  surface.addEventListener('pointermove', (e) => {
    if (dragging) jump(e)
  })
  const stop = (e) => {
    dragging = false
    try {
      surface.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
  }
  surface.addEventListener('pointerup', stop)
  surface.addEventListener('pointercancel', stop)

  canvas.onChange(schedule)
  desktop.onChange(schedule)
  window.addEventListener('resize', schedule)
  draw()

  function setVisible(next) {
    visible = next
    el.hidden = !next
    // Toasts stack in this same corner; tell them how much room to leave.
    root.style.setProperty('--map-clear', next ? `${HEIGHT + 36}px` : '8px')
    if (next) draw()
    return visible
  }

  setVisible(visible)

  return {
    el,
    redraw: schedule,
    isVisible: () => visible,
    toggle: () => setVisible(!visible),
    setVisible
  }
}
