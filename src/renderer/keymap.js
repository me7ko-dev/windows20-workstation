/**
 * Every shortcut in one table.
 *
 * The table is what handles a key, what the cheat sheet shows, and what a
 * terminal asks before it takes a key for itself — so a shortcut cannot be
 * documented in one place and behave differently in another.
 *
 * Keys are matched by `code`, the physical key, never by the character it
 * types: with a Bulgarian layout Ctrl+K types a Cyrillic letter, and a
 * shortcut that stops working when the language changes is broken.
 *
 * Inside a terminal, Ctrl+letter belongs to the program running there —
 * Ctrl+W deletes a word in bash, Ctrl+K cuts a line, Ctrl+C stops a process.
 * Every station shortcut on Ctrl+letter therefore has a Ctrl+Shift twin that
 * works everywhere, terminals included.
 */

const DISPLAY = {
  Backquote: '`',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

export function display(combo) {
  return combo
    .split('+')
    .map((part) => {
      if (DISPLAY[part]) return DISPLAY[part]
      if (/^Key[A-Z]$/.test(part)) return part.slice(3)
      if (/^Digit/.test(part)) return part.slice(5)
      return part
    })
    .join('+')
}

/** The event as a combo string: modifiers in a fixed order, then the code. */
export function comboOf(e) {
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let code = e.code
  // Tests and some keyboards send no code; the key still says what it was.
  if (!code && e.key) {
    if (/^[a-z]$/i.test(e.key)) code = `Key${e.key.toUpperCase()}`
    else if (/^[0-9]$/.test(e.key)) code = `Digit${e.key}`
    else if (e.key === '=' || e.key === '+') code = 'Equal'
    else if (e.key === '-') code = 'Minus'
    else code = e.key
  }
  if (code === 'NumpadAdd') code = 'Equal'
  if (code === 'NumpadSubtract') code = 'Minus'
  parts.push(code)
  return parts.join('+')
}

/** A plain Ctrl+letter — what a shell owns while its terminal has the keys. */
function shellOwns(combo) {
  return /^Ctrl\+Key[A-Z]$/.test(combo)
}

let active = null

/**
 * For the terminal: is this key the station's rather than the program's?
 * True while a leader sequence is waiting for its second key, too.
 */
export function isStationKey(e) {
  if (!active) return false
  if (active.leaderPending()) return true
  const combo = comboOf(e)
  if (shellOwns(combo)) return false
  return active.has(combo)
}

export function createKeymap(ctx) {
  const { desktop, bar, canvas, minimap, overview, toast } = ctx
  const say = (message) => bar.flash(message)

  const bindings = [
    /* ------------------------------------------------------- stations */
    {
      group: 'Станции',
      keys: ['F3', 'Ctrl+Shift+KeyA'],
      label: 'Всички станции — назад и избор',
      run: () => overview.toggle()
    },
    {
      group: 'Станции',
      keys: ['Ctrl+Shift+KeyN'],
      label: 'Нова станция (със своя картина)',
      run: () => desktop.addWorkspace()
    },
    {
      group: 'Станции',
      keys: ['Ctrl+Digit1…9', 'Ctrl+Digit0'],
      label: 'Станция по номер (0 е десетата)',
      run: null
    },
    {
      group: 'Станции',
      keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'],
      label: 'Следваща / предишна станция',
      run: null
    },
    {
      group: 'Станции',
      keys: ['Ctrl+Shift+KeyB'],
      label: 'Друга картина за тази станция',
      run: () => {
        const paper = desktop.randomWallpaper()
        say(`Картина: ${paper.label}`)
      }
    },
    {
      group: 'Станции',
      keys: ['Ctrl+Shift+KeyL'],
      label: 'Полета ↔ свободно платно',
      run: () => {
        const result = desktop.toggleLayout()
        if (!result.ok) toast(result.reason, { tone: 'warn' })
        else say(result.layout === 'fields' ? 'Полета: 4 × 4, всичко на екрана' : 'Свободно платно: местене и мащаб')
      }
    },

    /* -------------------------------------------------------- windows */
    {
      group: 'Прозорци',
      keys: ['Ctrl+KeyT', 'Ctrl+Shift+KeyT'],
      label: 'Нов терминал (в свободно поле)',
      run: () => desktop.openTerminal()
    },
    {
      group: 'Прозорци',
      keys: ['Ctrl+Alt+KeyT'],
      label: 'Нов терминал в същото поле',
      run: () => desktop.openTerminal({ sameField: true })
    },
    {
      group: 'Прозорци',
      keys: ['Ctrl+KeyN'],
      label: 'Нова бележка',
      run: () => desktop.openNote()
    },
    {
      group: 'Прозорци',
      keys: ['Ctrl+KeyW', 'Ctrl+Shift+KeyW'],
      label: 'Затвори избрания прозорец',
      run: () => {
        if (!desktop.closeFocused()) toast('Нищо не е избрано — щракни върху прозорец', { timeout: 2200 })
      }
    },
    {
      group: 'Прозорци',
      keys: ['Ctrl+Shift+KeyE'],
      label: 'Цял екран за прозореца (и обратно)',
      run: () => {
        const grown = desktop.expand()
        if (!grown) say('Нищо не е избрано — щракни върху прозорец')
        else if (!grown.expanded) say(`„${grown.title}“ се върна на мястото си`)
        else say(desktop.isTiled() ? `„${grown.title}“ е на целия екран` : grown.covered ? `Побра ${grown.covered} съседни` : 'Разгънат — няма близки прозорци')
      }
    },
    {
      group: 'Прозорци',
      keys: ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowUp', 'Alt+ArrowDown'],
      label: 'Към съседния прозорец',
      run: (combo) => desktop.focusDirection(direction(combo))
    },
    {
      group: 'Прозорци',
      keys: ['Alt+Shift+ArrowLeft', 'Alt+Shift+ArrowRight', 'Alt+Shift+ArrowUp', 'Alt+Shift+ArrowDown'],
      label: 'Размени прозореца със съседа / в свободно поле',
      run: (combo) => {
        if (!desktop.moveDirection(direction(combo))) say('Натам няма място')
      }
    },
    {
      group: 'Прозорци',
      keys: ['Alt+Digit1', 'Alt+Digit2', 'Alt+Digit3', 'Alt+Digit4'],
      label: 'Към поле 1…4',
      run: (combo) => {
        const field = Number(combo.slice(-1)) - 1
        if (!desktop.focusField(field)) say(`Поле ${field + 1} е празно`)
      }
    },
    {
      group: 'Прозорци',
      keys: ['Ctrl+Shift+KeyG'],
      label: 'Подреди',
      run: () => {
        const count = desktop.tidy()
        say(count ? `Подредени ${count} прозореца` : 'Станцията е празна')
      }
    },

    /* ------------------------------------------------------ the rest */
    {
      group: 'Лента, глас, ИИ',
      keys: ['Ctrl+KeyK', 'Ctrl+Shift+KeyK'],
      label: 'Командната лента (и „Попитай ИИ“)',
      run: () => bar.focus()
    },
    {
      group: 'Лента, глас, ИИ',
      keys: ['Ctrl+Shift+Space'],
      label: 'Говори — команда или диктовка в терминала',
      run: () => bar.toggleVoice()
    },
    {
      group: 'Лента, глас, ИИ',
      keys: ['Ctrl+Space'],
      label: 'Водещ клавиш — после една буква (виж долу)',
      run: () => leader.start()
    },
    {
      group: 'Лента, глас, ИИ',
      keys: ['F1', 'Ctrl+Slash'],
      label: 'Тази шпаргалка',
      run: () => cheatsheet.toggle()
    },
    {
      group: 'Прозорци на Windows',
      keys: ['Ctrl+Alt+KeyN'],
      label: 'Нов прозорец на Windows (отделни станции)',
      run: async () => {
        const opened = await window.w20.station.open()
        say(`Прозорец ${opened.id} е отворен`)
      }
    },
    {
      group: 'Прозорци на Windows',
      keys: ['Ctrl+Backquote', 'Ctrl+Shift+Backquote'],
      label: 'Обърни към следващия / предишния прозорец',
      run: async (combo) => {
        const to = await window.w20.station.cycle(combo.includes('Shift') ? -1 : 1)
        if (!to) say('Има само един прозорец — Ctrl+Alt+N отваря втори')
      }
    },
    {
      group: 'Свободно платно',
      keys: ['Ctrl+KeyM', 'Ctrl+Shift+KeyM'],
      label: 'Картата на платното',
      run: () => {
        if (desktop.isTiled()) say('В полетата всичко е на екрана — картата е за свободното платно')
        else if (minimap) say(minimap.toggle() ? 'Картата е включена' : 'Картата е скрита')
      }
    },
    {
      group: 'Свободно платно',
      keys: ['Ctrl+Shift+Digit0'],
      label: 'Побери всичко в екрана',
      run: () => {
        const fit = desktop.fitAll()
        if (!fit) say('Станцията е празна')
        else if (!fit.fits) say('По-широко е от най-далечния мащаб — виж картата (Ctrl+M)')
      }
    },
    {
      group: 'Свободно платно',
      keys: ['Ctrl+Equal', 'Ctrl+Minus'],
      label: 'Мащаб (Ctrl + колелце също)',
      run: (combo) => (combo.endsWith('Equal') ? canvas.zoomIn() : canvas.zoomOut())
    }
  ]

  function direction(combo) {
    return combo.endsWith('Left') ? 'left' : combo.endsWith('Right') ? 'right' : combo.endsWith('Up') ? 'up' : 'down'
  }

  const table = new Map()
  for (const b of bindings) {
    if (!b.run) continue
    for (const k of b.keys) table.set(k, b)
  }

  /** Station by number, and the Tab walk — ranges rather than rows. */
  function special(combo) {
    const digit = /^Ctrl\+Digit(\d)$/.exec(combo)
    if (digit) {
      const n = Number(digit[1])
      // Ctrl+0 is the tenth station in fields; on a free canvas it resets the zoom.
      if (n === 0) {
        if (desktop.isTiled()) desktop.switchTo(9)
        else canvas.resetZoom()
      } else desktop.switchTo(n - 1)
      return true
    }
    if (combo === 'Ctrl+Tab' || combo === 'Ctrl+PageDown') {
      desktop.step(1)
      return true
    }
    if (combo === 'Ctrl+Shift+Tab' || combo === 'Ctrl+PageUp') {
      desktop.step(-1)
      return true
    }
    return false
  }

  /* --------------------------------------------------------- the leader */

  const LEADER = [
    ['KeyT', 'терминал', () => desktop.openTerminal()],
    ['KeyB', 'браузър', () => desktop.openWeb()],
    ['KeyF', 'файлове', () => desktop.openFiles()],
    ['KeyN', 'бележка', () => desktop.openNote()],
    ['KeyA', 'питай ИИ', () => bar.focus('')],
    ['KeyV', 'говори', () => bar.toggleVoice()],
    ['KeyC', 'Claude Code', () => openProgram('claude')],
    ['KeyG', 'Gemini', () => openProgram('gemini')],
    ['KeyX', 'Codex', () => openProgram('codex')],
    ['KeyH', '← фокус', () => desktop.focusDirection('left')],
    ['KeyJ', '↓ фокус', () => desktop.focusDirection('down')],
    ['KeyK', '↑ фокус', () => desktop.focusDirection('up')],
    ['KeyL', '→ фокус', () => desktop.focusDirection('right')],
    ['Shift+KeyH', '← размени', () => desktop.moveDirection('left')],
    ['Shift+KeyJ', '↓ размени', () => desktop.moveDirection('down')],
    ['Shift+KeyK', '↑ размени', () => desktop.moveDirection('up')],
    ['Shift+KeyL', '→ размени', () => desktop.moveDirection('right')],
    ['KeyZ', 'цял екран', () => desktop.expand()],
    ['KeyW', 'затвори', () => desktop.closeFocused()],
    ['KeyS', 'настройки', () => desktop.openSettings()],
    ['Space', 'всички станции', () => overview.toggle()],
    ['Digit1…9', 'станция по номер', null],
    ['Shift+Slash', 'шпаргалка', () => cheatsheet.toggle()]
  ]

  function openProgram(id) {
    const program = ctx.programs.find((p) => p.id === id)
    if (!program) return
    if (!program.installed) toast(`${program.title} не е намерен на този компютър.`, { tone: 'warn' })
    else desktop.openProgram(program)
  }

  const hud = document.createElement('div')
  hud.className = 'w20-leader'
  hud.hidden = true
  hud.innerHTML = `<b>Ctrl+Space</b><span>${LEADER.filter(([, , run]) => run)
    .slice(0, 9)
    .map(([k, what]) => `<kbd>${display(k).replace('Shift+', '⇧')}</kbd> ${what}`)
    .join(' · ')} · <kbd>?</kbd> още</span>`
  ctx.root.appendChild(hud)

  const leader = (() => {
    let pending = false
    let timer = 0
    function stop() {
      pending = false
      clearTimeout(timer)
      hud.hidden = true
    }
    return {
      start() {
        pending = true
        hud.hidden = false
        clearTimeout(timer)
        timer = setTimeout(stop, 2500)
      },
      stop,
      get pending() {
        return pending
      },
      /** The second key. Modifier presses on their own do not count. */
      take(e) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return true
        stop()
        const code = (e.shiftKey ? 'Shift+' : '') + (e.code || comboOf(e).split('+').pop())
        const digit = /^Digit(\d)$/.exec(e.code || '')
        if (digit) {
          const n = Number(digit[1])
          desktop.switchTo(n === 0 ? 9 : n - 1)
          return true
        }
        const entry = LEADER.find(([k, , run]) => run && k === code)
        if (entry) entry[2]()
        else if (e.key !== 'Escape' && e.code !== 'Escape') say(`Ctrl+Space ${display(code)} — няма такова. ? показва всички.`)
        return true
      }
    }
  })()

  /* ------------------------------------------------------ cheat sheet */

  const sheet = document.createElement('div')
  sheet.className = 'w20-sheet'
  sheet.hidden = true
  ctx.root.appendChild(sheet)

  function renderSheet() {
    const groups = new Map()
    for (const b of bindings) {
      if (!groups.has(b.group)) groups.set(b.group, [])
      groups.get(b.group).push(b)
    }
    const keyHtml = (k) => `<kbd>${display(k).replace('Digit1…9', '1…9')}</kbd>`
    let html = `<div class="w20-sheet-card"><header><h2>Клавиши</h2><span><kbd>Esc</kbd> затваря</span></header><div class="w20-sheet-cols">`
    for (const [group, list] of groups) {
      html += `<section><h3>${group}</h3>`
      for (const b of list) {
        const keys = b.keys.length === 4 && b.keys[0].startsWith('Alt') ? [b.keys[0].replace(/Arrow\w+$|Digit\d$/, (m) => (m.startsWith('Arrow') ? '←↑→↓' : '1…4'))] : b.keys
        html += `<div class="w20-sheet-row"><span>${b.label}</span><span>${keys.map(keyHtml).join(' ')}</span></div>`
      }
      html += '</section>'
    }
    html += `<section><h3>Ctrl+Space, после…</h3>`
    for (const [k, what] of LEADER) {
      html += `<div class="w20-sheet-row"><span>${what}</span><span><kbd>${display(k).replace('Shift+Slash', '?').replace('Shift+', '⇧')}</kbd></span></div>`
    }
    html += `</section></div><p class="w20-sheet-note">В терминал Ctrl+буква е на програмата в него (Ctrl+C спира, Ctrl+W трие дума). Станцията слуша там на Ctrl+Shift+… · Ctrl+Shift+C / Ctrl+Shift+V копира и поставя.</p></div>`
    sheet.innerHTML = html
  }

  const cheatsheet = {
    toggle() {
      if (sheet.hidden) {
        renderSheet()
        sheet.hidden = false
      } else sheet.hidden = true
    },
    hide() {
      sheet.hidden = true
    },
    get open() {
      return !sheet.hidden
    }
  }
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) cheatsheet.hide()
  })

  /* ---------------------------------------------------------- handling */

  function inTerminal(e) {
    const t = e.target
    return Boolean(t && t.closest && t.closest('.w20-term'))
  }

  function handle(e) {
    if (leader.pending) {
      e.preventDefault()
      e.stopPropagation()
      return leader.take(e)
    }
    if (cheatsheet.open && (e.key === 'Escape' || e.code === 'Escape')) {
      cheatsheet.hide()
      e.preventDefault()
      return true
    }
    const combo = comboOf(e)
    // The shell's keys stay the shell's.
    if (inTerminal(e) && shellOwns(combo)) return false
    if (special(combo)) {
      e.preventDefault()
      return true
    }
    const binding = table.get(combo)
    if (!binding) return false
    e.preventDefault()
    binding.run(combo)
    return true
  }

  active = {
    has: (combo) => table.has(combo) || /^Ctrl\+(Shift\+)?(Digit\d|Tab|PageUp|PageDown)$/.test(combo),
    leaderPending: () => leader.pending
  }

  return { handle, bindings, leader, cheatsheet, display }
}
