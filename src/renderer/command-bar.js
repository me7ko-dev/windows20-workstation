/**
 * The bar at the bottom: one place to type and have the desktop do it.
 *
 * Commands are matched against a small verb table rather than free text,
 * because a wrong guess here spawns a process — the voice layer will sit on
 * top of this same table later, turning speech into one of these entries
 * instead of inventing its own actions.
 */

import { createVoice } from './voice.js'

export function createCommandBar({ root, desktop, programs, canvas, toast, minimap, speaker }) {
  const el = document.createElement('div')
  el.className = 'w20-bar'
  el.innerHTML = `
    <div class="w20-bar-results" data-role="results" hidden></div>
    <div class="w20-bar-main">
      <button class="w20-bar-mic" data-role="mic" title="Говори (Ctrl+Shift+Space)">◉</button>
      <input class="w20-bar-input" data-role="input" placeholder="Напиши команда…" spellcheck="false" />
      <span class="w20-bar-hint">Ctrl+K</span>
      <span class="w20-bar-load" data-role="load"></span>
      <button class="w20-bar-all" data-role="overview" title="Всички станции (F3)">▦</button>
      <div class="w20-bar-tabs" data-role="tabs"></div>
      <button class="w20-bar-add" data-role="add" title="Нова станция (Ctrl+Shift+N)">+</button>
    </div>
  `
  root.appendChild(el)

  const input = el.querySelector('[data-role="input"]')
  const resultsEl = el.querySelector('[data-role="results"]')
  const tabsEl = el.querySelector('[data-role="tabs"]')
  const micBtn = el.querySelector('[data-role="mic"]')
  const loadEl = el.querySelector('[data-role="load"]')
  const addBtn = el.querySelector('[data-role="add"]')

  addBtn.addEventListener('click', () => desktop.addWorkspace())
  let overviewHandler = null
  el.querySelector('[data-role="overview"]').addEventListener('click', () => overviewHandler && overviewHandler())

  const voice = createVoice({
    onState: (state) => {
      el.dataset.voice = state
      micBtn.title =
        state === 'listening' ? 'Слушам — натисни пак, за да спреш' : state === 'working' ? 'Разпознавам…' : 'Говори (Ctrl+Shift+Space)'
    },
    onTranscript: (result) => {
      if (!result.ok) {
        toast(result.error, { tone: 'error' })
        return
      }
      handleSpoken(result.text)
    }
  })

  micBtn.addEventListener('click', () => voice.toggle())

  /* ------------------------------------------------------- the verb table */

  const WHERE = {
    agent: 'терминал на платното',
    shell: 'терминал на платното',
    editor: 'редакторът, в прозорец тук',
    web: 'браузър на платното',
    files: 'файлов прозорец тук',
    external: 'собствен прозорец на Windows'
  }

  function programCommands() {
    const commands = programs.map((program) => ({
      id: `open:${program.id}`,
      label: program.installed ? `Отвори ${program.title}` : `${program.title} (не е инсталирана)`,
      hint: WHERE[program.kind] || '',
      keywords: [program.id, program.title, program.command, program.native],
      run: () => desktop.openProgram(program)
    }))

    // Where the station stands in for a Windows program, the real one is still
    // one command away — the canvas version is the default, not the only way.
    for (const program of programs) {
      if (!program.native || !program.nativeInstalled) continue
      commands.push({
        id: `native:${program.id}`,
        label: `Пусни ${program.native} в Windows`,
        hint: 'като собствен прозорец',
        keywords: [program.native, 'windows', 'външен', 'native', program.id],
        run: async () => {
          const result = await window.w20.launch(program.id, [])
          flash(result.ok ? `${program.native} е пуснат` : result.error)
        }
      })
    }

    return commands
  }

  function staticCommands() {
    const commands = [
      {
        id: 'new:terminal',
        label: 'Нов терминал',
        hint: 'ConPTY в прозорец',
        keywords: ['терминал', 'terminal', 'shell', 'нов'],
        run: () => desktop.openTerminal()
      },
      {
        id: 'new:same',
        label: 'Нов терминал в същото поле',
        hint: 'Ctrl+Alt+T',
        keywords: ['терминал', 'поле', 'същото', 'terminal'],
        run: () => desktop.openTerminal({ sameField: true })
      },
      {
        id: 'view:overview',
        label: 'Всички станции',
        hint: 'F3 — назад, после избор',
        keywords: ['всички', 'станции', 'назад', 'преглед', 'overview', 'обзор'],
        run: () => overviewHandler && overviewHandler()
      },
      {
        id: 'view:layout',
        label: desktop.isTiled() ? 'Свободно платно за тази станция' : 'Полета за тази станция (4 × 4)',
        hint: 'Ctrl+Shift+L',
        keywords: ['полета', 'платно', 'layout', 'режим', 'свободно', 'подредба'],
        run: () => {
          const result = desktop.toggleLayout()
          if (!result.ok) toast(result.reason, { tone: 'warn' })
        }
      },
      {
        id: 'new:web',
        label: 'Нов браузър',
        hint: 'страница в прозорец на платното',
        keywords: ['браузър', 'browser', 'интернет', 'уеб', 'web', 'страница', 'chrome'],
        run: () => desktop.openWeb()
      },
      {
        id: 'new:files',
        label: 'Нов файлов прозорец',
        hint: desktop.activeWorkspace().cwd,
        keywords: ['файлове', 'files', 'папка', 'explorer', 'директория'],
        run: () => desktop.openFiles()
      },
      {
        id: 'new:note',
        label: 'Нова бележка',
        hint: 'лепенка на платното',
        keywords: ['бележка', 'note', 'план'],
        run: () => desktop.openNote()
      },
      {
        id: 'sys:folder',
        label: 'Смени папката на станцията',
        hint: desktop.activeWorkspace().cwd,
        keywords: ['папка', 'folder', 'cwd', 'проект', 'project'],
        run: async () => {
          const dir = await window.w20.pickFolder()
          if (dir) {
            desktop.setCwd(dir)
            flash(`Папката вече е ${dir}`)
          }
        }
      },
      {
        id: 'sys:settings',
        label: 'Настройки',
        hint: 'глас, ИИ, безплатни ключове',
        keywords: ['настройки', 'settings', 'ключ', 'key', 'глас', 'voice', 'ии', 'ai'],
        run: () => desktop.openSettings()
      },
      {
        id: 'view:fit',
        label: 'Нулирай мащаба',
        hint: '100%',
        keywords: ['мащаб', 'zoom', 'reset', 'нулирай'],
        run: () => canvas.resetZoom()
      },
      {
        id: 'view:all',
        label: 'Побери всичко в екрана',
        hint: 'Ctrl+Shift+0',
        keywords: ['побери', 'всичко', 'fit', 'обхват', 'отдалечи', 'покажи', 'всички'],
        run: () => {
          const fit = desktop.fitAll()
          if (!fit) flash('Станцията е празна')
          else if (!fit.fits) flash('По-широко е от най-далечния мащаб — виж картата (Ctrl+M)')
        }
      },
      {
        id: 'view:expand',
        label: desktop.focusedNode()
          ? `Разгъни „${desktop.focusedNode().title}“ върху съседните`
          : 'Разгъни избрания прозорец',
        hint: 'Ctrl+Shift+E — или двоен клик по заглавието',
        keywords: ['разгъни', 'уголеми', 'голям', 'expand', 'максимизирай', 'свий', 'побери'],
        run: () => {
          const grown = desktop.expand()
          if (!grown) flash('Нищо не е избрано — щракни върху прозорец')
          else if (!grown.expanded) flash(`„${grown.title}“ се сви обратно`)
          else flash(grown.covered ? `Побра ${grown.covered} съседни` : 'Разгънат — няма близки прозорци')
        }
      },
      {
        id: 'view:tidy',
        label: 'Подреди прозорците',
        hint: 'Ctrl+Shift+G — в мрежа, без преоразмеряване',
        keywords: ['подреди', 'нареди', 'мрежа', 'tidy', 'разчисти', 'прозорците', 'подреждане'],
        run: () => {
          const count = desktop.tidy()
          flash(count ? `Подредени ${count} прозореца` : 'Станцията е празна')
        }
      },
      {
        id: 'view:map',
        label: minimap && minimap.isVisible() ? 'Скрий картата на платното' : 'Покажи картата на платното',
        hint: 'Ctrl+M',
        keywords: ['карта', 'map', 'минимап', 'minimap', 'преглед', 'обзор'],
        run: () => {
          if (minimap) flash(minimap.toggle() ? 'Картата е включена' : 'Картата е скрита')
        }
      },
      {
        id: 'station:new',
        label: 'Нов прозорец на Windows',
        hint: 'със свои станции — Ctrl+Alt+N',
        keywords: ['прозорец', 'window', 'нов', 'windows'],
        run: async () => {
          const opened = await window.w20.station.open()
          flash(`Прозорец ${opened.id} е отворен`)
        }
      },
      {
        id: 'station:next',
        label: 'Следващ прозорец на Windows',
        hint: 'Ctrl+` — обръща прозореца',
        keywords: ['следващ', 'прозорец', 'next', 'обърни', 'превърти'],
        run: async () => {
          const to = await window.w20.station.cycle(1)
          if (!to) flash('Има само един прозорец — Ctrl+Alt+N отваря втори')
        }
      },
      {
        id: 'station:tile',
        label: 'Подреди прозорците на Windows един до друг',
        hint: 'по целия екран',
        keywords: ['подреди', 'един до друг', 'tile', 'прозорци', 'нареди'],
        run: async () => {
          const result = await window.w20.station.tile()
          if (result) flash(`${result.count} прозореца са подредени`)
        }
      },
      {
        id: 'ws:new',
        label: 'Нова станция',
        hint: 'Ctrl+Shift+N — със своя картина',
        keywords: ['нова', 'станция', 'пространство', 'workspace', 'new', 'десктоп'],
        run: () => desktop.addWorkspace()
      },
      {
        id: 'ws:close',
        label: `Затвори станция ${desktop.activeWorkspace().name}`,
        hint: 'заедно с прозорците в нея',
        keywords: ['затвори', 'махни', 'close', 'станция', 'пространство', 'workspace'],
        // Takes live terminals with it — the ИИ may offer it, never run it.
        confirm: true,
        run: () => {
          const name = desktop.activeWorkspace().name
          if (desktop.closeWorkspace()) flash(`Станция ${name} е затворена`)
          else flash('Трябва да остане поне една станция')
        }
      }
    ]

    desktop.workspaces.forEach((ws, index) => {
      commands.push({
        id: `go:${index}`,
        label: `Иди на станция ${ws.name}`,
        hint: `${ws.nodes.length} прозореца`,
        keywords: [ws.name, `${index + 1}`, 'станция', 'пространство', 'workspace'],
        run: () => desktop.switchTo(index)
      })
    })

    // Moving a window between workspaces only makes sense when there is one
    // selected — an offer to move "nothing" is noise in the list.
    const selected = desktop.focusedNode()
    if (selected) {
      desktop.workspaces.forEach((ws, index) => {
        if (index === desktop.activeIndex) return
        commands.push({
          id: `move:${index}`,
          label: `Премести „${selected.title}“ в станция ${ws.name}`,
          hint: selected.type === 'terminal' ? 'терминалът продължава да работи' : `${ws.nodes.length} прозореца`,
          keywords: ['премести', 'move', 'прехвърли', 'станция', ws.name, selected.title],
          run: () => {
            if (desktop.moveNodeTo(selected.id, index)) flash(`„${selected.title}“ е в станция ${ws.name}`)
            else flash(`Станция ${ws.name} е пълна`)
          }
        })
      })
    }

    commands.push({
      id: 'paper:random',
      label: 'Картина: на случаен принцип',
      hint: 'Ctrl+Shift+B — нарисувана в 4K',
      keywords: ['случаен', 'random', 'фон', 'картина', 'тапет', 'цвят', 'тема', 'изненадай'],
      run: () => {
        const paper = desktop.randomWallpaper()
        flash(`Картина: ${paper.label}`)
      }
    })

    for (const paper of desktop.WALLPAPERS) {
      commands.push({
        id: `paper:${paper.id}`,
        label: `Картина: ${paper.label}`,
        hint: 'нова всеки път, в 4K',
        keywords: ['картина', 'тапет', 'wallpaper', 'фон', 'цвят', 'тема', 'theme', paper.id, paper.label],
        run: () => desktop.setWallpaper(paper.id)
      })
    }

    return commands
  }

  function allCommands() {
    return [...programCommands(), ...staticCommands()]
  }

  /**
   * Windows loves a path; if that's what was typed, offer to open it. A web
   * address opens here first — the whole point is that it need not leave.
   */
  function pathCommands(query) {
    if (/^https?:\/\//.test(query)) {
      return [
        {
          id: 'web:open',
          label: `Отвори ${query} тук`,
          hint: 'прозорец на платното',
          run: () => desktop.openWeb(query)
        },
        {
          id: 'sys:open',
          label: `Отвори ${query} в Windows`,
          hint: 'браузъра по подразбиране',
          run: async () => {
            const result = await window.w20.openPath(query)
            if (!result.ok) flash(result.error)
          }
        }
      ]
    }
    const looksLikePath = /^[a-zA-Z]:\\/.test(query) || query.startsWith('\\\\')
    if (!looksLikePath) return []
    return [
      {
        id: 'files:open',
        label: `Отвори ${query} тук`,
        hint: 'файлов прозорец на платното',
        run: () => desktop.openFiles(query)
      },
      {
        id: 'sys:open',
        label: `Отвори ${query} в Windows`,
        hint: 'с програмата по подразбиране',
        run: async () => {
          const result = await window.w20.openPath(query)
          if (!result.ok) flash(result.error)
        }
      }
    ]
  }

  function score(command, query) {
    const haystack = `${command.label} ${(command.keywords || []).join(' ')}`.toLowerCase()
    const q = query.toLowerCase()
    if (!q) return 1
    if (haystack.startsWith(q)) return 3
    if (haystack.includes(q)) return 2
    // Every character present in order — catches "vsc" for "VS Code".
    let i = 0
    for (const ch of haystack) {
      if (ch === q[i]) i += 1
      if (i === q.length) return 1
    }
    return 0
  }

  /* ------------------------------------------------------------ rendering */

  let matches = []
  let cursor = 0

  function refresh() {
    const query = input.value.trim()
    const direct = pathCommands(query)

    const found = allCommands()
      .map((command) => ({ command, rank: score(command, query) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 8)
      .map((entry) => entry.command)

    const nodeHits = query
      ? desktop.findNodes(query).slice(0, 4).map((hit) => ({
          id: `node:${hit.node.id}`,
          label: `Иди на „${hit.node.title}“`,
          hint: `станция ${hit.workspaceName}`,
          run: () => desktop.revealNode(hit.node.id, hit.workspaceIndex)
        }))
      : []

    // The last row always hands the words to the ИИ: what the table does not
    // know may still be something the station can do.
    const ask =
      query.length >= 2
        ? [{ id: 'ai:ask', label: 'Попитай ИИ', hint: `„${query}“`, run: () => askAI(query, { spoken: false }) }]
        : []

    matches = [...direct, ...nodeHits, ...found, ...ask]
    cursor = 0
    draw()
  }

  function draw() {
    if (!matches.length) {
      resultsEl.hidden = true
      resultsEl.innerHTML = ''
      return
    }
    resultsEl.hidden = false
    resultsEl.innerHTML = ''
    matches.forEach((command, index) => {
      const row = document.createElement('button')
      row.className = 'w20-bar-row' + (index === cursor ? ' is-active' : '')
      row.innerHTML = `<span class="w20-bar-row-label"></span><span class="w20-bar-row-hint"></span>`
      row.querySelector('.w20-bar-row-label').textContent = command.label
      row.querySelector('.w20-bar-row-hint').textContent = command.hint || ''
      row.addEventListener('click', () => execute(index))
      resultsEl.appendChild(row)
    })
  }

  function execute(index) {
    const command = matches[index]
    if (!command) return
    input.value = ''
    resultsEl.hidden = true
    matches = []
    command.run()
  }

  let flashTimer = null
  function flash(message) {
    input.value = ''
    input.placeholder = message
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      input.placeholder = 'Напиши команда…'
    }, 4000)
  }

  input.addEventListener('input', refresh)
  input.addEventListener('focus', refresh)
  input.addEventListener('blur', () => setTimeout(() => { resultsEl.hidden = true }, 120))

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor = Math.min(cursor + 1, matches.length - 1)
      draw()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = Math.max(cursor - 1, 0)
      draw()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(cursor)
    } else if (e.key === 'Escape') {
      input.value = ''
      resultsEl.hidden = true
      input.blur()
    }
  })

  /* -------------------------------------------------------------- speech */

  /**
   * Where a sentence goes depends on what the user was last touching. Typed
   * into a focused agent it is a prompt; said to the desktop it is an action.
   * Guessing wrong either way is worse than the rule being explicit.
   */
  function handleSpoken(text) {
    const target = desktop.focusedTerminal()
    if (target && target.content && target.content.send) {
      target.content.send(text)
      toast(`Продиктувано в „${target.win.node.title}“: ${text}`, { timeout: 5000 })
      return
    }

    // The table first: it is instant, free and works without internet.
    const best = allCommands()
      .map((command) => ({ command, rank: score(command, text) }))
      .filter((entry) => entry.rank >= 2 && !entry.command.confirm)
      .sort((a, b) => b.rank - a.rank)[0]

    if (best) {
      toast(`${best.command.label}`, { timeout: 4000 })
      best.command.run()
      if (speaker) speaker.say(best.command.label)
      return
    }

    askAI(text, { spoken: true })
  }

  /**
   * Everything the ИИ may choose from right now: the bar's own commands, every
   * window by name, and a web search — the one entry that takes words.
   */
  function aiCommands() {
    const commands = allCommands()
    for (const hit of desktop.findNodes('')) {
      commands.push({
        id: `node:${hit.node.id}`,
        label: `Иди на прозореца „${hit.node.title}“ (станция ${hit.workspaceName})`,
        run: () => desktop.revealNode(hit.node.id, hit.workspaceIndex)
      })
    }
    commands.push({
      id: 'web:search',
      label: 'Търси в интернет',
      takesArg: true,
      run: (arg) => desktop.openWeb(`https://duckduckgo.com/?q=${encodeURIComponent(arg || '')}`)
    })
    return commands
  }

  function describeScreen() {
    const ws = desktop.activeWorkspace()
    const selected = desktop.focusedNode()
    const titles = ws.nodes.slice(0, 20).map((n) => n.title).join(', ')
    return (
      `станция ${ws.name}, ${ws.nodes.length} прозореца` +
      (titles ? ` (${titles})` : '') +
      (selected ? `; избран е „${selected.title}“` : '')
    )
  }

  let asking = false

  /**
   * A sentence the table did not know goes to the ИИ, which may only answer
   * with one of the ids it was given — checked again here before anything
   * runs. Heard sentences get their reply read aloud.
   */
  async function askAI(text, { spoken }) {
    if (asking) return
    const state = await window.w20.settings.get()
    if (!state || !state.ai.ready) {
      input.value = text
      toast('ИИ не е настроен. В Настройки въведи безплатен ключ (Groq или Gemini) или избери Ollama.', {
        tone: 'warn'
      })
      if (spoken && speaker) speaker.say('Не разбрах командата, а ИИ още не е настроен.')
      desktop.openSettings()
      return
    }

    const commands = aiCommands()
    const byId = new Map(commands.map((c) => [c.id, c]))

    asking = true
    el.dataset.voice = 'thinking'
    flash('Мисля…')
    let result
    try {
      result = await window.w20.ai.navigate({
        text,
        commands: commands.map(({ id, label, takesArg }) => ({ id, label, takesArg: Boolean(takesArg) })),
        context: describeScreen()
      })
    } finally {
      asking = false
      el.dataset.voice = voice.state
    }

    if (!result || !result.ok) {
      input.value = text
      toast((result && result.error) || 'ИИ не отговори.', { tone: 'error' })
      if (spoken && speaker) speaker.say('ИИ не отговори.')
      return
    }

    const command = result.command ? byId.get(result.command) : null
    let reply = result.say

    if (command && command.confirm) {
      // Something that cannot be undone waits for the user's own Enter.
      input.value = command.label
      input.focus()
      refresh()
      reply = reply || `${command.label}? Потвърди с Enter.`
    } else if (command) {
      command.run(result.arg)
      reply = reply || command.label
    } else if (result.command) {
      // An id that is not on the list — say so rather than guess at one.
      reply = reply || 'Не мога да направя това.'
    }

    if (reply) {
      const via = result.fellBack ? ` (отговори ${result.provider} — първият избор беше зает)` : ''
      toast(reply + via, { timeout: Math.min(15000, 4000 + reply.length * 60) })
      if (spoken && speaker) speaker.say(reply)
    }
  }

  /* --------------------------------------------------------------- tabs */

  function drawTabs() {
    tabsEl.innerHTML = ''
    let activeTab = null
    desktop.workspaces.forEach((ws, index) => {
      const tab = document.createElement('button')
      const isActive = index === desktop.activeIndex
      tab.className = 'w20-tab' + (isActive ? ' is-active' : '')
      tab.textContent = ws.name
      tab.title =
        `${ws.nodes.length} прозореца` + (index < 9 ? ` — Ctrl+${index + 1}` : ' — Ctrl+Tab')
      if (ws.nodes.length) tab.dataset.count = String(ws.nodes.length)
      tab.addEventListener('click', () => desktop.switchTo(index))
      tabsEl.appendChild(tab)
      if (isActive) activeTab = tab
    })
    // The strip scrolls once there are more workspaces than fit.
    if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /**
   * What the desktop costs right now. `mounted/windows` is the point: windows
   * that exist but are not built in the DOM cost nothing but their model.
   */
  function drawLoad() {
    const s = desktop.stats()
    const mem = performance.memory
    const mb = mem ? Math.round(mem.usedJSHeapSize / 1048576) : null
    loadEl.textContent = mb === null ? `${s.mounted}/${s.windows}` : `${s.mounted}/${s.windows} · ${mb} MB`
    loadEl.title =
      `${s.workspaces} пространства · ${s.windows} прозореца\n` +
      `${s.mounted} изградени в паметта · ${s.terminals} живи терминала` +
      (mb === null ? '' : `\nJS памет на платното: ${mb} MB`)
  }

  desktop.onChange(() => {
    drawTabs()
    drawLoad()
  })
  drawTabs()
  drawLoad()
  setInterval(drawLoad, 3000)

  return {
    focus: () => {
      input.focus()
      input.select()
      refresh()
    },
    toggleVoice: () => voice.toggle(),
    onOverview: (fn) => {
      overviewHandler = fn
    },
    askAI,
    flash
  }
}
