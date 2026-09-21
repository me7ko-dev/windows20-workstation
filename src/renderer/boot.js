import { createCanvas } from './canvas.js'
import { createDesktop } from './workspaces.js'
import { createCommandBar } from './command-bar.js'
import { createToasts } from './toast.js'

const WELCOME = `Добре дошъл в работната станция.

• Ctrl+K — командната лента долу
• Ctrl+T — нов терминал
• Ctrl+N — нова бележка
• Ctrl+Shift+N — ново пространство
• Ctrl+1…9 и Ctrl+Tab — между пространствата
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

  const toast = createToasts(root)
  const canvas = createCanvas(viewport, plane)
  const desktop = createDesktop({ plane, canvas, programs: info.programs, home })

  const saved = await window.w20.state.load()
  desktop.load(saved)
  const firstRun = !saved

  const bar = createCommandBar({ root, desktop, programs: info.programs, canvas, toast })
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
    if (ctrl && e.shiftKey && e.code === 'Space') {
      e.preventDefault()
      bar.toggleVoice()
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
