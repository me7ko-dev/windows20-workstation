/**
 * Dark, light, or whatever Windows is set to.
 *
 * The choice lives with the other settings in the main process, so every
 * station window follows it; here it becomes `data-theme` on the root, which
 * is all the stylesheet looks at, plus a theme for the terminals, which draw
 * their own colours and cannot read CSS.
 */

const listeners = new Set()
const media = window.matchMedia('(prefers-color-scheme: light)')
let choice = 'dark'

/** What is actually showing: never "system". */
export function resolved() {
  if (choice === 'system') return media.matches ? 'light' : 'dark'
  return choice === 'light' ? 'light' : 'dark'
}

export function chosen() {
  return choice
}

function paint() {
  const now = resolved()
  document.documentElement.dataset.theme = now
  if (window.w20.ui) window.w20.ui.theme(now)
  for (const fn of listeners) fn(now)
}

export function setTheme(next, { save = true } = {}) {
  choice = ['dark', 'light', 'system'].includes(next) ? next : 'dark'
  paint()
  if (save) window.w20.settings.set({ look: { theme: choice } })
  return resolved()
}

/** Dark ↔ light. From "system" it goes to the opposite of what is showing. */
export function toggleTheme() {
  return setTheme(resolved() === 'light' ? 'dark' : 'light')
}

export function onTheme(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function loadTheme() {
  const state = await window.w20.settings.get()
  setTheme((state && state.look && state.look.theme) || 'dark', { save: false })
}

media.addEventListener('change', () => {
  if (choice === 'system') paint()
})

// Another station window changed it.
if (window.w20.ui && window.w20.ui.onTheme) {
  window.w20.ui.onTheme((next) => {
    if (next !== choice) setTheme(next, { save: false })
  })
}

/** xterm's colours. The background stays clear — the window paints it. */
export function terminalTheme(mode = resolved()) {
  if (mode === 'light') {
    return {
      background: 'rgba(0,0,0,0)',
      foreground: '#1b2130',
      cursor: '#0b7285',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(11,114,133,0.22)',
      black: '#1b2130',
      red: '#c92a2a',
      green: '#2b8a3e',
      yellow: '#a36a00',
      blue: '#1c5fd4',
      magenta: '#9c36b5',
      cyan: '#0b7285',
      white: '#6b7385',
      brightBlack: '#5c6475',
      brightRed: '#e03131',
      brightGreen: '#2f9e44',
      brightYellow: '#b57a00',
      brightBlue: '#1971c2',
      brightMagenta: '#ae3ec9',
      brightCyan: '#0c8599',
      brightWhite: '#343a46'
    }
  }
  return {
    background: 'rgba(0,0,0,0)',
    foreground: '#e6eaf2',
    cursor: '#5ee0ff',
    selectionBackground: 'rgba(94,224,255,0.25)'
  }
}
