/**
 * The bar at the bottom: one place to type and have the desktop do it.
 *
 * Commands are matched against a small verb table rather than free text,
 * because a wrong guess here spawns a process — the voice layer will sit on
 * top of this same table later, turning speech into one of these entries
 * instead of inventing its own actions.
 */

import { createVoice } from './voice.js'

export function createCommandBar({ root, desktop, programs, canvas, toast }) {
  const el = document.createElement('div')
  el.className = 'w20-bar'
  el.innerHTML = `
    <div class="w20-bar-results" data-role="results" hidden></div>
    <div class="w20-bar-main">
      <button class="w20-bar-mic" data-role="mic" title="Гласът идва по-късно">◉</button>
      <input class="w20-bar-input" data-role="input" placeholder="Напиши команда…" spellcheck="false" />
      <span class="w20-bar-hint">Ctrl+K</span>
      <span class="w20-bar-load" data-role="load"></span>
      <div class="w20-bar-tabs" data-role="tabs"></div>
      <button class="w20-bar-add" data-role="add" title="Ново пространство (Ctrl+Shift+N)">+</button>
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

  function programCommands() {
    return programs.map((program) => ({
      id: `open:${program.id}`,
      label: program.installed ? `Отвори ${program.title}` : `${program.title} (не е инсталирана)`,
      hint: program.kind === 'external' ? 'външен прозорец' : 'терминал на платното',
      keywords: [program.id, program.title, program.command],
      run: () => desktop.openProgram(program)
    }))
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
        id: 'new:note',
        label: 'Нова бележка',
        hint: 'лепенка на платното',
        keywords: ['бележка', 'note', 'план'],
        run: () => desktop.openNote()
      },
      {
        id: 'sys:folder',
        label: 'Смени папката на пространството',
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
        hint: 'ключ за гласа, език',
        keywords: ['настройки', 'settings', 'ключ', 'key', 'глас', 'voice'],
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
        id: 'ws:new',
        label: 'Ново пространство',
        hint: 'Ctrl+Shift+N',
        keywords: ['ново', 'пространство', 'workspace', 'new', 'десктоп'],
        run: () => desktop.addWorkspace()
      },
      {
        id: 'ws:close',
        label: `Затвори пространство ${desktop.activeWorkspace().name}`,
        hint: 'заедно с прозорците в него',
        keywords: ['затвори', 'махни', 'close', 'пространство', 'workspace'],
        run: () => {
          const name = desktop.activeWorkspace().name
          if (desktop.closeWorkspace()) flash(`Пространство ${name} е затворено`)
          else flash('Трябва да остане поне едно пространство')
        }
      }
    ]

    desktop.workspaces.forEach((ws, index) => {
      commands.push({
        id: `go:${index}`,
        label: `Премини на пространство ${ws.name}`,
        hint: `${ws.nodes.length} прозореца`,
        keywords: [ws.name, `${index + 1}`, 'пространство', 'workspace'],
        run: () => desktop.switchTo(index)
      })
    })

    for (const paper of desktop.WALLPAPERS) {
      commands.push({
        id: `paper:${paper.id}`,
        label: `Тапет: ${paper.label}`,
        hint: 'фон на пространството',
        keywords: ['тапет', 'wallpaper', 'фон', paper.id, paper.label],
        run: () => desktop.setWallpaper(paper.id)
      })
    }

    return commands
  }

  function allCommands() {
    return [...programCommands(), ...staticCommands()]
  }

  /** Windows loves a path; if that's what was typed, offer to open it. */
  function pathCommand(query) {
    const looksLikePath = /^[a-zA-Z]:\\/.test(query) || query.startsWith('\\\\') || /^https?:\/\//.test(query)
    if (!looksLikePath) return null
    return {
      id: 'sys:open',
      label: `Отвори ${query}`,
      hint: 'в Windows',
      run: async () => {
        const result = await window.w20.openPath(query)
        if (!result.ok) flash(result.error)
      }
    }
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
    const direct = pathCommand(query)

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
          hint: `пространство ${hit.workspaceName}`,
          run: () => desktop.revealNode(hit.node.id, hit.workspaceIndex)
        }))
      : []

    matches = [...(direct ? [direct] : []), ...nodeHits, ...found]
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

    const best = allCommands()
      .map((command) => ({ command, rank: score(command, text) }))
      .filter((entry) => entry.rank >= 2)
      .sort((a, b) => b.rank - a.rank)[0]

    if (best) {
      toast(`${best.command.label}`, { timeout: 4000 })
      best.command.run()
      return
    }

    // Nothing matched confidently — show the words rather than act on a guess.
    input.value = text
    input.focus()
    refresh()
    toast(`Не разпознах команда в „${text}“ — оставих я в лентата.`, { tone: 'warn' })
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
    flash
  }
}
