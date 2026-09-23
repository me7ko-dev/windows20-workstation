'use strict'

const fs = require('fs')
const path = require('path')

/**
 * The user's own keys, in keybindings.json next to settings.json.
 *
 * The file only lists what differs from the defaults — or, once written by
 * "Промени клавишите", every shortcut with its default, so there is something
 * to edit. It is read leniently: // comments and a trailing comma are what
 * people type into a JSON file by hand, and refusing the whole file for them
 * would throw away every other key in it.
 *
 * Two keys are global: they work from anywhere in Windows, with the station
 * minimised — one brings it forward, one brings it forward and listens.
 */

const GLOBAL_DEFAULTS = {
  show: 'Ctrl+Alt+W',
  voice: 'Ctrl+Alt+Space'
}

const GLOBAL_LABELS = {
  show: 'Покажи / скрий станцията отвсякъде в Windows',
  voice: 'Покажи станцията и слушай глас'
}

function lenientParse(text) {
  const cleaned = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(cleaned)
}

/** "Win" is what people call the key; Electron calls it Super. */
function accelerator(combo) {
  return String(combo || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^win(dows)?$/i.test(part) ? 'Super' : part))
    .join('+')
}

function createKeybindings(userDataDir) {
  const file = path.join(userDataDir, 'keybindings.json')
  let globalProblems = []
  let watcher = null
  let debounce = 0

  function readRaw() {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return { data: {}, problems: [] }
    }
    try {
      const data = lenientParse(text)
      return { data: data && typeof data === 'object' ? data : {}, problems: [] }
    } catch (err) {
      return { data: {}, problems: [`keybindings.json не се чете: ${err.message}`] }
    }
  }

  /** { keys: { id: [combo…] }, global: {...}, problems: [...] } */
  function load() {
    const { data, problems } = readRaw()
    const keys = {}
    const source = data.keys && typeof data.keys === 'object' ? data.keys : {}
    for (const [id, value] of Object.entries(source)) {
      if (typeof id !== 'string' || id.length > 80) continue
      const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null
      if (!list) {
        problems.push(`„${id}“: очаква се списък с клавиши, напр. ["Ctrl+Shift+T"]`)
        continue
      }
      keys[id] = list.filter((k) => typeof k === 'string' && k.length < 60).slice(0, 8)
    }
    return { keys, global: global(), problems: problems.concat(globalProblems.map((k) => `Глобалният клавиш ${k} е зает от друга програма или не е валиден`)), file }
  }

  function global() {
    const { data } = readRaw()
    const wanted = { ...GLOBAL_DEFAULTS }
    if (data.global && typeof data.global === 'object') {
      for (const name of Object.keys(GLOBAL_DEFAULTS)) {
        const value = data.global[name]
        // An empty string switches a global key off.
        if (typeof value === 'string') wanted[name] = value
      }
    }
    const out = {}
    for (const [name, combo] of Object.entries(wanted)) out[name] = accelerator(combo)
    return out
  }

  /**
   * Write the file with every shortcut and its default, if it is not there
   * yet — the renderer knows the table, so it sends it along.
   */
  function ensure(defaults) {
    if (fs.existsSync(file)) return file
    const rows = (Array.isArray(defaults) ? defaults : [])
      .filter((d) => d && typeof d.id === 'string' && Array.isArray(d.keys))
      .slice(0, 200)
    const lines = [
      '{',
      '  // Свои клавиши за Windows 20 Workstation.',
      '  // Смени комбинацията, запази файла — станцията я взима веднага, без рестарт.',
      '  // [] изключва клавиш. Примери: "Ctrl+Shift+T", "Alt+Left", "F4", "Ctrl+Alt+1".',
      '  // Редове, които изтриеш, се връщат към подразбирането.',
      '  "keys": {'
    ]
    rows.forEach((d, i) => {
      const label = String(d.label || '').replace(/[\r\n]/g, ' ').slice(0, 120)
      if (label) lines.push(`    // ${label}`)
      const keys = d.keys.filter((k) => typeof k === 'string').map((k) => JSON.stringify(k))
      lines.push(`    ${JSON.stringify(d.id)}: [${keys.join(', ')}]${i < rows.length - 1 ? ',' : ''}`)
    })
    lines.push('  },')
    lines.push('  // Работят отвсякъде в Windows, дори когато станцията е скрита. "" ги изключва.')
    lines.push('  "global": {')
    const names = Object.keys(GLOBAL_DEFAULTS)
    names.forEach((name, i) => {
      lines.push(`    // ${GLOBAL_LABELS[name]}`)
      lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(GLOBAL_DEFAULTS[name])}${i < names.length - 1 ? ',' : ''}`)
    })
    lines.push('  }')
    lines.push('}')
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
    return file
  }

  /** Editors save by replacing the file, so the folder is what is watched. */
  function watch(onChange) {
    unwatch()
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      watcher = fs.watch(userDataDir, (_event, name) => {
        if (name && name !== 'keybindings.json') return
        clearTimeout(debounce)
        debounce = setTimeout(() => onChange(load()), 200)
      })
    } catch {
      watcher = null
    }
  }

  function unwatch() {
    clearTimeout(debounce)
    if (watcher) watcher.close()
    watcher = null
  }

  function setGlobalProblems(list) {
    globalProblems = Array.isArray(list) ? list : []
  }

  return { load, global, ensure, watch, unwatch, setGlobalProblems, file }
}

module.exports = { createKeybindings, lenientParse, accelerator, GLOBAL_DEFAULTS }
