import { createNodeWindow } from './node-window.js'
import { mountTerminal } from './nodes/terminal.js'
import { mountNote } from './nodes/note.js'
import { mountLauncher } from './nodes/launcher.js'
import { mountSettings } from './nodes/settings.js'

/**
 * Workspaces hold the layout; this module owns the live windows.
 *
 * Only the active workspace has DOM. Switching tears the old one down and
 * rebuilds from the model — except terminals, which cannot be rebuilt without
 * killing the process, so a workspace holding a running agent keeps its plane
 * alive and hidden instead.
 */

const WALLPAPERS = [
  { id: 'deep', label: 'Дълбочина', css: 'radial-gradient(1200px 800px at 20% -10%, #17324a, transparent 60%), linear-gradient(160deg, #0b0d12, #131824)' },
  { id: 'aurora', label: 'Полярно', css: 'radial-gradient(900px 700px at 80% 0%, #1d3b34, transparent 60%), radial-gradient(1000px 600px at 10% 90%, #2a1f3d, transparent 60%), linear-gradient(160deg, #0a0c11, #10141d)' },
  { id: 'ember', label: 'Жар', css: 'radial-gradient(1000px 700px at 75% 10%, #3a2016, transparent 60%), linear-gradient(160deg, #0d0b0a, #1a1512)' },
  { id: 'slate', label: 'Шисти', css: 'linear-gradient(160deg, #0e1014, #1b1f27)' }
]

const DEFAULT_SIZES = {
  terminal: { width: 720, height: 460 },
  note: { width: 340, height: 280 },
  launcher: { width: 320, height: 300 },
  settings: { width: 380, height: 420 }
}

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
  const planes = new Map() // workspaceIndex -> plane element
  const listeners = new Set()
  let saveTimer = null

  function emit() {
    for (const fn of listeners) fn(snapshot())
  }

  function activeWorkspace() {
    return workspaces[activeIndex]
  }

  function planeFor(index) {
    if (planes.has(index)) return planes.get(index)
    const el = document.createElement('div')
    el.className = 'w20-plane-layer'
    el.dataset.workspace = String(index)
    plane.appendChild(el)
    planes.set(index, el)
    return el
  }

  /* ------------------------------------------------------------ model */

  function blankWorkspace(index) {
    return {
      name: String(index + 1).padStart(2, '0'),
      wallpaper: WALLPAPERS[index % WALLPAPERS.length].id,
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
    for (const [index, el] of planes) el.hidden = index !== activeIndex
    const ws = activeWorkspace()
    const layer = planeFor(activeIndex)
    // Mount anything in the model that has no window yet (first visit, or a
    // workspace whose non-terminal windows were torn down).
    for (const node of ws.nodes) {
      if (!live.has(node.id)) mountNode(node)
    }
    layer.hidden = false
    canvas.setView(ws.view)
    emit()
  }

  function closeNode(id) {
    if (focusedId === id) focusedId = null
    const entry = live.get(id)
    if (entry) {
      if (entry.content && entry.content.destroy) entry.content.destroy()
      entry.win.destroy()
      live.delete(id)
    }
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
    activeWorkspace().view = { ...canvas.view }
    activeIndex = index
    renderActive()
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
    const saved = state && Array.isArray(state.workspaces) ? state.workspaces : null
    for (let i = 0; i < 4; i += 1) {
      const base = blankWorkspace(i)
      workspaces.push(saved && saved[i] ? { ...base, ...saved[i], nodes: saved[i].nodes || [] } : base)
    }
    activeIndex = state && Number.isInteger(state.activeIndex) ? Math.min(3, Math.max(0, state.activeIndex)) : 0
    applyWallpaper()
    renderActive()
  }

  canvas.onChange(() => {
    activeWorkspace().view = { ...canvas.view }
    scheduleSave()
  })

  return {
    WALLPAPERS,
    load,
    addNode,
    openTerminal,
    openProgram,
    openNote,
    openSettings,
    closeNode,
    /** The terminal the user last touched — where dictated text should go. */
    focusedTerminal: () => {
      const entry = focusedId ? live.get(focusedId) : null
      if (!entry || entry.win.node.type !== 'terminal') return null
      return entry
    },
    switchTo,
    setWallpaper,
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
