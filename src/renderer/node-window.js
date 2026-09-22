/**
 * A window on the canvas. Deliberately not a DOM-heavy component: dragging
 * writes straight to `style.transform` and only commits to the model on
 * release, so moving a window never re-renders the terminal inside it.
 */

let topZ = 10

export function createNodeWindow({ node, canvas, plane, onChange, onClose, onFocus, onExpand, onDrop, icon }) {
  const el = document.createElement('section')
  el.className = `w20-window w20-window--${node.type}`
  el.dataset.nodeId = node.id
  if (node.accent) el.style.setProperty('--node-accent', node.accent)

  el.innerHTML = `
    <header class="w20-window-bar" data-role="bar">
      <span class="w20-window-dot"></span>
      <span class="w20-window-icon" data-role="icon"></span>
      <span class="w20-window-title" data-role="title"></span>
      <span class="w20-window-badge" data-role="badge"></span>
      <button class="w20-window-close" data-role="close" title="Затвори (Ctrl+W)">✕</button>
    </header>
    <div class="w20-window-body" data-role="body"></div>
    <div class="w20-window-grip" data-role="grip" title="Оразмери"></div>
  `

  const titleEl = el.querySelector('[data-role="title"]')
  const badgeEl = el.querySelector('[data-role="badge"]')
  const bodyEl = el.querySelector('[data-role="body"]')
  const barEl = el.querySelector('[data-role="bar"]')
  const gripEl = el.querySelector('[data-role="grip"]')

  titleEl.textContent = node.title
  el.querySelector('[data-role="icon"]').textContent = icon || ''
  let offscreen = false
  // Tiled: laid out by the station's fields, not placed by hand. Dragging then
  // means "put it somewhere else", and there is no resize grip to pull.
  let tiled = false

  function place() {
    // Whole pixels and a 2D transform — a window half a pixel off the grid, or
    // on a layer of its own, renders its text soft.
    el.style.transform = `translate(${Math.round(node.x)}px, ${Math.round(node.y)}px)`
    el.style.width = `${Math.round(node.width)}px`
    el.style.height = `${Math.round(node.height)}px`
  }
  place()

  /**
   * Dragging writes the box at most once a frame. A 1000 Hz mouse reports
   * seven moves between two frames of a 144 Hz screen, and laying the window
   * out for each of them is work nobody ever sees.
   */
  let placeFrame = 0
  function placeSoon() {
    if (placeFrame) return
    placeFrame = requestAnimationFrame(() => {
      placeFrame = 0
      place()
    })
  }

  function raise() {
    node.z = ++topZ
    el.style.zIndex = String(node.z)
  }
  raise()

  el.addEventListener('pointerdown', () => {
    raise()
    if (onFocus) onFocus(node)
  })

  /* ----------------------------------------------------------- dragging */

  let drag = null
  barEl.addEventListener('pointerdown', (e) => {
    if (e.target.dataset.role === 'close') return
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: node.x, originY: node.y }
    try {
      barEl.setPointerCapture(e.pointerId)
    } catch {
      // Capture is only what keeps the drag alive past the window's edge. If
      // the browser will not give it, the drag still works — it just ends when
      // the pointer leaves — and throwing here would abandon it entirely.
    }
    el.classList.add('is-dragging')
    e.stopPropagation()
  })

  barEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return
    // Only the latest position matters for where the window ends up, but the
    // coalesced list is what the browser actually saw.
    const steps = e.getCoalescedEvents ? e.getCoalescedEvents() : []
    const last = steps.length ? steps[steps.length - 1] : e
    // Divide by zoom: a pixel of cursor travel is less canvas travel when zoomed in.
    node.x = drag.originX + (last.clientX - drag.startX) / canvas.view.zoom
    node.y = drag.originY + (last.clientY - drag.startY) / canvas.view.zoom
    placeSoon()
  })

  function endDrag(e) {
    if (!drag || drag.id !== e.pointerId) return
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6
    drag = null
    el.classList.remove('is-dragging')
    try {
      barEl.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    if (tiled) {
      // The station decides where it lands; a click on the title is not a move.
      if (moved && onDrop) onDrop(node, e.clientX, e.clientY)
      else onChange({ relayout: true })
      return
    }
    place()
    onChange()
  }
  barEl.addEventListener('pointerup', endDrag)
  barEl.addEventListener('pointercancel', endDrag)

  // The old maximise gesture. On the title bar, where it cannot be confused
  // with a double-click inside a terminal that is selecting a word.
  barEl.addEventListener('dblclick', (e) => {
    if (e.target.dataset.role === 'close') return
    e.stopPropagation()
    if (onExpand) onExpand(node)
  })

  /* ---------------------------------------------------------- resizing */

  let resize = null
  gripEl.addEventListener('pointerdown', (e) => {
    resize = { id: e.pointerId, startX: e.clientX, startY: e.clientY, w: node.width, h: node.height }
    try {
      gripEl.setPointerCapture(e.pointerId)
    } catch {
      // as above: a resize without capture is better than no resize
    }
    e.stopPropagation()
  })

  gripEl.addEventListener('pointermove', (e) => {
    if (!resize || resize.id !== e.pointerId) return
    node.width = Math.max(280, resize.w + (e.clientX - resize.startX) / canvas.view.zoom)
    node.height = Math.max(180, resize.h + (e.clientY - resize.startY) / canvas.view.zoom)
    placeSoon()
    el.dispatchEvent(new CustomEvent('w20:resized', { bubbles: false }))
  })

  function endResize(e) {
    if (!resize || resize.id !== e.pointerId) return
    resize = null
    try {
      gripEl.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    onChange()
  }
  gripEl.addEventListener('pointerup', endResize)
  gripEl.addEventListener('pointercancel', endResize)

  /* ------------------------------------------------------------ closing */

  el.querySelector('[data-role="close"]').addEventListener('click', (e) => {
    e.stopPropagation()
    onClose(node)
  })

  plane.appendChild(el)

  return {
    node,
    el,
    body: bodyEl,
    raise,
    /** Re-read x/y/width/height from the model — used after a tidy. */
    place,
    /**
     * Tell the contents the box changed. Only for sizes the desktop set: a
     * terminal measures its columns from the box and has to be told, while the
     * grip already says so on every pointer move.
     */
    remeasure: () => el.dispatchEvent(new CustomEvent('w20:resized', { bubbles: false })),
    /**
     * Glide to a new position instead of teleporting. Only for moves the user
     * did not make by hand: a dragged window writes its transform every frame,
     * and a transition on that would lag behind the cursor.
     */
    settle: (ms = 320) => {
      el.classList.add('is-settling')
      setTimeout(() => el.classList.remove('is-settling'), ms)
    },
    /**
     * Move the element onto another workspace's plane without rebuilding it.
     * A terminal is a live process — it can be killed, never recreated — so a
     * window carrying one has to travel as it is.
     */
    reparent: (layer) => {
      if (layer && el.parentElement !== layer) layer.appendChild(el)
    },
    focusInView: () => canvas.focus({ x: node.x, y: node.y, width: node.width, height: node.height }, { fit: true }),
    setTitle: (text) => {
      node.title = text
      titleEl.textContent = text
    },
    setBadge: (text, tone = '') => {
      badgeEl.textContent = text || ''
      badgeEl.dataset.tone = tone
    },
    onResized: (fn) => el.addEventListener('w20:resized', fn),
    /**
     * Hide a window the viewport cannot reach. `visibility` rather than
     * `display`, because a terminal that loses its box also loses the column
     * count it measured — it would come back reflowed to nonsense.
     */
    setTiled: (flag) => {
      tiled = Boolean(flag)
      el.classList.toggle('is-tiled', tiled)
    },
    setFocused: (flag) => el.classList.toggle('is-focused', Boolean(flag)),
    setHidden: (flag) => el.classList.toggle('is-solo-hidden', Boolean(flag)),
    setOffscreen: (flag) => {
      if (offscreen === flag) return
      offscreen = flag
      el.classList.toggle('is-offscreen', flag)
    },
    destroy: () => el.remove()
  }
}
