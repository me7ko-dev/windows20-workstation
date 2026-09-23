/**
 * A terminal node: xterm in the window, ConPTY behind it. The window is the
 * running program, so closing the window kills the process — anything else
 * would leak agents nobody can see any more.
 */

import { isStationKey } from '../keymap.js'
import { terminalTheme, onTheme } from '../theme.js'

const { Terminal } = window
const { FitAddon } = window.FitAddon || {}

export function mountTerminal(win, { cwd, shell, args, onExit }) {
  const term = new Terminal({
    fontFamily: "'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.22,
    fontWeight: '400',
    fontWeightBold: '700',
    cursorBlink: true,
    allowProposedApi: true,
    // Scrollback is the one part of a terminal that grows without bound. At
    // 2000 lines a busy agent costs a few MB, so a canvas full of them stays
    // in the hundreds of MB rather than eating the machine.
    scrollback: 2000,
    theme: terminalTheme()
  })
  const offTheme = onTheme((mode) => {
    term.options.theme = terminalTheme(mode)
  })

  // The station's keys pass through; everything else is the program's. Plus
  // copy and paste the way Windows Terminal does them: Ctrl+C copies when
  // there is a selection (and stops the process when there is not), Ctrl+V
  // pastes, and Ctrl+Shift+C / Ctrl+Shift+V always do.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (isStationKey(e)) return false
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.code === 'KeyC' && (e.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) window.w20.clipboard.write(term.getSelection())
      term.clearSelection()
      e.preventDefault()
      return false
    }
    if (ctrl && e.code === 'KeyV' && !e.altKey) {
      const text = window.w20.clipboard.read()
      if (text) term.paste(text)
      e.preventDefault()
      return false
    }
    return true
  })

  const fit = FitAddon ? new FitAddon() : null
  if (fit) term.loadAddon(fit)

  const host = document.createElement('div')
  host.className = 'w20-term'
  win.body.appendChild(host)
  term.open(host)

  const id = win.node.id
  let alive = true

  function sync() {
    if (!fit || !alive) return
    try {
      fit.fit()
      window.w20.term.resize(id, term.cols, term.rows)
    } catch {
      // the window is mid-layout; the next resize will catch up
    }
  }

  window.w20.term
    .create({ id, cwd, shell, args, programId: win.node.programId, cols: term.cols || 80, rows: term.rows || 24 })
    .then((result) => {
      if (result.ok) {
        win.setBadge('работи', 'live')
        sync()
        return
      }
      alive = false
      win.setBadge('грешка', 'error')
      term.writeln(`\x1b[31m${result.error}\x1b[0m`)
      term.writeln('')
      term.writeln('\x1b[90mТерминалът иска node-pty. Пусни: npm run rebuild\x1b[0m')
    })

  const offData = window.w20.term.onData(({ id: from, data }) => {
    if (from === id) term.write(data)
  })

  const offExit = window.w20.term.onExit(({ id: from, exitCode }) => {
    if (from !== id) return
    alive = false
    win.setBadge(exitCode === 0 ? 'приключи' : `изход ${exitCode}`, exitCode === 0 ? '' : 'error')
    term.writeln(`\r\n\x1b[90m— процесът приключи (${exitCode}) —\x1b[0m`)
    if (onExit) onExit(exitCode)
  })

  term.onData((data) => {
    if (alive) window.w20.term.write(id, data)
  })

  win.onResized(sync)
  const observer = new ResizeObserver(sync)
  observer.observe(host)

  // Clicking anywhere in the body should put the caret back in the terminal.
  win.body.addEventListener('pointerup', (e) => {
    if (!term.hasSelection() && e.button === 0) term.focus()
  })

  requestAnimationFrame(sync)

  return {
    focus: () => term.focus(),
    send: (text) => {
      if (alive) window.w20.term.write(id, text)
    },
    destroy: () => {
      alive = false
      offData()
      offExit()
      offTheme()
      observer.disconnect()
      window.w20.term.kill(id)
      term.dispose()
    }
  }
}
