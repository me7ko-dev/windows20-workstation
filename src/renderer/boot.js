import { createCanvas } from './canvas.js'
import { createDesktop } from './workspaces.js'
import { createCommandBar } from './command-bar.js'
import { createToasts } from './toast.js'
import { createMinimap } from './minimap.js'

const WELCOME = `Добре дошъл в работната станция.

• Ctrl+K — командната лента долу
• Ctrl+T — нов терминал
• Ctrl+N — нова бележка
• Ctrl+Shift+N — ново пространство
• Ctrl+Alt+N — нова станция (отделен прозорец)
• Ctrl+\` — обръща към следващата станция
• Ctrl+1…9 и Ctrl+Tab — между пространствата
• Ctrl+Shift+B — друг фон на случаен принцип
• Ctrl+M — картата на платното долу вдясно
• Ctrl+Shift+0 — побери всичко в екрана
• Ctrl+Shift+G — подреди прозорците
• Ctrl+Shift+E или двоен клик по заглавието —
  разгъва прозореца върху близките до него
• Ctrl+W — затвори избрания прозорец
• Ctrl+Shift+Space — говори
• Ctrl + колелце — мащаб, влачене по фона — местене

Пространствата са колкото ти трябват — „+“ вдясно
долу добавя ново. Празните не заемат памет.

Отляво са програмите, които наистина са на този компютър.
Тези с терминал се отварят тук, на платното.

За гласа: отвори Настройки (Ctrl+K → „настройки“) и
въведи ключ за транскрипция. Ако е фокусиран терминал,
казаното отива в него; иначе става команда.`

async function boot() {
  const viewport = document.getElementById('viewport')
  const plane = document.getElementById('plane')
  const root = document.getElementById('shell')

  const info = await window.w20.programs()
  const home = await window.w20.home()
  const station = await window.w20.station.info()

  if (station) document.getElementById('station').textContent = `СТАНЦИЯ ${station.id}`
  mountFlip()

  const toast = createToasts(root)
  const canvas = createCanvas(viewport, plane)
  const desktop = createDesktop({ plane, canvas, programs: info.programs, home })

  const saved = await window.w20.state.load()
  desktop.load(saved)
  const firstRun = !saved

  const minimap = createMinimap({ root, desktop, canvas, viewport })
  const bar = createCommandBar({ root, desktop, programs: info.programs, canvas, toast, minimap })
  buildDock(root, info.programs, desktop)

  if (!info.ptyAvailable) {
    toast(
      'node-pty не е построен за тази версия на Electron, затова терминалите няма да тръгнат. ' +
        'Спри приложението и пусни: npm run rebuild',
      { tone: 'warn', timeout: 0 }
    )
  }

  if (firstRun) {
    desktop.openNote(WELCOME, { title: 'Начало', width: 420, height: 340 })
    canvas.resetZoom()
  }

  /* ------------------------------------------------------------ shortcuts */

  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      bar.focus()
      return
    }
    if (ctrl && e.key.toLowerCase() === 't') {
      e.preventDefault()
      desktop.openTerminal()
      return
    }
    // Closes the window the user last touched — the same Ctrl+W the titlebar
    // has always promised.
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      const closed = desktop.closeFocused()
      if (!closed) toast('Нищо не е избрано — щракни върху прозорец', { timeout: 2200 })
      return
    }
    // Grow the selected window over the small ones beside it, and back.
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      const grown = desktop.expand()
      if (!grown) toast('Нищо не е избрано — щракни върху прозорец', { timeout: 2200 })
      else if (!grown.expanded) toast(`„${grown.title}“ се сви обратно`, { timeout: 2000 })
      else
        toast(
          grown.covered
            ? `„${grown.title}“ побра ${grown.covered} ${grown.covered === 1 ? 'съседен прозорец' : 'съседни прозореца'}`
            : `„${grown.title}“ е разгънат — няма близки прозорци`,
          { timeout: 2600 }
        )
      return
    }
    if (ctrl && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      toast(minimap.toggle() ? 'Картата е включена' : 'Картата е скрита', { timeout: 1600 })
      return
    }
    // Tidy the workspace into a grid. Shift, so a stray Ctrl+G never moves
    // three hundred windows by accident.
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      const count = desktop.tidy()
      toast(count ? `Подредени ${count} прозореца` : 'Пространството е празно', { timeout: 2200 })
      return
    }
    if (ctrl && e.shiftKey && e.code === 'Digit0') {
      e.preventDefault()
      const fit = desktop.fitAll()
      if (!fit) toast('Няма какво да се побере — пространството е празно', { timeout: 2200 })
      else if (!fit.fits) {
        minimap.setVisible(true)
        toast('Платното е по-широко от най-далечния мащаб — картата показва останалото', {
          tone: 'warn',
          timeout: 4000
        })
      }
      return
    }
    if (ctrl && e.shiftKey && e.code === 'Space') {
      e.preventDefault()
      bar.toggleVoice()
      return
    }
    // Turn to the next station. Matched on the physical key, so it works the
    // same on a Bulgarian layout as on a Latin one.
    if (ctrl && e.code === 'Backquote') {
      e.preventDefault()
      window.w20.station.cycle(e.shiftKey ? -1 : 1)
      return
    }
    // A whole second workstation, not another workspace inside this one.
    if (ctrl && e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      window.w20.station.open()
      return
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      desktop.addWorkspace()
      return
    }
    if (ctrl && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      desktop.openNote()
      return
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      const paper = desktop.randomWallpaper()
      toast(`Фон: ${paper.label}`, { timeout: 2200 })
      return
    }
    if (ctrl && e.key === 'Tab') {
      e.preventDefault()
      desktop.step(e.shiftKey ? -1 : 1)
      return
    }
    // Only the first nine get a digit; past that the strip and Ctrl+Tab carry it.
    if (ctrl && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      desktop.switchTo(Number(e.key) - 1)
      return
    }
    if (ctrl && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      canvas.zoomIn()
    } else if (ctrl && e.key === '-') {
      e.preventDefault()
      canvas.zoomOut()
    } else if (ctrl && e.key === '0') {
      e.preventDefault()
      canvas.resetZoom()
    }
  })

  document.body.classList.remove('is-booting')
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
}

boot().catch((err) => {
  document.body.classList.remove('is-booting')
  const fail = document.createElement('pre')
  fail.className = 'w20-fatal'
  fail.textContent = `Работната станция не можа да стартира:\n${err.stack || err.message}`
  document.body.appendChild(fail)
})
