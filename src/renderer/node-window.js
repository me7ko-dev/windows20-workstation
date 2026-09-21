/**
 * A window on the canvas. Deliberately not a DOM-heavy component: dragging
 * writes straight to `style.transform` and only commits to the model on
 * release, so moving a window never re-renders the terminal inside it.
 */

let topZ = 10

export function createNodeWindow({ node, canvas, plane, onChange, onClose, onFocus }) {
  const el = document.createElement('section')
  el.className = `w20-window w20-window--${node.type}`
  el.dataset.nodeId = node.id
  if (node.accent) el.style.setProperty('--node-accent', node.accent)

  el.innerHTML = `
    <header class="w20-window-bar" data-role="bar">
      <span class="w20-window-dot"></span>
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

  function place() {
    el.style.transform = `translate(${node.x}px, ${node.y}px)`
    el.style.width = `${node.width}px`
    el.style.height = `${node.height}px`
  }
  place()

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
    barEl.setPointerCapture(e.pointerId)
    el.classList.add('is-dragging')
    e.stopPropagation()
  })

  barEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return
    // Divide by zoom: a pixel of cursor travel is less canvas travel when zoomed in.
    node.x = drag.originX + (e.clientX - drag.startX) / canvas.view.zoom
    node.y = drag.originY + (e.clientY - drag.startY) / canvas.view.zoom
    place()
  })

  function endDrag(e) {
    if (!drag || drag.id !== e.pointerId) return
    drag = null
    el.classList.remove('is-dragging')
    try {
      barEl.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    onChange()
  }
  barEl.addEventListener('pointerup', endDrag)
  barEl.addEventListener('pointercancel', endDrag)

  /* ---------------------------------------------------------- resizing */

  let resize = null
  gripEl.addEventListener('pointerdown', (e) => {
    resize = { id: e.pointerId, startX: e.clientX, startY: e.clientY, w: node.width, h: node.height }
    gripEl.setPointerCapture(e.pointerId)
    e.stopPropagation()
  })

  gripEl.addEventListener('pointermove', (e) => {
    if (!resize || resize.id !== e.pointerId) return
    node.width = Math.max(280, resize.w + (e.clientX - resize.startX) / canvas.view.zoom)
    node.height = Math.max(180, resize.h + (e.clientY - resize.startY) / canvas.view.zoom)
    place()
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
    destroy: () => el.remove()
  }
}
