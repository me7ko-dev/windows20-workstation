import { createNodeWindow } from './node-window.js'
import { mountTerminal } from './nodes/terminal.js'
import { mountNote } from './nodes/note.js'
import { mountLauncher } from './nodes/launcher.js'
import { mountSettings } from './nodes/settings.js'

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
 * Backgrounds. Each one carries its accent too, so picking a background themes
 * the whole station — the tabs, the station badge, the dot grid — rather than
 * just repainting behind the windows. That is what makes two stations tellable
 * apart at a glance.
 */
const WALLPAPERS = [
  {
    id: 'deep',
    label: 'Дълбочина',
    accent: '#5ee0ff',
    grid: 'rgba(255, 255, 255, 0.07)',
    css: 'radial-gradient(1200px 800px at 20% -10%, #17324a, transparent 60%), linear-gradient(160deg, #0b0d12, #131824)'
  },
  {
    id: 'aurora',
    label: 'Полярно',
    accent: '#6ee7a8',
    grid: 'rgba(160, 255, 210, 0.08)',
    css: 'radial-gradient(900px 700px at 80% 0%, #1d3b34, transparent 60%), radial-gradient(1000px 600px at 10% 90%, #2a1f3d, transparent 60%), linear-gradient(160deg, #0a0c11, #10141d)'
  },
  {
    id: 'ember',
    label: 'Жар',
    accent: '#ff9f5a',
    grid: 'rgba(255, 180, 120, 0.08)',
    css: 'radial-gradient(1000px 700px at 75% 10%, #3a2016, transparent 60%), linear-gradient(160deg, #0d0b0a, #1a1512)'
  },
  {
    id: 'slate',
    label: 'Шисти',
    accent: '#9aa2b1',
    grid: 'rgba(255, 255, 255, 0.06)',
    css: 'linear-gradient(160deg, #0e1014, #1b1f27)'
  },
  {
    id: 'matrix',
    label: 'Матрицата',
    accent: '#39ff14',
    grid: 'rgba(57, 255, 20, 0.13)',
    css: 'radial-gradient(1100px 800px at 50% -10%, #04240f, transparent 65%), linear-gradient(180deg, #000400, #020d05)'
  },
  {
    id: 'amber',
    label: 'Кехлибарен терминал',
    accent: '#ffb000',
    grid: 'rgba(255, 176, 0, 0.12)',
    css: 'radial-gradient(1300px 900px at 50% 100%, #3d2800, transparent 70%), linear-gradient(180deg, #0a0700, #1c1305)'
  },
  {
    id: 'neon',
    label: 'Неон',
    accent: '#ff2fd0',
    grid: 'rgba(255, 47, 208, 0.12)',
    css: 'radial-gradient(900px 700px at 15% 0%, #2a0a3d, transparent 60%), radial-gradient(900px 700px at 85% 100%, #062a3d, transparent 60%), linear-gradient(160deg, #07040c, #0d0716)'
  },
  {
    id: 'synth',
    label: 'Синтуейв',
    accent: '#ff6ad5',
    grid: 'rgba(255, 106, 213, 0.14)',
    css: 'linear-gradient(180deg, #150726 0%, #2b0f3f 45%, #45123f 62%, #0a0512 63%, #060209 100%)'
  },
  {
    id: 'toxic',
    label: 'Токсично',
    accent: '#c6ff00',
    grid: 'rgba(198, 255, 0, 0.12)',
    css: 'radial-gradient(1000px 800px at 30% 100%, #1b2600, transparent 60%), linear-gradient(160deg, #06080a, #0e1206)'
  },
  {
    id: 'ice',
    label: 'Лед',
    accent: '#7adbff',
    grid: 'rgba(122, 219, 255, 0.11)',
    css: 'radial-gradient(1100px 800px at 60% -10%, #0b2b3d, transparent 62%), linear-gradient(170deg, #04080d, #0a1420)'
  },
  {
    id: 'blood',
    label: 'Кръв',
    accent: '#ff4d4d',
    grid: 'rgba(255, 77, 77, 0.11)',
    css: 'radial-gradient(1000px 750px at 40% 0%, #2e0708, transparent 62%), linear-gradient(170deg, #070203, #14070a)'
  },
  {
    id: 'void',
    label: 'Празнота',
    accent: '#7f8794',
    grid: 'rgba(255, 255, 255, 0.045)',
    css: 'linear-gradient(180deg, #000000, #05060a)'
  }
]

const DEFAULT_SIZES = {
  terminal: { width: 720, height: 460 },
  note: { width: 340, height: 280 },
  launcher: { width: 320, height: 300 },
  settings: { width: 380, height: 420 }
}

/** How far outside the viewport a window is still worth painting. */
const CULL_MARGIN = 400

let seq = 0
function nextId(type) {
  seq += 1
  return `${type}-${Date.now().toString(36)}-${seq}`
}

export function createDesktop({ plane, canvas, programs, home }) {
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

  function blankWorkspace(wallpaper) {
    return {
      id: nextId('ws'),
      name: nextName(),
      wallpaper,
      cwd: home,
      view: { x: 0, y: 0, zoom: 1 },
      nodes: []
    }
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
        ws.nodes = ws.nodes.filter((n) => n.type !== 'terminal')
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
    const win = createNodeWindow({
      node,
      canvas,
      plane: planeFor(activeIndex),
      onChange: changed,
      onClose: (n) => closeNode(n.id),
      // Dictation needs to know which terminal the words belong to.
      onFocus: (n) => {
        focusedId = n.id
      }
    })

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
      content = mountSettings(win, {})
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
    canvas.setView(ws.view)
    cull()
    emit()
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
      ws.nodes = ws.nodes.filter((n) => n.id !== id)
    }
    changed()
  }

  /* -------------------------------------------------------- public api */

  function addNode(partial, { focus = true } = {}) {
    const size = DEFAULT_SIZES[partial.type] || DEFAULT_SIZES.terminal
    const center = canvas.viewportCenter()
    const ws = activeWorkspace()

    const node = {
      id: nextId(partial.type),
      x: Math.round(center.x - size.width / 2 + (ws.nodes.length % 4) * 28),
      y: Math.round(center.y - size.height / 2 + (ws.nodes.length % 4) * 24),
      width: size.width,
      height: size.height,
      ...size,
      ...partial
    }

    ws.nodes.push(node)
    const { win, content } = mountNode(node)
    if (focus && content && content.focus) requestAnimationFrame(() => content.focus())
    scheduleCull()
    changed()
    return { node, win, content }
  }

  function openTerminal({ title, shell, args, cwd, accent, badge } = {}) {
    return addNode({
      type: 'terminal',
      title: title || 'Терминал',
      shell,
      args,
      cwd: cwd || activeWorkspace().cwd,
      accent
    })
  }

  function openProgram(program, { cwd } = {}) {
    if (program.kind === 'external') {
      return addNode({ type: 'launcher', title: program.title, programId: program.id, accent: program.accent })
    }
    return openTerminal({
      title: program.title,
      shell: program.path || program.command,
      cwd: cwd || activeWorkspace().cwd,
      accent: program.accent
    })
  }

  function openSettings() {
    const existing = Array.from(live.values()).find((entry) => entry.win.node.type === 'settings')
    if (existing) {
      existing.win.raise()
      existing.win.focusInView()
      return existing
    }
    return addNode({ type: 'settings', title: 'Настройки', accent: '#9aa2b1', width: 380, height: 420 })
  }

  function openNote(text = '', size = {}) {
    return addNode({ type: 'note', title: 'Бележка', text, accent: '#ffd166', ...size })
  }

  function switchTo(index) {
    if (index < 0 || index >= workspaces.length || index === activeIndex) return
    const leaving = activeWorkspace()
    leaving.view = { ...canvas.view }
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
    // A new workspace keeps the station's colours; the station is the identity.
    const ws = blankWorkspace(activeWorkspace().wallpaper)
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

  function setWallpaper(id) {
    const paper = WALLPAPERS.find((w) => w.id === id)
    if (!paper) return
    activeWorkspace().wallpaper = paper.id
    applyWallpaper()
    changed()
  }

  function applyWallpaper() {
    const ws = activeWorkspace()
    const paper = WALLPAPERS.find((w) => w.id === ws.wallpaper) || WALLPAPERS[0]
    document.body.style.setProperty('--wallpaper', paper.css)
    document.body.style.setProperty('--accent', paper.accent)
    document.body.style.setProperty('--grid-color', paper.grid)
  }

  /** Anything but the one already on screen — a reroll that changes nothing is a bug. */
  function randomWallpaper() {
    const current = activeWorkspace().wallpaper
    const others = WALLPAPERS.filter((w) => w.id !== current)
    const paper = others[Math.floor(Math.random() * others.length)]
    setWallpaper(paper.id)
    return paper
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
    entry.win.raise()
    entry.win.focusInView()
    entry.win.el.classList.add('is-flashing')
    setTimeout(() => entry.win.el.classList.remove('is-flashing'), 900)
  }

  function load(state) {
    workspaces.length = 0
    const saved = state && Array.isArray(state.workspaces) && state.workspaces.length ? state.workspaces : null
    const count = saved ? saved.length : 4
    // A station opening for the first time draws its own colours, so the second
    // and third one do not come up looking like the first.
    const fresh = WALLPAPERS[Math.floor(Math.random() * WALLPAPERS.length)].id
    for (let i = 0; i < count; i += 1) {
      const base = blankWorkspace(fresh)
      workspaces.push(saved ? { ...base, ...saved[i], nodes: saved[i].nodes || [] } : base)
    }
    activeIndex =
      state && Number.isInteger(state.activeIndex)
        ? Math.min(workspaces.length - 1, Math.max(0, state.activeIndex))
        : 0
    applyWallpaper()
    renderActive()
  }

  canvas.onChange(() => {
    activeWorkspace().view = { ...canvas.view }
    scheduleCull()
    scheduleSave()
  })

  window.addEventListener('resize', scheduleCull)

  return {
    WALLPAPERS,
    load,
    addNode,
    openTerminal,
    openProgram,
    openNote,
    openSettings,
    closeNode,
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
