import { createCanvas } from './canvas.js'
import { createDesktop } from './workspaces.js'
import { createCommandBar } from './command-bar.js'
import { createToasts } from './toast.js'
import { createMinimap } from './minimap.js'
import { createSpeaker } from './speaker.js'
import { createOverview } from './overview.js'
import { createKeymap } from './keymap.js'
import { loadTheme } from './theme.js'
import { createMusic } from './music.js'

async function boot() {
  const viewport = document.getElementById('viewport')
  const plane = document.getElementById('plane')
  const root = document.getElementById('shell')

  // Before anything is drawn, so a light station never flashes dark.
  await loadTheme()
  const info = await window.w20.programs()
  const home = await window.w20.home()
  const station = await window.w20.station.info()

  const badge = document.getElementById('station')
  mountFlip()
  mountFrame()
  const clean = await mountClean()

  const toast = createToasts(root)
  const speaker = createSpeaker({ toast })
  const canvas = createCanvas(viewport, plane)

  // Fields stay clear of the dock on the left and the bar at the bottom.
  // Measured when laid out, so a narrower dock gives the fields its width.
  let dockEl = null
  let barEl = null
  function insets() {
    const view = viewport.getBoundingClientRect()
    const dock = dockEl ? dockEl.getBoundingClientRect() : null
    const bar = barEl ? barEl.getBoundingClientRect() : null
    // In the clean look the dock is tucked away and comes over the fields
    // when called, so the fields keep the whole width.
    const tucked = document.body.classList.contains('is-clean')
    return {
      left: !tucked && dock && dock.width ? Math.round(dock.right - view.left + 14) : 16,
      top: 14,
      right: 14,
      bottom: bar && bar.height ? Math.round(view.bottom - bar.top + 12) : 96
    }
  }

  const desktop = createDesktop({
    plane,
    canvas,
    programs: info.programs,
    home,
    speaker,
    insets,
    notify: (message) => toast(message, { tone: 'warn', timeout: 6000 })
  })

  const saved = await window.w20.state.load()
  desktop.load(saved)

  const minimap = createMinimap({ root, desktop, canvas, viewport })
  const music = createMusic({ toast })
  speaker.onActive((talking) => (talking ? music.hold('speak') : music.release('speak')))
  const bar = createCommandBar({ root, desktop, programs: info.programs, canvas, toast, minimap, speaker, music })
  desktop.setStationActions(() => bar.stationActions())
  barEl = root.querySelector('.w20-bar-main')
  dockEl = buildDock(root, info.programs, desktop)
  const overview = createOverview({ root, desktop })
  bar.onOverview(() => overview.toggle())
  buildEmpty(root, info.programs, desktop, overview, music)
  clean.attach(dockEl, () => desktop.relayout({ glide: false }))

  // Zooming out of a station is stepping back to see all of them.
  canvas.onZoomOut(() => overview.show())

  // Which station this is, in the title bar — and which Windows window, once
  // there is more than one.
  function drawBadge() {
    const ws = desktop.activeWorkspace()
    const windowTag = station && station.count > 1 ? ` · ПРОЗОРЕЦ ${station.id}` : ''
    badge.textContent = `СТАНЦИЯ ${ws.name}${windowTag}`
  }
  desktop.onChange(drawBadge)
  drawBadge()

  // The dock and the bar exist now: lay the fields out around them.
  desktop.relayout({ glide: false })

  if (!info.ptyAvailable) {
    toast(
      'node-pty не е построен за тази версия на Electron, затова терминалите няма да тръгнат. ' +
        'Спри приложението и пусни: npm run rebuild',
      { tone: 'warn', timeout: 0 }
    )
  }

  /* ------------------------------------------------------------ shortcuts */

  const keymap = createKeymap({ desktop, bar, canvas, minimap, overview, toast, root, programs: info.programs })
  window.addEventListener('keydown', (e) => {
    if (overview.open) return
    keymap.handle(e)
  })
  bar.onEditKeys(() => keymap.editKeys())
  document.addEventListener('w20:edit-keys', () => keymap.editKeys())
  document.addEventListener('w20:genesis-install', () => desktop.installGenesis())
  // The user's own keys from keybindings.json, over the defaults.
  keymap.reload()

  // The keys that work from anywhere in Windows: the station is in front by
  // now, and "voice" wants it listening too.
  if (window.w20.ui) {
    window.w20.ui.onGlobal((what) => {
      if (what === 'voice') bar.toggleVoice()
      // The + key: from anywhere, the window stays where it is. Behind other
      // programs the words are a command, never dictation into a terminal.
      if (what === 'mic') bar.toggleVoice({ command: !document.hasFocus() })
    })
  }

  document.body.classList.remove('is-booting')
}

/**
 * What an empty station shows: the things worth opening, one click each, and
 * the keys that open them. Hidden as soon as the station has a window.
 */
function buildEmpty(root, programs, desktop, overview, music) {
  const el = document.createElement('div')
  el.className = 'w20-empty'
  el.innerHTML = `
    <div class="w20-empty-card">
      <h2 class="w20-empty-title"></h2>
      <p class="w20-empty-sub">До 4 полета, по 4 прозореца във всяко. Всичко се подрежда само.</p>
      <div class="w20-empty-grid" data-role="grid"></div>
      <p class="w20-empty-keys">
        <span><kbd>+</kbd> говори (цифровата клавиатура)</span>
        <span><kbd>F3</kbd> всички станции</span>
        <span><kbd>Ctrl+K</kbd> команди и ИИ</span>
        <span><kbd>Ctrl+Space</kbd> водещ клавиш</span>
        <span><kbd>F1</kbd> всички клавиши</span>
      </p>
    </div>
  `
  root.appendChild(el)
  const grid = el.querySelector('[data-role="grid"]')
  const byId = (id) => programs.find((p) => p.id === id && p.installed)

  const choices = [
    { icon: '›_', label: 'Терминал', key: 'Ctrl+T', accent: '#5ee0ff', run: () => desktop.openTerminal() },
    ...['claude', 'gemini', 'codex', 'aider', 'opencode', 'qwen']
      .map(byId)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => ({ icon: p.icon, label: p.title, accent: p.accent, run: () => desktop.openProgram(p) })),
    { icon: '✺', label: 'ИИ чат', key: 'Ctrl+Shift+I', accent: '#c4b5fd', run: () => desktop.openChat() },
    { icon: '◎', label: 'Браузър', key: 'Ctrl+Space B', accent: '#4caf50', run: () => desktop.openWeb() },
    { icon: '♪', label: 'Музика', key: 'YouTube', accent: '#ff4f79', run: () => music.open() },
    { icon: '✎', label: 'Бележка', key: 'Ctrl+N', accent: '#ffd166', run: () => desktop.openNote() },
    { icon: '⚙', label: 'Глас и ИИ', key: 'безплатно', accent: '#9aa2b1', run: () => desktop.openSettings() }
  ].slice(0, 8)

  for (const choice of choices) {
    const btn = document.createElement('button')
    btn.className = 'w20-empty-btn'
    btn.style.setProperty('--node-accent', choice.accent)
    btn.innerHTML = `<b></b><span></span>${choice.key ? '<kbd></kbd>' : ''}`
    btn.querySelector('b').textContent = choice.icon
    btn.querySelector('span').textContent = choice.label
    if (choice.key) btn.querySelector('kbd').textContent = choice.key
    btn.addEventListener('click', choice.run)
    grid.appendChild(btn)
  }

  function sync() {
    const ws = desktop.activeWorkspace()
    el.hidden = !(ws.layout === 'fields' && ws.nodes.length === 0)
    el.querySelector('.w20-empty-title').textContent = `Станция ${ws.name}`
  }
  desktop.onChange(sync)
  sync()
}

/**
 * The window has no frame: minimise, maximise and close are ours, in the
 * title bar, so they can tuck away with it.
 */
function mountFrame() {
  const bar = document.querySelector('.w20-titlebar')
  if (!bar || !window.w20.win) return
  const box = document.createElement('div')
  box.className = 'w20-winbtns'
  box.innerHTML = `
    <button data-win="minimize" title="Смали"><svg viewBox="0 0 12 12"><path d="M2 6.5h8v1H2z"/></svg></button>
    <button data-win="maximize" title="Цял екран"><svg viewBox="0 0 12 12"><path d="M2.5 2.5h7v7h-7z" fill="none" stroke="currentColor"/></svg></button>
    <button data-win="close" class="is-close" title="Затвори"><svg viewBox="0 0 12 12"><path d="M2.6 2 6 5.4 9.4 2l.6.6L6.6 6 10 9.4l-.6.6L6 6.6 2.6 10 2 9.4 5.4 6 2 2.6z"/></svg></button>
  `
  bar.appendChild(box)
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-win]')
    if (btn) window.w20.win.control(btn.dataset.win)
  })
  window.w20.win.onState(({ maximized }) => {
    document.body.classList.toggle('is-maximized', Boolean(maximized))
    box.querySelector('[data-win="maximize"]').title = maximized ? 'Върни размера' : 'Цял екран'
  })
}

/**
 * The clean look: the title bar and the dock tuck away, and the window's top
 * and left edges bring them back. The pointer is followed on the whole page —
 * a drag region swallows its own mouse events, so the bar cannot tell when it
 * is left; the page under it can.
 */
async function mountClean() {
  const body = document.body
  const top = document.createElement('div')
  top.className = 'w20-edge w20-edge-top'
  const left = document.createElement('div')
  left.className = 'w20-edge w20-edge-left'
  body.append(top, left)

  let dock = null
  let onLayout = () => {}
  let hideTop = 0
  let hideLeft = 0

  const reveal = (cls) => {
    clearTimeout(cls === 'show-top' ? hideTop : hideLeft)
    body.classList.add(cls)
  }
  const conceal = (cls, wait = 450) => {
    const timer = setTimeout(() => body.classList.remove(cls), wait)
    if (cls === 'show-top') {
      clearTimeout(hideTop)
      hideTop = timer
    } else {
      clearTimeout(hideLeft)
      hideLeft = timer
    }
  }

  top.addEventListener('mouseenter', () => reveal('show-top'))
  left.addEventListener('mouseenter', () => reveal('show-left'))
  window.addEventListener('mousemove', (e) => {
    if (!body.classList.contains('is-clean')) return
    if (e.clientY <= 4) reveal('show-top')
    else if (body.classList.contains('show-top') && e.clientY > 70) conceal('show-top')
    if (e.clientX <= 4) reveal('show-left')
    else if (body.classList.contains('show-left')) {
      const edge = dock ? dock.getBoundingClientRect().right : 120
      if (e.clientX > edge + 40) conceal('show-left')
    }
  })
  document.documentElement.addEventListener('mouseleave', () => {
    conceal('show-top', 700)
    conceal('show-left', 700)
  })

  async function set(on, save) {
    body.classList.toggle('is-clean', on)
    if (!on) body.classList.remove('show-top', 'show-left')
    onLayout()
    if (save) await window.w20.settings.set({ look: { clean: on } })
  }

  const state = await window.w20.settings.get()
  await set(!state || !state.look || state.look.clean !== false, false)
  document.addEventListener('w20:toggle-clean', () => set(!body.classList.contains('is-clean'), true))

  return {
    attach(dockEl, layout) {
      dock = dockEl
      onLayout = layout
      // A program opened from the dock: the dock has done its job.
      if (dock) dock.addEventListener('click', () => conceal('show-left', 150))
    }
  }
}

/**
 * Turning from one station to the next. Each window only ever plays its own
 * half — turning away, or turning in — because they are separate OS windows
 * and no transform can span them.
 */
const TURN_IN_MS = 260

function mountFlip() {
  const shell = document.getElementById('shell')
  let settle = 0

  window.w20.station.onFlip(({ half, direction }) => {
    clearTimeout(settle)
    shell.classList.remove('is-turning-out', 'is-turning-in')
    // Restart the animation even if the same class was just removed.
    void shell.offsetWidth
    shell.dataset.turn = direction

    if (half === 'out') {
      // Holds the turned-away pose: this window is behind now, and snapping it
      // upright would flash the canvas before the next station is in front.
      shell.classList.add('is-turning-out')
      return
    }

    shell.classList.add('is-turning-in')
    // A timer rather than `animationend`, which a window still coming out of
    // the background may never fire — and then the class would never lift.
    settle = setTimeout(() => shell.classList.remove('is-turning-in'), TURN_IN_MS)
  })

  // Back in front by any route — the shortcut, the taskbar, a click.
  window.addEventListener('focus', () => shell.classList.remove('is-turning-out'))
}

/** The strip of installed tools — one click puts a program on the canvas. */
function buildDock(root, programs, desktop) {
  const dock = document.createElement('aside')
  dock.className = 'w20-dock'

  const installed = programs.filter((p) => p.installed)
  const missing = programs.filter((p) => !p.installed)

  for (const program of [...installed, ...missing]) {
    const btn = document.createElement('button')
    btn.className = 'w20-dock-item' + (program.installed ? '' : ' is-missing')
    btn.style.setProperty('--node-accent', program.accent)
    btn.title = program.installed ? `${program.title} — ${program.path}` : `${program.title} не е намерена`
    btn.innerHTML = `<span class="w20-dock-glyph"></span><span class="w20-dock-label"></span>`
    btn.querySelector('.w20-dock-glyph').textContent = program.icon
    btn.querySelector('.w20-dock-label').textContent = program.title
    btn.addEventListener('click', () => desktop.openProgram(program))
    dock.appendChild(btn)
  }

  root.appendChild(dock)
  return dock
}

boot().catch((err) => {
  document.body.classList.remove('is-booting')
  const fail = document.createElement('pre')
  fail.className = 'w20-fatal'
  fail.textContent = `Работната станция не можа да стартира:\n${err.stack || err.message}`
  document.body.appendChild(fail)
})
