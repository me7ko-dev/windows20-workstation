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

import { toggleTheme } from './theme.js'

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

const NAMED = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  delete: 'Delete',
  backspace: 'Backspace',
  plus: 'Equal',
  '`': 'Backquote',
  '/': 'Slash',
  '=': 'Equal',
  '+': 'Equal',
  '-': 'Minus',
  '\\': 'Backslash',
  ',': 'Comma',
  '.': 'Period',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight'
}

/**
 * A combo as a person writes it ("Ctrl+Shift+T", "alt+left", "F4") to the
 * form the table uses ("Ctrl+Shift+KeyT"). Null when it is not a key.
 */
export function normalize(text) {
  if (typeof text !== 'string') return null
  // "Ctrl++" means Ctrl and the plus key.
  const parts = text.trim().replace(/\+\+$/, '+Plus').split('+').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return null
  const mods = new Set()
  let key = null
  for (const part of parts) {
    const low = part.toLowerCase()
    if (['ctrl', 'control', 'cmd', 'commandorcontrol', 'cmdorctrl'].includes(low)) mods.add('Ctrl')
    else if (['alt', 'option'].includes(low)) mods.add('Alt')
    else if (low === 'shift') mods.add('Shift')
    else if (key) return null
    else key = part
  }
  if (!key) return null
  let code = null
  if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`
  else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) code = key.toUpperCase()
  else if (/^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Numpad\w+)$/.test(key)) code = key
  else if (NAMED[key.toLowerCase()]) code = NAMED[key.toLowerCase()]
  else if (/^(Space|Tab|Enter|Escape|PageUp|PageDown|Backquote|Slash|Equal|Minus)$/.test(key)) code = key
  if (!code) return null
  return ['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)).concat(code).join('+')
}

/** The table's form back to what a person writes — for keybindings.json. */
export function human(combo) {
  const back = { Backquote: '`', Slash: '/', Equal: '=', Minus: '-' }
  return combo
    .split('+')
    .map((part) => {
      if (/^Key[A-Z]$/.test(part)) return part.slice(3)
      if (/^Digit\d$/.test(part)) return part.slice(5)
      if (/^Arrow/.test(part)) return part.slice(5)
      return back[part] || part
    })
    .join('+')
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
      id: 'station.overview',
      keys: ['F3', 'Ctrl+Shift+KeyA'],
      label: 'Всички станции — назад и избор',
      run: () => overview.toggle()
    },
    {
      group: 'Станции',
      id: 'station.new',
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
      id: 'station.picture',
      keys: ['Ctrl+Shift+KeyB'],
      label: 'Друга картина за тази станция',
      run: () => {
        const paper = desktop.randomWallpaper()
        say(`Картина: ${paper.label}`)
      }
    },
    {
      group: 'Станции',
      id: 'station.layout',
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
      id: 'window.terminal',
      keys: ['Ctrl+KeyT', 'Ctrl+Shift+KeyT'],
      label: 'Нов терминал (в свободно поле)',
      run: () => desktop.openTerminal()
    },
    {
      group: 'Прозорци',
      id: 'window.terminalHere',
      keys: ['Ctrl+Alt+KeyT'],
      label: 'Нов терминал в същото поле',
      run: () => desktop.openTerminal({ sameField: true })
    },
    {
      group: 'Прозорци',
      id: 'window.note',
      keys: ['Ctrl+KeyN'],
      label: 'Нова бележка',
      run: () => desktop.openNote()
    },
    {
      group: 'Прозорци',
      id: 'window.close',
      keys: ['Ctrl+KeyW', 'Ctrl+Shift+KeyW'],
      label: 'Затвори избрания прозорец',
      run: () => {
        if (!desktop.closeFocused()) toast('Нищо не е избрано — щракни върху прозорец', { timeout: 2200 })
      }
    },
    {
      group: 'Прозорци',
      id: 'window.expand',
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
      id: 'window.focusDirection',
      order: 'ляво, дясно, горе, долу',
      keys: ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+ArrowUp', 'Alt+ArrowDown'],
      label: 'Към съседния прозорец',
      run: (_combo, i) => desktop.focusDirection(DIRECTIONS[i % 4])
    },
    {
      group: 'Прозорци',
      id: 'window.moveDirection',
      order: 'ляво, дясно, горе, долу',
      keys: ['Alt+Shift+ArrowLeft', 'Alt+Shift+ArrowRight', 'Alt+Shift+ArrowUp', 'Alt+Shift+ArrowDown'],
      label: 'Размени прозореца със съседа / в свободно поле',
      run: (_combo, i) => {
        if (!desktop.moveDirection(DIRECTIONS[i % 4])) say('Натам няма място')
      }
    },
    {
      group: 'Прозорци',
      id: 'window.field',
      order: 'поле 1, 2, 3, 4',
      keys: ['Alt+Digit1', 'Alt+Digit2', 'Alt+Digit3', 'Alt+Digit4'],
      label: 'Към поле 1…4',
      run: (_combo, i) => {
        const field = i % 4
        if (!desktop.focusField(field)) say(`Поле ${field + 1} е празно`)
      }
    },
    {
      group: 'Прозорци',
      id: 'window.tidy',
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
      id: 'bar.focus',
      keys: ['Ctrl+KeyK', 'Ctrl+Shift+KeyK'],
      label: 'Командната лента (и „Попитай ИИ“)',
      run: () => bar.focus()
    },
    {
      group: 'Лента, глас, ИИ',
      id: 'bar.voice',
      keys: ['Ctrl+Shift+Space'],
      label: 'Говори — команда или диктовка в терминала',
      run: () => bar.toggleVoice()
    },
    {
      group: 'Лента, глас, ИИ',
      id: 'leader',
      keys: ['Ctrl+Space'],
      label: 'Водещ клавиш — после една буква (виж долу)',
      run: () => leader.start()
    },
    {
      group: 'Лента, глас, ИИ',
      id: 'help',
      keys: ['F1', 'Ctrl+Slash'],
      label: 'Тази шпаргалка',
      run: () => cheatsheet.toggle()
    },
    {
      group: 'Лента, глас, ИИ',
      id: 'ai.chat',
      keys: ['Ctrl+Shift+KeyI'],
      label: 'Genesis — ИИ чат',
      run: () => desktop.openChat()
    },
    {
      group: 'Изглед',
      id: 'look.theme',
      keys: ['Ctrl+Alt+KeyL'],
      label: 'Светла ↔ тъмна тема',
      run: () => say(toggleTheme() === 'light' ? 'Светла тема' : 'Тъмна тема')
    },
    {
      group: 'Изглед',
      id: 'keys.edit',
      keys: [],
      label: 'Промени клавишите (keybindings.json)',
      run: () => editKeys()
    },
    {
      group: 'Прозорци на Windows',
      id: 'os.newWindow',
      keys: ['Ctrl+Alt+KeyN'],
      label: 'Нов прозорец на Windows (отделни станции)',
      run: async () => {
        const opened = await window.w20.station.open()
        say(`Прозорец ${opened.id} е отворен`)
      }
    },
    {
      group: 'Прозорци на Windows',
      id: 'os.cycle',
      order: 'напред, назад',
      keys: ['Ctrl+Backquote', 'Ctrl+Shift+Backquote'],
      label: 'Обърни към следващия / предишния прозорец',
      run: async (_combo, i) => {
        const to = await window.w20.station.cycle(i === 1 ? -1 : 1)
        if (!to) say('Има само един прозорец — Ctrl+Alt+N отваря втори')
      }
    },
    {
      group: 'Свободно платно',
      id: 'canvas.minimap',
      keys: ['Ctrl+KeyM', 'Ctrl+Shift+KeyM'],
      label: 'Картата на платното',
      run: () => {
        if (desktop.isTiled()) say('В полетата всичко е на екрана — картата е за свободното платно')
        else if (minimap) say(minimap.toggle() ? 'Картата е включена' : 'Картата е скрита')
      }
    },
    {
      group: 'Свободно платно',
      id: 'canvas.fit',
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
      id: 'canvas.zoom',
      order: 'по-близо, по-далеч',
      keys: ['Ctrl+Equal', 'Ctrl+Minus'],
      label: 'Мащаб (Ctrl + колелце също)',
      run: (_combo, i) => (i === 0 ? canvas.zoomIn() : canvas.zoomOut())
    }
  ]

  // Keys that come in fours say which one by their place in the list, so a
  // user's own Alt+H/J/K/L still means left, down, up, right.
  const DIRECTIONS = ['left', 'right', 'up', 'down']

  for (const b of bindings) b.defaults = b.keys.slice()

  const table = new Map() // combo -> { binding, index }

  /**
   * The defaults, with the user's keybindings.json on top. A combo claimed by
   * two shortcuts goes to the one the user named; the other loses it and the
   * user is told.
   */
  function build(overrides = {}) {
    const problems = []
    table.clear()
    for (const b of bindings) {
      if (!b.run || !b.id) {
        b.keys = b.defaults.slice()
        continue
      }
      const own = Object.prototype.hasOwnProperty.call(overrides, b.id)
      const wanted = own ? overrides[b.id] : b.defaults
      b.keys = []
      for (const raw of wanted) {
        const combo = own ? normalize(raw) : raw
        if (!combo) {
          problems.push(`„${raw}“ (${b.id}) не е клавиш, който познавам`)
          continue
        }
        if (!b.keys.includes(combo)) b.keys.push(combo)
      }
      // A file written with every default is not every key changed.
      b.custom = own && b.keys.join(' ') !== b.defaults.join(' ')
    }
    for (const id of Object.keys(overrides)) {
      if (!bindings.some((b) => b.id === id)) problems.push(`няма такова действие: „${id}“`)
    }
    // Defaults first, then the user's own, so the user's win a clash.
    const order = bindings.filter((b) => b.run && !b.custom).concat(bindings.filter((b) => b.run && b.custom))
    for (const b of order) {
      b.keys.forEach((combo, index) => {
        const before = table.get(combo)
        if (before && before.binding !== b) {
          if (b.custom && before.binding.custom) problems.push(`${human(combo)} е дадено два пъти — остава за „${b.label}“`)
          before.binding.keys = before.binding.keys.filter((k) => k !== combo)
        }
        table.set(combo, { binding: b, index })
      })
    }
    return problems
  }
  build()

  /** Read keybindings.json again — at start, and whenever it is saved. */
  async function reload(given) {
    const loaded = given || (window.w20.keys ? await window.w20.keys.load() : null)
    if (!loaded) return []
    const problems = (loaded.problems || []).concat(build(loaded.keys || {}))
    globalKeys = loaded.global || globalKeys
    if (!sheet.hidden) renderSheet()
    if (problems.length) toast(`Клавиши: ${problems.slice(0, 3).join(' · ')}`, { tone: 'warn', timeout: 8000 })
    return problems
  }
  let globalKeys = {}
  if (window.w20.keys) {
    window.w20.keys.onChange((loaded) => {
      reload(loaded).then((problems) => {
        if (!problems.length) say('Клавишите са обновени от keybindings.json')
      })
    })
  }

  /** keybindings.json in the system editor — written with every default first. */
  async function editKeys() {
    if (!window.w20.keys) return
    const defaults = bindings
      .filter((b) => b.run && b.id)
      .map((b) => ({ id: b.id, label: `${b.group}: ${b.label}${b.order ? ` (по ред: ${b.order})` : ''}`, keys: b.defaults.map(human) }))
    const result = await window.w20.keys.open(defaults)
    if (result.ok) say('keybindings.json е отворен — запази го и клавишите се сменят веднага')
    else toast(`Не можах да отворя ${result.file || 'keybindings.json'}: ${result.error}`, { tone: 'warn' })
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
    ['KeyI', 'Genesis чат', () => desktop.openChat()],
    ['KeyD', 'светла / тъмна', () => say(toggleTheme() === 'light' ? 'Светла тема' : 'Тъмна тема')],
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
        const keys = !b.custom && b.keys.length === 4 && b.keys[0].startsWith('Alt') ? [b.keys[0].replace(/Arrow\w+$|Digit\d$/, (m) => (m.startsWith('Arrow') ? '←↑→↓' : '1…4'))] : b.keys
        const shown = keys.length ? keys.map(keyHtml).join(' ') : '<small>без клавиш</small>'
        html += `<div class="w20-sheet-row${b.custom ? ' is-custom' : ''}"><span>${b.label}</span><span>${shown}</span></div>`
      }
      html += '</section>'
    }
    html += `<section><h3>Ctrl+Space, после…</h3>`
    for (const [k, what] of LEADER) {
      html += `<div class="w20-sheet-row"><span>${what}</span><span><kbd>${display(k).replace('Shift+Slash', '?').replace('Shift+', '⇧')}</kbd></span></div>`
    }
    html += `</section>`
    const globals = Object.entries(globalKeys).filter(([, k]) => k)
    if (globals.length) {
      const what = { show: 'покажи / скрий станцията', voice: 'покажи и слушай' }
      html += `<section><h3>Отвсякъде в Windows</h3>`
      for (const [name, k] of globals) {
        html += `<div class="w20-sheet-row"><span>${what[name] || name}</span><span><kbd>${k.replace('Super', 'Win')}</kbd></span></div>`
      }
      html += `</section>`
    }
    html += `</div><p class="w20-sheet-note"><button class="w20-sheet-edit" data-role="edit-keys">Промени клавишите…</button> В терминал Ctrl+буква е на програмата в него (Ctrl+C спира, Ctrl+W трие дума). Станцията слуша там на Ctrl+Shift+… · Ctrl+Shift+C / Ctrl+Shift+V копира и поставя.</p></div>`
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
    if (e.target.closest && e.target.closest('[data-role="edit-keys"]')) {
      cheatsheet.hide()
      editKeys()
    }
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
    const hit = table.get(combo)
    if (!hit) return false
    e.preventDefault()
    hit.binding.run(combo, hit.index)
    return true
  }

  active = {
    has: (combo) => table.has(combo) || /^Ctrl\+(Shift\+)?(Digit\d|Tab|PageUp|PageDown)$/.test(combo),
    leaderPending: () => leader.pending
  }

  return { handle, bindings, leader, cheatsheet, display, reload, editKeys }
}
