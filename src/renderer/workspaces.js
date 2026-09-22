import { createNodeWindow } from './node-window.js'
import { mountTerminal } from './nodes/terminal.js'
import { mountNote } from './nodes/note.js'
import { mountLauncher } from './nodes/launcher.js'
import { mountSettings } from './nodes/settings.js'
import { mountWeb } from './nodes/web.js'
import { mountFiles } from './nodes/files.js'
import { layout as fieldLayout, placeFor, compact, inField, usedFields, neighbourIn, CAPACITY } from './fields.js'
import { STYLES, randomPicture, accentOf } from './pictures.js'
import { pictures } from './picture-store.js'

/**
 * Workspaces hold the layout; this module owns the live windows.
 *
 * There is no fixed number of them — they are added and closed as needed, so
 * the cost of the desktop has to be paid per *visible* window, not per window
 * that exists. Two rules keep that true however far it grows:
 *
 *  - Leaving a workspace destroys its DOM and rebuilds it from the model on
 *    return. The exception is a workspace holding a running terminal: that
 *    process cannot be rebuilt, only killed, so its plane stays alive, hidden.
 *  - Windows the viewport cannot reach are not painted (see `cull`).
 *
 * What is left growing with the number of workspaces is the plain model —
 * a few hundred bytes each — and the terminals the user chose to keep running.
 */

/**
 * Backgrounds are painted pictures (see pictures.js): a style and a seed per
 * station. Each carries its own accent, so a picture themes the whole station
 * — the tabs, the badge, the focused window — and ten stations are ten
 * different places, not one place ten times.
 */
const WALLPAPERS = STYLES

/** What a window shows before its title, so a field of four reads at a glance. */
const ICONS = {
  terminal: '›_',
  web: '◎',
  files: '▤',
  note: '✎',
  settings: '⚙',
  launcher: '↗'
}

const DEFAULT_SIZES = {
  terminal: { width: 720, height: 460 },
  note: { width: 340, height: 280 },
  launcher: { width: 320, height: 300 },
  settings: { width: 380, height: 420 },
  web: { width: 960, height: 640 },
  files: { width: 400, height: 480 }
}

/** How far outside the viewport a window is still worth painting. */
const CULL_MARGIN = 400

let seq = 0
function nextId(type) {
  seq += 1
  return `${type}-${Date.now().toString(36)}-${seq}`
}

export function createDesktop({ plane, canvas, programs, home, speaker, insets, notify }) {
  const workspaces = []
  let activeIndex = 0
  const live = new Map() // nodeId -> { win, content }
  let focusedId = null
  const planes = new Map() // workspaceId -> plane element
  const listeners = new Set()
  let saveTimer = null
  let cullFrame = 0

  function emit() {
    for (const fn of listeners) fn(snapshot())
  }

  function activeWorkspace() {
    return workspaces[activeIndex]
  }

  function planeFor(index) {
    const ws = workspaces[index]
    if (planes.has(ws.id)) return planes.get(ws.id)
    const el = document.createElement('div')
    el.className = 'w20-plane-layer'
    el.dataset.workspace = ws.id
    plane.appendChild(el)
    planes.set(ws.id, el)
    return el
  }

  /* ------------------------------------------------------------ model */

  /** Names stay unique as workspaces come and go — never reused while one lives. */
  function nextName() {
    const taken = new Set(workspaces.map((ws) => Number(ws.name)).filter(Number.isFinite))
    let n = 1
    while (taken.has(n)) n += 1
    return String(n).padStart(2, '0')
  }

  function blankWorkspace() {
    return {
      id: nextId('ws'),
      name: nextName(),
      // Fields: at most four, four windows each, nothing scaled. The free
      // canvas is still there for a station that wants it.
      layout: 'fields',
      solo: null,
      picture: randomPicture(),
      cwd: home,
      view: { x: 0, y: 0, zoom: 1 },
      nodes: []
    }
  }

  const tiledMode = (ws = activeWorkspace()) => ws.layout === 'fields'

  /**
   * A picture for a new station: the style the other stations use least, so
   * ten stations are ten different places before any style repeats.
   */
  function freshPicture() {
    const uses = new Map(STYLES.map((st) => [st.id, 0]))
    for (const ws of workspaces) if (ws.picture) uses.set(ws.picture.style, (uses.get(ws.picture.style) || 0) + 1)
    const least = Math.min(...uses.values())
    const pool = STYLES.filter((st) => uses.get(st.id) === least)
    return { style: pool[Math.floor(Math.random() * pool.length)].id, seed: Math.floor(Math.random() * 2 ** 31) }
  }

  function snapshot() {
    return {
      activeIndex,
      workspaces: workspaces.map((ws) => ({
        ...ws,
        nodes: ws.nodes.map((n) => ({ ...n }))
      }))
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      // Terminals cannot survive a restart, so they are never persisted —
      // reopening a dead shell that looks alive is worse than an empty canvas.
      const state = snapshot()
      for (const ws of state.workspaces) {
        // Terminals cannot come back, and an editor window would start a
        // server at boot that nobody asked for this time round.
        ws.nodes = ws.nodes.filter((n) => n.type !== 'terminal' && !(n.type === 'web' && n.programId))
      }
      window.w20.state.save(state)
    }, 400)
  }

  function changed() {
    scheduleSave()
    emit()
  }

  /* ----------------------------------------------------------- windows */

  function mountNode(node) {
    const program = node.programId ? programs.find((p) => p.id === node.programId) : null
    const win = createNodeWindow({
      node,
      canvas,
      plane: planeFor(activeIndex),
      icon: (program && program.icon) || ICONS[node.type] || '',
      onChange: (opts) => {
        if (opts && opts.relayout) relayout()
        changed()
      },
      onClose: (n) => closeNode(n.id),
      // Dictation needs to know which terminal the words belong to.
      onFocus: (n) => setFocus(n.id),
      onExpand: (n) => expand(n.id),
      onDrop: (n, x, y) => dropNode(n.id, x, y)
    })
    win.setTiled(tiledMode())

    let content = null
    if (node.type === 'terminal') {
      content = mountTerminal(win, { cwd: node.cwd || activeWorkspace().cwd, shell: node.shell, args: node.args })
    } else if (node.type === 'note') {
      content = mountNote(win, {
        text: node.text || '',
        onChange: (text) => {
          node.text = text
          scheduleSave()
        }
      })
    } else if (node.type === 'settings') {
      content = mountSettings(win, { speaker, openWeb: (url) => openWeb(url) })
    } else if (node.type === 'web') {
      content = mountWeb(win, {
        // An editor window has no address bar: its address is the server's,
        // and typing over it would only break the editor.
        url: node.programId ? '' : node.url || '',
        chrome: !node.programId,
        onChange: (at) => {
          node.url = at
          scheduleSave()
        }
      })
      if (node.programId) startEditor(node, win, content)
    } else if (node.type === 'files') {
      content = mountFiles(win, {
        cwd: node.cwd || activeWorkspace().cwd,
        onOpenTerminal: (dir) => openTerminal({ cwd: dir, title: dir.split(/[\\/]/).pop() || 'Терминал' }),
        onChange: (dir) => {
          node.cwd = dir
          scheduleSave()
        }
      })
    } else if (node.type === 'launcher') {
      const program = programs.find((p) => p.id === node.programId)
      content = program ? mountLauncher(win, { program }) : null
    }

    live.set(node.id, { win, content })
    return { win, content }
  }

  function renderActive() {
    const ws = activeWorkspace()
    for (const [id, el] of planes) el.hidden = id !== ws.id
    const layer = planeFor(activeIndex)
    // Mount anything in the model that has no window yet (first visit, or a
    // workspace whose non-terminal windows were torn down).
    for (const node of ws.nodes) {
      if (!live.has(node.id)) mountNode(node)
    }
    layer.hidden = false
    const tiled = tiledMode(ws)
    document.body.classList.toggle('is-fields', tiled)
    canvas.setLocked(tiled)
    if (!tiled) canvas.setView(ws.view)
    for (const node of ws.nodes) {
      const entry = live.get(node.id)
      if (entry) entry.win.setTiled(tiled)
    }
    applyWallpaper()
    relayout({ glide: false })
    cull()
    emit()
  }

  /* ------------------------------------------------------------ fields */

  /** The part of the screen fields may use: clear of the dock and the bar. */
  function fieldArea() {
    const size = canvas.size()
    const edge = insets ? insets() : { left: 16, top: 16, right: 16, bottom: 16 }
    return {
      x: edge.left,
      y: edge.top,
      width: Math.max(200, size.width - edge.left - edge.right),
      height: Math.max(160, size.height - edge.top - edge.bottom)
    }
  }

  /** The drawn outline of each field, under its windows. */
  function drawFrames(ws, result) {
    const layer = planeFor(activeIndex)
    let frames = layer.querySelector(':scope > .w20-fields')
    if (!frames) {
      frames = document.createElement('div')
      frames.className = 'w20-fields'
      layer.prepend(frames)
    }
    frames.innerHTML = ''
    if (!tiledMode(ws) || result.solo) return
    const pad = 6
    for (const f of result.fields) {
      const frame = document.createElement('div')
      frame.className = 'w20-field-frame'
      if (focusedNode() && focusedNode().field === f.field) frame.classList.add('is-current')
      frame.style.transform = `translate(${f.rect.x - pad}px, ${f.rect.y - pad}px)`
      frame.style.width = `${f.rect.width + pad * 2}px`
      frame.style.height = `${f.rect.height + pad * 2}px`
      frame.innerHTML = `<span class="w20-field-tag">${f.field + 1}<small>${f.count}/4</small></span>`
      frames.appendChild(frame)
    }
    const empty = !ws.nodes.length
    layer.classList.toggle('is-empty', empty)
  }

  let lastLayout = null

  /**
   * Put every window of a tiled station where its field says. Called after
   * anything that changes the fields: a window opened, closed, dropped, the
   * screen resized.
   */
  function relayout({ glide = true } = {}) {
    const ws = activeWorkspace()
    if (!tiledMode(ws)) {
      drawFrames(ws, { fields: [] })
      lastLayout = null
      return
    }
    const area = fieldArea()
    const result = fieldLayout(ws, area)
    lastLayout = result
    for (const node of ws.nodes) {
      const rect = result.windows.get(node.id)
      const entry = live.get(node.id)
      if (!rect) continue
      const resized = rect.width !== node.width || rect.height !== node.height
      Object.assign(node, rect)
      if (!entry) continue
      if (glide) entry.win.settle(260)
      entry.win.place()
      entry.win.setHidden(Boolean(result.solo) && result.solo !== node.id)
      if (resized) entry.win.remeasure()
      if (result.solo === node.id) entry.win.raise()
    }
    drawFrames(ws, result)
    emit()
  }

  function setFocus(id) {
    focusedId = id
    for (const [nid, entry] of live) entry.win.setFocused(nid === id)
    const ws = activeWorkspace()
    if (tiledMode(ws) && lastLayout) drawFrames(ws, lastLayout)
  }

  /** Focus a window and put the caret in it. */
  function focusNode(id) {
    const entry = live.get(id)
    if (!entry) return false
    setFocus(id)
    entry.win.raise()
    if (entry.content && entry.content.focus) entry.content.focus()
    return true
  }

  /** Rectangles of the windows on screen now — for moving by direction. */
  function visibleRects() {
    const rects = new Map()
    const ws = activeWorkspace()
    for (const node of ws.nodes) {
      if (ws.solo && ws.solo !== node.id && tiledMode(ws)) continue
      rects.set(node.id, { x: node.x, y: node.y, width: node.width, height: node.height })
    }
    return rects
  }

  /** Alt+arrow: the caret goes to the nearest window that way. */
  function focusDirection(dir) {
    const ws = activeWorkspace()
    if (!ws.nodes.length) return null
    const from = focusedId && live.has(focusedId) ? focusedId : ws.nodes[0].id
    const to = neighbourIn(visibleRects(), from, dir) || (from === focusedId ? null : from)
    if (!to) return null
    focusNode(to)
    if (!tiledMode(ws)) live.get(to).win.focusInView()
    return nodeById(to).node
  }

  /**
   * Alt+Shift+arrow: the window trades places with its neighbour that way — or,
   * with a field still free, moves out into it.
   */
  function moveDirection(dir) {
    const ws = activeWorkspace()
    const found = focusedId ? nodeById(focusedId) : null
    if (!found || found.ws !== ws) return false
    const node = found.node
    if (!tiledMode(ws)) {
      const step = 60
      node.x += dir === 'left' ? -step : dir === 'right' ? step : 0
      node.y += dir === 'up' ? -step : dir === 'down' ? step : 0
      live.get(node.id).win.place()
      changed()
      return true
    }
    const other = neighbourIn(visibleRects(), node.id, dir)
    if (other) {
      swap(node, nodeById(other).node)
    } else if (usedFields(ws).length < 4 && inField(ws, node.field).length > 1) {
      const place = placeFor(ws)
      node.field = place.field
      node.slot = place.slot
      compact(ws)
    } else {
      return false
    }
    relayout()
    changed()
    return true
  }

  function swap(a, b) {
    const f = a.field
    const s2 = a.slot
    a.field = b.field
    a.slot = b.slot
    b.field = f
    b.slot = s2
  }

  /** A tiled window dropped by its title: it trades places with what is there. */
  function dropNode(id, clientX, clientY) {
    const ws = activeWorkspace()
    const found = nodeById(id)
    if (!found || !tiledMode(ws)) return
    const point = canvas.toCanvas(clientX, clientY)
    const target = ws.nodes.find(
      (n) =>
        n.id !== id &&
        point.x >= n.x &&
        point.x <= n.x + n.width &&
        point.y >= n.y &&
        point.y <= n.y + n.height
    )
    if (target) swap(found.node, target)
    relayout()
    changed()
  }

  /** Alt+1…4: the first window of that field. */
  function focusField(field) {
    const members = inField(activeWorkspace(), field)
    return members.length ? focusNode(members[0].id) : false
  }

  /** Free canvas ↔ fields, for this station. */
  function toggleLayout() {
    const ws = activeWorkspace()
    if (tiledMode(ws)) {
      ws.layout = 'canvas'
      ws.solo = null
      // Keep the windows where the fields had them, so nothing jumps.
      ws.view = { x: 0, y: 0, zoom: 1 }
    } else {
      if (ws.nodes.length > CAPACITY) return { ok: false, reason: `В полетата се побират ${CAPACITY} прозореца, тук има ${ws.nodes.length}.` }
      ws.layout = 'fields'
      ws.nodes.forEach((n) => {
        delete n.field
        delete n.slot
      })
      for (const n of ws.nodes) Object.assign(n, placeFor(ws))
    }
    renderActive()
    changed()
    return { ok: true, layout: ws.layout }
  }

  /** Paint only what can be seen. Cheap enough to run on every pan frame. */
  function cull() {
    const box = canvas.visibleRect(CULL_MARGIN)
    for (const node of activeWorkspace().nodes) {
      const entry = live.get(node.id)
      if (!entry) continue
      entry.win.setOffscreen(
        node.x > box.right ||
          node.y > box.bottom ||
          node.x + node.width < box.left ||
          node.y + node.height < box.top
      )
    }
  }

  function scheduleCull() {
    if (cullFrame) return
    cullFrame = requestAnimationFrame(() => {
      cullFrame = 0
      cull()
    })
  }

  function tearDown(id) {
    const entry = live.get(id)
    if (!entry) return
    if (entry.content && entry.content.destroy) entry.content.destroy()
    entry.win.destroy()
    live.delete(id)
    if (focusedId === id) focusedId = null
  }

  function hasLiveTerminal(ws) {
    return ws.nodes.some((n) => n.type === 'terminal' && live.has(n.id))
  }

  /**
   * Give back the DOM of a workspace nobody is looking at. Refused while a
   * terminal lives there — tearing that down would kill the process, and an
   * agent must never die because the user glanced at another workspace.
   */
  function release(ws) {
    if (!ws || hasLiveTerminal(ws)) return false
    for (const node of ws.nodes) tearDown(node.id)
    const el = planes.get(ws.id)
    if (el) {
      el.remove()
      planes.delete(ws.id)
    }
    return true
  }

  function closeNode(id) {
    tearDown(id)
    for (const ws of workspaces) {
      const had = ws.nodes.length
      ws.nodes = ws.nodes.filter((n) => n.id !== id)
      if (ws.solo === id) ws.solo = null
      if (ws.nodes.length !== had) compact(ws)
    }
    relayout()
    changed()
  }

  function nodeById(id) {
    for (const ws of workspaces) {
      const node = ws.nodes.find((n) => n.id === id)
      if (node) return { node, ws }
    }
    return null
  }

  /** The window the user last touched, whatever kind it is. */
  function focusedNode() {
    const found = focusedId ? nodeById(focusedId) : null
    return found ? found.node : null
  }

  function closeFocused() {
    if (!focusedId || !nodeById(focusedId)) return null
    const title = nodeById(focusedId).node.title
    closeNode(focusedId)
    return title
  }

  /**
   * Move a window to another workspace, keeping whatever is running in it.
   * The element is re-parented rather than rebuilt, so a terminal crosses
   * intact; anything that can be rebuilt from the model is simply dropped if
   * nobody is looking at the destination.
   */
  function moveNodeTo(id, index) {
    const target = workspaces[index]
    const found = nodeById(id)
    if (!target || !found || found.ws === target) return false
    let place = null
    if (tiledMode(target)) {
      place = placeFor(target)
      if (!place) return false
    }

    found.ws.nodes = found.ws.nodes.filter((n) => n.id !== id)
    if (found.ws.solo === id) found.ws.solo = null
    compact(found.ws)
    if (place) Object.assign(found.node, place)
    target.nodes.push(found.node)

    if (live.has(id)) {
      if (index === activeIndex || found.node.type === 'terminal') {
        live.get(id).win.reparent(planeFor(index))
      } else {
        tearDown(id)
      }
    }

    // Puts every plane's hidden flag back in order and mounts anything the
    // active workspace has gained.
    renderActive()
    changed()
    return true
  }

  /** The rectangle every window of a workspace fits inside. */
  function bounds(ws = activeWorkspace()) {
    if (!ws.nodes.length) return null
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of ws.nodes) {
      left = Math.min(left, node.x)
      top = Math.min(top, node.y)
      right = Math.max(right, node.x + node.width)
      bottom = Math.max(bottom, node.y + node.height)
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  /**
   * Pull the whole workspace into view. There is a limit to how far the canvas
   * zooms out, so this reports whether everything actually made it — a fit that
   * quietly left work off the edge is how a window gets lost for good.
   */
  function fitAll() {
    const box = bounds()
    if (!box) return null
    if (tiledMode()) {
      activeWorkspace().solo = null
      relayout()
      return { count: activeWorkspace().nodes.length, fits: true }
    }
    canvas.focus(box, { fit: true })
    const seen = canvas.visibleRect(0)
    return {
      count: activeWorkspace().nodes.length,
      fits:
        box.x >= seen.left &&
        box.y >= seen.top &&
        box.x + box.width <= seen.right &&
        box.y + box.height <= seen.bottom
    }
  }

  /* --------------------------------------------------------- expanding */

  /** How many neighbours an expanded window should grow to cover. */
  const EXPAND_HOLDS = 4
  /** How far past its own edges a window counts another one as "close by". */
  const NEAR_REACH = 1.2
  /** However near the neighbours are, never more than this many times its size. */
  const EXPAND_CAP = 3

  /** The nearest windows within reach, closest first. */
  function neighbours(node, ws, limit) {
    const mx = node.width * NEAR_REACH
    const my = node.height * NEAR_REACH
    const zone = {
      left: node.x - mx,
      top: node.y - my,
      right: node.x + node.width + mx,
      bottom: node.y + node.height + my
    }
    const cx = node.x + node.width / 2
    const cy = node.y + node.height / 2
    return ws.nodes
      .filter(
        (n) =>
          n.id !== node.id &&
          n.x < zone.right &&
          n.x + n.width > zone.left &&
          n.y < zone.bottom &&
          n.y + n.height > zone.top
      )
      .map((n) => ({ n, d: Math.hypot(n.x + n.width / 2 - cx, n.y + n.height / 2 - cy) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((e) => e.n)
  }

  /**
   * Grow the selected window until it holds the small ones around it — up to
   * four — and shrink it back on the second call.
   *
   * The neighbours are not moved. They stay exactly where they were and the
   * expanded window simply covers them, so nothing has to be put back if the
   * user never collapses it: the layout underneath is untouched.
   *
   * With nothing close by there is no cluster to cover, so it grows to a plain
   * two-by-two instead of guessing at a size.
   */
  function expand(id = focusedId) {
    const found = id ? nodeById(id) : null
    if (!found) return null
    const { node, ws } = found

    // In fields the whole station is the neighbourhood: the window takes the
    // screen, the others wait behind it, running.
    if (tiledMode(ws)) {
      const grow = ws.solo !== node.id
      ws.solo = grow ? node.id : null
      relayout()
      changed()
      return { expanded: grow, title: node.title, covered: grow ? ws.nodes.length - 1 : 0 }
    }

    const apply = ({ follow = false } = {}) => {
      const entry = live.get(node.id)
      if (entry) {
        entry.win.settle()
        entry.win.place()
        entry.win.remeasure()
        entry.win.raise()
      }
      // A window that grew past the edge of the screen is not much use grown.
      // The view only moves when it has to, though — snapping the canvas about
      // on an expansion that was already fully visible would be worse.
      if (follow) {
        const seen = canvas.visibleRect(0)
        const outside =
          node.x < seen.left ||
          node.y < seen.top ||
          node.x + node.width > seen.right ||
          node.y + node.height > seen.bottom
        if (outside) {
          canvas.focus({ x: node.x, y: node.y, width: node.width, height: node.height }, { fit: true, padding: 70 })
        }
      }
      scheduleCull()
      changed()
    }

    if (node.folded) {
      Object.assign(node, node.folded)
      delete node.folded
      apply()
      return { expanded: false, title: node.title, covered: 0 }
    }

    node.folded = { x: node.x, y: node.y, width: node.width, height: node.height }
    const close = neighbours(node, ws, EXPAND_HOLDS)

    let left = node.x
    let top = node.y
    let right = node.x + node.width
    let bottom = node.y + node.height
    for (const n of close) {
      left = Math.min(left, n.x)
      top = Math.min(top, n.y)
      right = Math.max(right, n.x + n.width)
      bottom = Math.max(bottom, n.y + n.height)
    }

    // Always at least double, never past the cap — one enormous neighbour
    // should not turn this into a window the size of the workspace.
    const width = Math.min(Math.max(right - left, node.width * 2), node.width * EXPAND_CAP)
    const height = Math.min(Math.max(bottom - top, node.height * 2), node.height * EXPAND_CAP)

    // Centre on the cluster, but never so far that it stops covering the
    // ground it was standing on.
    let x = left + (right - left - width) / 2
    let y = top + (bottom - top - height) / 2
    x = Math.max(node.x + node.width - width, Math.min(x, node.x))
    y = Math.max(node.y + node.height - height, Math.min(y, node.y))

    node.x = Math.round(x)
    node.y = Math.round(y)
    node.width = Math.round(width)
    node.height = Math.round(height)
    apply({ follow: true })
    return { expanded: true, title: node.title, covered: close.length }
  }

  const TIDY_GAP = 36

  /**
   * Lay the workspace out on a grid, in the order the windows already read —
   * top to bottom, then left to right — so tidying rearranges the spacing
   * without shuffling what the user built. Sizes are kept: a window is the
   * size it is because someone made it that size.
   */
  function tidy() {
    const ws = activeWorkspace()
    if (!ws.nodes.length) return 0
    if (tiledMode(ws)) {
      ws.solo = null
      compact(ws)
      relayout()
      changed()
      return ws.nodes.length
    }

    const box = bounds(ws)
    const ordered = [...ws.nodes].sort((a, b) => a.y - b.y || a.x - b.x)
    const columns = Math.max(1, Math.round(Math.sqrt(ordered.length)))
    const columnWidth = Math.max(...ordered.map((n) => n.width)) + TIDY_GAP

    let x = box.x
    let y = box.y
    let rowHeight = 0
    let column = 0

    for (const node of ordered) {
      node.x = Math.round(x)
      node.y = Math.round(y)
      // An expanded window keeps its size here, so its folded size is still
      // worth keeping — but it now belongs to this slot, not the old spot.
      if (node.folded) {
        node.folded.x = node.x
        node.folded.y = node.y
      }
      rowHeight = Math.max(rowHeight, node.height)
      x += columnWidth
      column += 1
      if (column === columns) {
        column = 0
        x = box.x
        y += rowHeight + TIDY_GAP
        rowHeight = 0
      }
    }

    for (const node of ws.nodes) {
      const entry = live.get(node.id)
      if (!entry) continue
      entry.win.settle()
      entry.win.place()
    }

    scheduleCull()
    changed()
    return ordered.length
  }

  /* -------------------------------------------------------- public api */

  function addNode(partial, { focus = true, sameField = false } = {}) {
    const size = DEFAULT_SIZES[partial.type] || DEFAULT_SIZES.terminal
    const center = canvas.viewportCenter()
    const ws = activeWorkspace()

    let place = null
    if (tiledMode(ws)) {
      const current = focusedNode()
      place = placeFor(ws, {
        preferField: current && nodeById(current.id).ws === ws ? current.field : null,
        sameField
      })
      if (!place) {
        if (notify) notify(`Станцията е пълна — ${CAPACITY} прозореца в 4 полета. Затвори някой или отвори нова станция (Ctrl+Shift+N).`)
        return null
      }
      ws.solo = null
    }

    const node = {
      id: nextId(partial.type),
      x: Math.round(center.x - size.width / 2 + (ws.nodes.length % 4) * 28),
      y: Math.round(center.y - size.height / 2 + (ws.nodes.length % 4) * 24),
      width: size.width,
      height: size.height,
      ...size,
      ...partial,
      ...(place || {})
    }

    ws.nodes.push(node)
    if (place) {
      // Laid out before it is mounted, so a terminal measures its real box.
      const rect = fieldLayout(ws, fieldArea()).windows.get(node.id)
      if (rect) Object.assign(node, rect)
    }
    const { win, content } = mountNode(node)
    // A window opened is a window focused — otherwise Ctrl+W after Ctrl+T would
    // close whatever the user happened to click last, which is worse than nothing.
    if (focus) setFocus(node.id)
    if (focus && content && content.focus) requestAnimationFrame(() => content.focus())
    relayout()
    scheduleCull()
    changed()
    return { node, win, content }
  }

  function openTerminal({ title, shell, args, cwd, accent, programId, sameField = false } = {}) {
    return addNode(
      {
        type: 'terminal',
        title: title || 'Терминал',
        shell,
        args,
        programId,
        cwd: cwd || activeWorkspace().cwd,
        accent
      },
      { sameField }
    )
  }

  /**
   * VS Code's own web mode takes a moment to come up — and on a first run it
   * downloads the server component — so the window says what it is doing
   * rather than sitting blank.
   */
  function startEditor(node, win, content) {
    win.setBadge('стартира…', '')
    content.setNotice('Стартирам редактора… при първо пускане това отнема малко.')
    window.w20.editor.serve(node.programId).then((result) => {
      if (result.ok) {
        win.setBadge('')
        content.setNotice('')
        content.load(result.url)
        return
      }
      win.setBadge('грешка', 'error')
      content.setNotice(
        `${result.error}\n\nТова издание може да няма serve-web. ` +
          'Лентата (Ctrl+K) може да го пусне като прозорец на Windows.'
      )
    })
  }

  function openWeb(url = '') {
    return addNode({ type: 'web', title: url ? url : 'Браузър', url, accent: '#4caf50' })
  }

  function openFiles(dir) {
    return addNode({ type: 'files', title: 'Файлове', cwd: dir || activeWorkspace().cwd, accent: '#ffd166' })
  }

  function openEditor(program) {
    return addNode({ type: 'web', title: program.title, programId: program.id, accent: program.accent })
  }

  function openProgram(program, { cwd } = {}) {
    if (program.kind === 'web') return openWeb()
    if (program.kind === 'files') return openFiles(cwd || activeWorkspace().cwd)
    if (program.kind === 'editor') return openEditor(program)
    if (program.kind === 'external') {
      return addNode({ type: 'launcher', title: program.title, programId: program.id, accent: program.accent })
    }
    return openTerminal({
      title: program.title,
      // Windows Terminal is a home for shells, which is what this station is.
      // Its button opens a plain terminal here rather than a second window.
      shell: program.useDefaultShell ? undefined : program.path || program.command,
      args: program.args,
      cwd: cwd || activeWorkspace().cwd,
      accent: program.accent,
      programId: program.id
    })
  }

  function openSettings() {
    const existing = Array.from(live.values()).find((entry) => entry.win.node.type === 'settings')
    if (existing) {
      existing.win.raise()
      existing.win.focusInView()
      return existing
    }
    return addNode({ type: 'settings', title: 'Настройки', accent: '#9aa2b1', width: 460, height: 640 })
  }

  function openNote(text = '', size = {}) {
    return addNode({ type: 'note', title: 'Бележка', text, accent: '#ffd166', ...size })
  }

  function switchTo(index) {
    if (index < 0 || index >= workspaces.length || index === activeIndex) return
    const leaving = activeWorkspace()
    if (!tiledMode(leaving)) leaving.view = { ...canvas.view }
    activeIndex = index
    renderActive()
    // renderActive already reported the mount; report again once the workspace
    // we left has given its DOM back, or the readout keeps the peak.
    if (release(leaving)) emit()
  }

  function step(delta) {
    const count = workspaces.length
    switchTo(((activeIndex + delta) % count + count) % count)
  }

  function addWorkspace({ focus = true } = {}) {
    // Every new station gets a picture of its own — never the style it follows.
    const ws = blankWorkspace()
    ws.picture = freshPicture()
    workspaces.push(ws)
    if (focus) switchTo(workspaces.length - 1)
    else changed()
    return workspaces.length - 1
  }

  /** Closing takes everything in it with it, running terminals included. */
  function closeWorkspace(index = activeIndex) {
    if (workspaces.length <= 1) return false
    const ws = workspaces[index]
    if (!ws) return false

    for (const node of ws.nodes) tearDown(node.id)
    const el = planes.get(ws.id)
    if (el) {
      el.remove()
      planes.delete(ws.id)
    }
    workspaces.splice(index, 1)

    if (index === activeIndex) activeIndex = Math.min(index, workspaces.length - 1)
    else if (index < activeIndex) activeIndex -= 1

    renderActive()
    changed()
    return true
  }

  /** What the desktop currently costs — the bar shows this so the user can see it. */
  function stats() {
    let windows = 0
    let terminals = 0
    for (const ws of workspaces) {
      windows += ws.nodes.length
      for (const node of ws.nodes) {
        if (node.type === 'terminal' && live.has(node.id)) terminals += 1
      }
    }
    return { workspaces: workspaces.length, windows, terminals, mounted: live.size }
  }

  /** A new picture in this style — a new seed, so never the same one twice. */
  function setWallpaper(style) {
    if (!STYLES.some((w) => w.id === style)) return
    activeWorkspace().picture = { style, seed: Math.floor(Math.random() * 2 ** 31) }
    applyWallpaper()
    changed()
  }

  let pictureToken = 0

  /**
   * Show the station's picture: its accent at once, the small version as soon
   * as it exists, then the 4K one crossfading over it.
   */
  function applyWallpaper() {
    const ws = activeWorkspace()
    if (!ws.picture) ws.picture = randomPicture()
    const { style, seed } = ws.picture
    const accent = accentOf(style, seed)
    const body = document.body.style
    body.setProperty('--accent', accent)
    body.setProperty('--grid-color', `color-mix(in srgb, ${accent} 12%, transparent)`)
    const token = ++pictureToken
    let sharp = false
    const show = (result, full) => {
      if (!result || token !== pictureToken || (sharp && !full)) return
      if (full) sharp = true
      body.setProperty('--wallpaper', `url("${result.url}") center / cover no-repeat, #05060a`)
    }
    pictures.thumb(ws.picture).then((thumb) => show(thumb, false))
    pictures.full(ws.picture).then((full) => show(full, true))
  }

  /** Anything but the style already on screen — a reroll that changes nothing is a bug. */
  function randomWallpaper() {
    const current = activeWorkspace().picture && activeWorkspace().picture.style
    const next = randomPicture(current)
    activeWorkspace().picture = next
    applyWallpaper()
    changed()
    return STYLES.find((w) => w.id === next.style)
  }

  function setCwd(dir) {
    activeWorkspace().cwd = dir
    changed()
  }

  function findNodes(query) {
    const q = query.toLowerCase()
    const hits = []
    workspaces.forEach((ws, index) => {
      for (const node of ws.nodes) {
        const haystack = `${node.title} ${node.text || ''}`.toLowerCase()
        if (haystack.includes(q)) hits.push({ node, workspaceIndex: index, workspaceName: ws.name })
      }
    })
    return hits
  }

  function revealNode(id, workspaceIndex) {
    if (workspaceIndex !== activeIndex) switchTo(workspaceIndex)
    const entry = live.get(id)
    if (!entry) return
    setFocus(id)
    const ws = activeWorkspace()
    if (tiledMode(ws) && ws.solo && ws.solo !== id) {
      ws.solo = null
      relayout()
    }
    entry.win.raise()
    entry.win.focusInView()
    entry.win.el.classList.add('is-flashing')
    setTimeout(() => entry.win.el.classList.remove('is-flashing'), 900)
  }

  function load(state) {
    workspaces.length = 0
    const saved = state && Array.isArray(state.workspaces) && state.workspaces.length ? state.workspaces : null
    // Ten to start with: the overview is the point, and an empty station
    // costs nothing but its name and its picture.
    const count = saved ? saved.length : 10
    for (let i = 0; i < count; i += 1) {
      const base = blankWorkspace()
      base.picture = freshPicture()
      const ws = saved ? { ...base, ...saved[i], nodes: saved[i].nodes || [] } : base
      if (!ws.picture || !ws.picture.style) ws.picture = base.picture
      delete ws.wallpaper
      // A layout from before fields: it moves into them if it fits.
      if (!ws.layout) {
        ws.layout = ws.nodes.length <= CAPACITY ? 'fields' : 'canvas'
        if (ws.layout === 'fields') for (const n of ws.nodes) Object.assign(n, placeFor(ws))
      }
      workspaces.push(ws)
    }
    activeIndex =
      state && Number.isInteger(state.activeIndex)
        ? Math.min(workspaces.length - 1, Math.max(0, state.activeIndex))
        : 0
    applyWallpaper()
    renderActive()
  }

  canvas.onChange(() => {
    if (!tiledMode()) activeWorkspace().view = { ...canvas.view }
    scheduleCull()
    scheduleSave()
  })

  let resizeFrame = 0
  window.addEventListener('resize', () => {
    scheduleCull()
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => relayout({ glide: false }))
  })

  return {
    WALLPAPERS,
    load,
    addNode,
    openTerminal,
    openProgram,
    openWeb,
    openFiles,
    openNote,
    openSettings,
    closeNode,
    closeFocused,
    focusedNode,
    focusNode,
    focusDirection,
    moveDirection,
    focusField,
    toggleLayout,
    relayout,
    isTiled: () => tiledMode(),
    ICONS,
    CAPACITY,
    expand,
    moveNodeTo,
    bounds,
    fitAll,
    tidy,
    addWorkspace,
    closeWorkspace,
    step,
    stats,
    /** The terminal the user last touched — where dictated text should go. */
    focusedTerminal: () => {
      const entry = focusedId ? live.get(focusedId) : null
      if (!entry || entry.win.node.type !== 'terminal') return null
      return entry
    },
    switchTo,
    setWallpaper,
    randomWallpaper,
    applyWallpaper,
    setCwd,
    findNodes,
    revealNode,
    snapshot,
    get activeIndex() {
      return activeIndex
    },
    get workspaces() {
      return workspaces
    },
    activeWorkspace,
    liveNodes: () => Array.from(live.values()),
    onChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
