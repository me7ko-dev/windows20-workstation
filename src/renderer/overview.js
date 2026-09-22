/**
 * Every station at once.
 *
 * One key steps back from the station you are in to all of them, each drawn
 * as a card: its picture, its fields and the windows in them, laid out with
 * the same arithmetic the station itself uses. Pick one — click, arrows and
 * Enter, or its number — and you are in it.
 *
 * The cards are drawn from the model, not captured from the screen: a station
 * nobody is looking at has no DOM to capture, and that is exactly why having
 * ten of them costs nothing.
 */

import { layout as fieldLayout } from './fields.js'
import { pictures } from './picture-store.js'
import { STYLES, accentOf } from './pictures.js'

const GAP = 18
const PAD_X = 48
const HEAD = 86

export function createOverview({ root, desktop, onOpen }) {
  const el = document.createElement('div')
  el.className = 'w20-overview'
  el.hidden = true
  el.innerHTML = `
    <div class="w20-overview-head">
      <h2>Всички станции</h2>
      <p><kbd>←↑→↓</kbd> избор · <kbd>Enter</kbd> влез · <kbd>1…9</kbd> направо · <kbd>N</kbd> нова · <kbd>Esc</kbd> или <kbd>F3</kbd> назад</p>
    </div>
    <div class="w20-overview-grid" data-role="grid"></div>
  `
  root.appendChild(el)
  const grid = el.querySelector('[data-role="grid"]')

  let open = false
  let selected = 0
  let columns = 1
  let cards = []
  let hideTimer = 0

  function geometry(count) {
    const width = el.clientWidth || window.innerWidth
    const height = (el.clientHeight || window.innerHeight) - HEAD - 30
    const aspect = 16 / 9
    let best = { cols: 1, w: 0 }
    for (let cols = 1; cols <= Math.max(1, count); cols += 1) {
      const rows = Math.ceil(count / cols)
      const byWidth = (width - PAD_X * 2 - GAP * (cols - 1)) / cols
      const byHeight = ((height - GAP * (rows - 1)) / rows - 34) * aspect
      const w = Math.min(byWidth, byHeight, 520)
      if (w > best.w) best = { cols, w }
    }
    return { cols: best.cols, w: Math.floor(best.w), h: Math.floor(best.w / aspect) }
  }

  function describe(ws) {
    const n = ws.nodes.length
    const style = STYLES.find((s) => s.id === (ws.picture && ws.picture.style))
    const count = n === 0 ? 'празна' : n === 1 ? '1 прозорец' : `${n} прозореца`
    return `${count}${style ? ` · ${style.label}` : ''}`
  }

  /** The station's windows, at card size. */
  function schematic(ws, w, h) {
    const box = document.createElement('div')
    box.className = 'w20-card-windows'
    const area = { x: 8, y: 8, width: w - 16, height: h - 16 }
    let rects
    if (ws.layout === 'fields') {
      const result = fieldLayout(ws, area, { gap: 6, inner: 4 })
      rects = result.windows
      if (result.solo) rects = new Map([[result.solo, result.windows.get(result.solo)]])
    } else {
      // A free canvas: every window, scaled to fit the card.
      rects = new Map()
      if (ws.nodes.length) {
        const left = Math.min(...ws.nodes.map((n) => n.x))
        const top = Math.min(...ws.nodes.map((n) => n.y))
        const right = Math.max(...ws.nodes.map((n) => n.x + n.width))
        const bottom = Math.max(...ws.nodes.map((n) => n.y + n.height))
        const k = Math.min(area.width / (right - left), area.height / (bottom - top))
        for (const n of ws.nodes) {
          rects.set(n.id, {
            x: area.x + (n.x - left) * k,
            y: area.y + (n.y - top) * k,
            width: n.width * k,
            height: n.height * k
          })
        }
      }
    }
    for (const node of ws.nodes) {
      const r = rects.get(node.id)
      if (!r) continue
      const win = document.createElement('div')
      win.className = `w20-card-win w20-card-win--${node.type}`
      win.style.setProperty('--node-accent', node.accent || '#9aa2b1')
      win.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`
      win.style.width = `${Math.max(8, Math.round(r.width))}px`
      win.style.height = `${Math.max(8, Math.round(r.height))}px`
      const icon = desktop.ICONS[node.type] || ''
      win.innerHTML = `<span class="w20-card-win-bar"><b></b><span></span></span>`
      win.querySelector('b').textContent = icon
      win.querySelector('span span').textContent = node.title
      if (node.type === 'terminal') {
        const lines = document.createElement('i')
        lines.className = 'w20-card-win-lines'
        win.appendChild(lines)
      }
      box.appendChild(win)
    }
    return box
  }

  function build() {
    const list = desktop.workspaces
    const total = list.length + 1
    const g = geometry(total)
    columns = g.cols
    grid.style.gridTemplateColumns = `repeat(${g.cols}, ${g.w}px)`
    grid.innerHTML = ''
    cards = []

    list.forEach((ws, index) => {
      const card = document.createElement('button')
      card.className = 'w20-card' + (index === desktop.activeIndex ? ' is-current' : '')
      card.dataset.index = String(index)
      const accent = ws.picture ? accentOf(ws.picture.style, ws.picture.seed) : '#5ee0ff'
      card.style.setProperty('--card-accent', accent)
      card.innerHTML = `
        <div class="w20-card-screen" style="width:${g.w}px;height:${g.h}px"></div>
        <div class="w20-card-label">
          <span class="w20-card-num"></span>
          <span class="w20-card-name"></span>
          <span class="w20-card-here">тук си</span>
          <span class="w20-card-meta"></span>
          <span class="w20-card-close" title="Затвори станцията (с всичко в нея)">✕</span>
        </div>
      `
      const screen = card.querySelector('.w20-card-screen')
      if (ws.picture) {
        pictures.thumb(ws.picture).then((thumb) => {
          if (thumb) screen.style.backgroundImage = `url("${thumb.url}")`
        })
      }
      screen.appendChild(schematic(ws, g.w, g.h))
      if (!ws.nodes.length) {
        const empty = document.createElement('span')
        empty.className = 'w20-card-empty'
        empty.textContent = 'празна — влез и отвори нещо'
        screen.appendChild(empty)
      }
      card.querySelector('.w20-card-num').textContent = index < 9 ? String(index + 1) : index === 9 ? '0' : ''
      card.querySelector('.w20-card-name').textContent = `Станция ${ws.name}`
      const running = ws.nodes.filter((n) => n.type === 'terminal').length
      card.querySelector('.w20-card-meta').textContent =
        describe(ws) + (running ? ` · ● ${running} ${running === 1 ? 'терминал' : 'терминала'}` : '')

      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('w20-card-close')) {
          e.stopPropagation()
          askClose(index, e.target)
          return
        }
        choose(index)
      })
      card.addEventListener('pointerenter', () => select(index, false))
      grid.appendChild(card)
      cards.push(card)
    })

    const add = document.createElement('button')
    add.className = 'w20-card w20-card--add'
    add.innerHTML = `<div class="w20-card-screen" style="width:${g.w}px;height:${g.h}px"><span>+</span><small>Нова станция</small></div><div class="w20-card-label"><span class="w20-card-name">&nbsp;</span></div>`
    add.addEventListener('click', () => {
      const index = desktop.addWorkspace({ focus: false })
      build()
      select(index)
    })
    add.addEventListener('pointerenter', () => select(list.length, false))
    grid.appendChild(add)
    cards.push(add)
    select(Math.min(selected, cards.length - 1), false)
  }

  let closeArmed = null
  function askClose(index, button) {
    if (desktop.workspaces.length <= 1) return
    if (closeArmed === index) {
      closeArmed = null
      desktop.closeWorkspace(index)
      selected = Math.min(selected, desktop.workspaces.length - 1)
      build()
      return
    }
    closeArmed = index
    button.textContent = 'Затвори?'
    button.classList.add('is-armed')
    setTimeout(() => {
      if (closeArmed === index) closeArmed = null
      button.textContent = '✕'
      button.classList.remove('is-armed')
    }, 2400)
  }

  function select(index, scroll = true) {
    selected = Math.max(0, Math.min(cards.length - 1, index))
    cards.forEach((card, i) => card.classList.toggle('is-selected', i === selected))
    if (scroll && cards[selected]) cards[selected].scrollIntoView({ block: 'nearest' })
  }

  function choose(index) {
    if (index >= desktop.workspaces.length) {
      desktop.addWorkspace({ focus: false })
      index = desktop.workspaces.length - 1
    }
    const card = cards[index]
    if (card) card.classList.add('is-opening')
    desktop.switchTo(index)
    hide()
    if (onOpen) onOpen(index)
  }

  function show() {
    if (open) return
    open = true
    clearTimeout(hideTimer)
    selected = desktop.activeIndex
    el.hidden = false
    build()
    document.body.classList.add('is-overview')
    requestAnimationFrame(() => el.classList.add('is-open'))
  }

  function hide() {
    if (!open) return
    open = false
    el.classList.remove('is-open')
    document.body.classList.remove('is-overview')
    hideTimer = setTimeout(() => {
      el.hidden = true
      grid.innerHTML = ''
      cards = []
    }, 220)
  }

  // Captured before the station's own shortcuts: while the overview is up,
  // the keys belong to it.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!open) return
      let handled = true
      // By code as well as key: the physical key is what the user pressed.
      const key = e.key || e.code
      if (key === 'ArrowRight' || e.code === 'ArrowRight') select(selected + 1)
      else if (e.code === 'ArrowLeft' || key === 'ArrowLeft') select(selected - 1)
      else if (e.code === 'ArrowDown' || key === 'ArrowDown') select(selected + columns)
      else if (e.code === 'ArrowUp' || key === 'ArrowUp') select(selected - columns)
      else if (key === 'Enter' || e.code === 'Enter' || key === ' ' || e.code === 'Space') choose(selected)
      else if (key === 'Escape' || e.code === 'Escape' || key === 'F3' || e.code === 'F3' || (e.ctrlKey && e.shiftKey && e.code === 'KeyA')) hide()
      else if (/^Digit[0-9]$/.test(e.code) && !e.ctrlKey) {
        const n = Number(e.code.slice(5))
        const index = n === 0 ? 9 : n - 1
        if (index < desktop.workspaces.length) choose(index)
      } else if (e.code === 'KeyN' && !e.ctrlKey) {
        desktop.addWorkspace({ focus: false })
        build()
        select(desktop.workspaces.length - 1)
      } else if (e.code === 'Delete') {
        const card = cards[selected]
        const button = card && card.querySelector('.w20-card-close')
        if (button) askClose(selected, button)
      } else handled = false
      if (handled) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    },
    true
  )

  // Zooming back in, over a card, goes into it.
  el.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (e.deltaY < 0) choose(selected)
    },
    { passive: false }
  )

  el.addEventListener('click', (e) => {
    if (e.target === el || e.target === grid) hide()
  })

  window.addEventListener('resize', () => {
    if (open) build()
  })

  return {
    show,
    hide,
    toggle: () => (open ? hide() : show()),
    get open() {
      return open
    }
  }
}
