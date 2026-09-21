/**
 * Explorer, on the canvas.
 *
 * It lists directories and hands files to Windows to open — it never reads a
 * file's contents itself, so nothing here can turn into a way to pull the disk
 * into the canvas. What it adds over the real Explorer is the button that
 * matters here: a terminal opened in the folder you are looking at, next to
 * the agent that needs it.
 */

function size(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u += 1
  }
  return `${n < 10 && u ? n.toFixed(1) : Math.round(n)} ${units[u]}`
}

export function mountFiles(win, { cwd, onOpenTerminal, onChange }) {
  const host = document.createElement('div')
  host.className = 'w20-files'
  host.innerHTML = `
    <div class="w20-files-bar">
      <button class="w20-files-btn" data-role="up" title="Нагоре">↑</button>
      <input class="w20-files-path" data-role="path" spellcheck="false" />
      <button class="w20-files-btn" data-role="term" title="Терминал в тази папка">▸_</button>
    </div>
    <div class="w20-files-list" data-role="list"></div>
  `

  const pathBox = host.querySelector('[data-role="path"]')
  const list = host.querySelector('[data-role="list"]')
  let here = cwd
  let parent = null

  async function show(dir) {
    const result = await window.w20.files.list(dir)
    here = result.path
    parent = result.parent
    pathBox.value = here
    win.setTitle(here.split(/[\\/]/).filter(Boolean).pop() || here)
    list.innerHTML = ''

    if (!result.ok) {
      const err = document.createElement('p')
      err.className = 'w20-files-empty'
      err.textContent = result.error
      list.appendChild(err)
      return
    }
    if (!result.entries.length) {
      const empty = document.createElement('p')
      empty.className = 'w20-files-empty'
      empty.textContent = 'Празна папка'
      list.appendChild(empty)
    }

    for (const entry of result.entries) {
      const row = document.createElement('button')
      row.className = 'w20-files-row' + (entry.dir ? ' is-dir' : '')
      row.innerHTML = `<span class="w20-files-icon"></span><span class="w20-files-name"></span><span class="w20-files-size"></span>`
      row.querySelector('.w20-files-icon').textContent = entry.dir ? '▸' : '·'
      row.querySelector('.w20-files-name').textContent = entry.name
      row.querySelector('.w20-files-size').textContent = entry.dir ? '' : size(entry.size)
      row.addEventListener('click', () => {
        const full = here.replace(/[\\/]+$/, '') + (here.includes('\\') ? '\\' : '/') + entry.name
        if (entry.dir) show(full)
        else window.w20.openPath(full)
      })
      list.appendChild(row)
    }
    if (onChange) onChange(here)
  }

  host.querySelector('[data-role="up"]').addEventListener('click', () => {
    if (parent) show(parent)
  })
  host.querySelector('[data-role="term"]').addEventListener('click', () => {
    if (onOpenTerminal) onOpenTerminal(here)
  })
  pathBox.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') show(pathBox.value.trim())
  })

  win.body.appendChild(host)
  show(cwd)

  return {
    focus: () => list.focus(),
    destroy: () => host.remove()
  }
}
