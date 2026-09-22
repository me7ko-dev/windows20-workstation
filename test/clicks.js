'use strict'

/**
 * Click everything.
 *
 * Every dock button, every command the bar can show, every shortcut, and every
 * control inside every kind of window — pressed once, with every error the
 * renderer or the main process raises collected and reported. The point is not
 * that each one does the right thing (the other suite checks that); it is that
 * nothing anywhere throws.
 *
 * The things that would leave this machine are stubbed at the edge: the folder
 * dialog, opening a path in Windows, launching a program, and VS Code's
 * `serve-web`. Everything above those, including all of our own code, is real.
 */

const Module = require('module')
const http = require('http')
const path = require('path')

/** A folder that is certainly here, for the file window to walk. */
const SRC_DIR = path.join(__dirname, '..', 'src')

/* ----------------------------------------------------- a page to browse */

// The browser window needs something to open. Serving it from here keeps the
// check self-contained: no other process has to be running for it to pass.
const PAGE_PORT = 8137
const pageServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(
    '<!doctype html><html><head><meta charset="utf-8"><title>Тестова страница</title></head>' +
      '<body style="font-family:sans-serif;background:#101418;color:#eef1f7;padding:40px">' +
      '<h1>Страница вътре в станцията</h1></body></html>'
  )
})

/* ------------------------------------------------ a stand-in for the ИИ */

// An OpenAI-compatible service on localhost, so the ИИ path and the speech
// path are checked end to end without a key or the internet. It answers the
// way a model would — with an id from the list, or one it made up.
const AI_PORT = 8139
const aiRequests = []
const aiServer = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    aiRequests.push({ url: req.url, auth: req.headers.authorization || '', body: body.toString('utf8') })
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    if (req.url.endsWith('/audio/transcriptions')) {
      res.end(JSON.stringify({ text: 'нова бележка' }))
      return
    }
    const said = (/Потребителят каза: „([^“]*)“/.exec(JSON.parse(body.toString('utf8')).messages[1].content) || [])[1] || ''
    let reply = { command: null, say: 'Не разбрах.' }
    if (said.includes('бележка')) reply = { command: 'new:note', say: 'Отварям нова бележка.' }
    else if (said.includes('измислена')) reply = { command: 'rm:everything', say: '' }
    else if (said.includes('затвори пространството')) {
      const id = (/(ws:close) —/.exec(body.toString('utf8')) || [])[1]
      reply = { command: id || null, say: '' }
    }
    // Wrapped in prose and a fence, the way models often do.
    const content = 'Ето:\n```json\n' + JSON.stringify(reply) + '\n```'
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
  })
})

/* -------------------------------------------------- the machine's edges */

const spawned = []
const launched = []
const opened = []

const ptyStub = {
  spawn(shell, args, opts) {
    const proc = {
      shell,
      opts,
      alive: true,
      handlers: { data: [], exit: [] },
      onData(fn) {
        this.handlers.data.push(fn)
      },
      onExit(fn) {
        this.handlers.exit.push(fn)
      },
      write() {},
      resize() {},
      kill() {
        this.alive = false
        for (const fn of this.handlers.exit) fn({ exitCode: 0 })
      }
    }
    spawned.push(proc)
    setTimeout(() => {
      for (const fn of proc.handlers.data) fn('$ ')
    }, 20)
    return proc
  }
}

const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'node-pty') return 'node-pty-stub'
  return realResolve.call(this, request, ...rest)
}
require.cache['node-pty-stub'] = { id: 'node-pty-stub', filename: 'node-pty-stub', loaded: true, exports: ptyStub }

// `program:launch` and `serve-web` both go through child_process.spawn. The
// editor's stub answers the way `code serve-web` does, with a URL on stdout,
// so the whole editor path runs — our side of it, not VS Code's.
const child = require('child_process')
child.spawn = function (command, args = [], options) {
  const isServe = Array.isArray(args) && args.includes('serve-web')
  launched.push({ command, args, serve: isServe })
  const { EventEmitter } = require('events')
  const fake = new EventEmitter()
  fake.killed = false
  fake.kill = () => {
    fake.killed = true
  }
  fake.unref = () => {}
  fake.stdout = new EventEmitter()
  fake.stderr = new EventEmitter()
  if (isServe) {
    setTimeout(() => fake.stdout.emit('data', 'Web UI available at http://localhost:8137/?tkn=stub\n'), 120)
  }
  return fake
}

const electron = require('electron')
const { app, BrowserWindow } = electron

electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
electron.shell.openExternal = async (target) => {
  opened.push(target)
}
electron.shell.openPath = async (target) => {
  opened.push(target)
  return ''
}

app.setPath('userData', '/tmp/w20-click-data')
// Settings from an earlier run would change what the bar and the ИИ do.
require('fs').rmSync('/tmp/w20-click-data/settings.json', { force: true })
require('../src/main/main.js')

/* ---------------------------------------------------------------- report */

const mainErrors = []
process.on('uncaughtException', (err) => mainErrors.push(`main: ${err.stack || err.message}`))
process.on('unhandledRejection', (err) => mainErrors.push(`main: ${(err && err.stack) || err}`))

const clicks = []
function did(what, detail = '') {
  clicks.push({ what, detail })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Electron does not promise an order for getAllWindows, so the station under
// test is held by the id of its webContents. Taking index 0 means that opening
// a second station can silently move the test to a page that knows nothing.
let homeId = null
const station = () => BrowserWindow.getAllWindows().find((w) => w.webContents.id === homeId)
const extras = () => BrowserWindow.getAllWindows().filter((w) => w.webContents.id !== homeId)
const run = (code) => station().webContents.executeJavaScript(`(async () => { ${code} })()`, true)

const WATCH = `
  window.__errors = []
  window.addEventListener('error', (e) => window.__errors.push('error: ' + (e.message || e.error)))
  window.addEventListener('unhandledrejection', (e) =>
    window.__errors.push('rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)))
  window.__t = {
    key(k, o = {}) {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        // The code is the physical key, which is what the shortcuts read — so
        // they work the same on a Bulgarian layout.
        key: k,
        code: o.code || (/^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^[0-9]$/.test(k) ? 'Digit' + k : ''),
        ctrlKey: o.ctrl !== false, shiftKey: !!o.shift, altKey: !!o.alt,
        bubbles: true, cancelable: true
      }))
    },
    layer() { return [...document.querySelectorAll('.w20-plane-layer')].find((l) => !l.hidden) },
    nodes() { return [...window.__t.layer().querySelectorAll('.w20-window')] },
    kinds() { return window.__t.nodes().map((el) => (/w20-window--(\\w+)/.exec(el.className) || [])[1]) },
    clear() { document.querySelectorAll('.w20-window-close').forEach((b) => b.click()) },
    dock() { return [...document.querySelectorAll('.w20-dock-item')] },
    dockLabels() { return window.__t.dock().map((b) => b.querySelector('.w20-dock-label').textContent) },
    async type(text) {
      const input = document.querySelector('.w20-bar-input')
      input.focus()
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
      return [...document.querySelectorAll('.w20-bar-row')].map((r) => r.querySelector('.w20-bar-row-label').textContent)
    },
    async runLabel(label) {
      const rows = [...document.querySelectorAll('.w20-bar-row')]
      const at = rows.findIndex((r) => r.querySelector('.w20-bar-row-label').textContent === label)
      if (at < 0) return false
      rows[at].click()
      return true
    },
    press(el, type, extra = {}) {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 11, button: 0, ...extra }))
    },
    errors() { const e = window.__errors.slice(); window.__errors.length = 0; return e }
  }
`

const seen = []
const failures = []

/** A handful of things that must be true, not merely not throw. */
function expect(name, ok, detail = '') {
  if (!ok) failures.push({ name, detail })
  console.log(`  ${ok ? 'ok' : 'НЕ'}  ${name}${detail ? ' — ' + detail : ''}`)
}
async function drain(label) {
  const fromPage = await run('return window.__t.errors()')
  const all = [...fromPage, ...mainErrors.splice(0)]
  for (const message of all) seen.push({ where: label, message })
  return all
}

async function main() {
  await new Promise((r) => pageServer.listen(PAGE_PORT, '127.0.0.1', r))
  await new Promise((r) => aiServer.listen(AI_PORT, '127.0.0.1', r))
  await app.whenReady()
  await sleep(2600)

  const win = BrowserWindow.getAllWindows()[0]
  homeId = win.webContents.id
  win.setSize(1500, 950)
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning')) mainErrors.push(`console: ${message}`)
  })
  await run(WATCH)
  await sleep(400)
  await run('window.__t.clear(); return true')
  await sleep(400)

  /* =============================================================== dock */

  const dockLabels = await run('return window.__t.dockLabels()')
  console.log(`\n— докът: ${dockLabels.length} бутона —`)
  for (let i = 0; i < dockLabels.length; i += 1) {
    const before = await run('return window.__t.nodes().length')
    await run(`window.__t.dock()[${i}].click(); return true`)
    await sleep(900)
    const after = await run('return window.__t.kinds()')
    const errs = await drain(`док: ${dockLabels[i]}`)
    did(`док: ${dockLabels[i]}`)
    console.log(
      `  ${errs.length ? 'ГРЕШКА' : 'ok'}  ${dockLabels[i].padEnd(18)} → ${
        after.length > before ? after[after.length - 1] : 'нищо не се отвори'
      }`
    )
    if (after.length > 6) {
      await run('window.__t.clear(); return true')
      await sleep(500)
    }
  }
  await run('window.__t.clear(); return true')
  await sleep(500)

  /* ====================================================== every command */

  // Crawl the bar: start from single letters, then use the words of every
  // label found so far as new queries, until nothing new turns up. That finds
  // the commands from the bar's own behaviour rather than from a list here.
  const alphabet = 'абвгдежзийклмнопрстуфхцчшщъьюя0123456789abcdefghijklmnopqrstuvwxyz'.split('')
  const found = new Set()

  // A focused window, so the commands that need one are offered too.
  await run(`window.__t.key('n'); return true`)
  await sleep(400)

  async function crawl(queries) {
    const fresh = []
    for (const q of queries) {
      const labels = await run(`return await window.__t.type(${JSON.stringify(q)})`)
      for (const label of labels) {
        if (!found.has(label)) {
          found.add(label)
          fresh.push(label)
        }
      }
    }
    return fresh
  }

  let wave = await crawl(alphabet)
  for (let round = 0; round < 3 && wave.length; round += 1) {
    const words = new Set()
    for (const label of wave) {
      for (const word of label.split(/[\s„“"'(),.:—–-]+/)) {
        if (word.length >= 3) words.add(word.toLowerCase())
      }
    }
    wave = await crawl([...words])
  }

  const commands = [...found].sort()
  console.log(`\n— лентата: ${commands.length} различни команди —`)
  for (const label of commands) console.log(`    · ${label}`)

  let ran = 0
  for (const label of commands) {
    // Find it again, then run it: the list is rebuilt on every keystroke.
    const query = label.split(/\s+/)[0].replace(/[„“"]/g, '')
    await run(`return await window.__t.type(${JSON.stringify(query)})`)
    const clicked = await run(`return await window.__t.runLabel(${JSON.stringify(label)})`)
    if (!clicked) {
      // A label that only appears for a particular state — reach it by its
      // whole text instead of its first word.
      await run(`return await window.__t.type(${JSON.stringify(label.slice(0, 24))})`)
      await run(`return await window.__t.runLabel(${JSON.stringify(label)})`)
    }
    await sleep(320)
    const errs = await drain(`команда: ${label}`)
    did(`команда: ${label}`)
    ran += 1
    if (errs.length) console.log(`  ГРЕШКА  ${label} — ${errs[0]}`)

    // Keep the canvas and the stations from growing without bound.
    if (ran % 8 === 0) {
      for (const extra of extras()) extra.destroy()
      await sleep(200)
      await run('window.__t.clear(); return true')
      await sleep(300)
      await run(`window.__t.key('n'); return true`)
      await sleep(200)
    }
  }
  for (const extra of extras()) extra.destroy()
  await sleep(400)
  await run('window.__t.clear(); return true')
  await sleep(400)
  console.log(`  изпълнени: ${ran}`)

  /* ========================================================= every key */

  const keys = [
    ['k', {}, 'командната лента'],
    ['t', {}, 'нов терминал'],
    ['n', {}, 'нова бележка'],
    ['w', {}, 'затвори прозореца'],
    ['m', {}, 'картата'],
    ['m', {}, 'картата обратно'],
    ['e', { shift: true }, 'разгъни'],
    ['e', { shift: true }, 'свий'],
    ['g', { shift: true }, 'подреди'],
    ['0', { shift: true, code: 'Digit0' }, 'побери всичко'],
    ['b', { shift: true }, 'друг фон'],
    ['n', { shift: true }, 'ново пространство'],
    ['Tab', {}, 'следващо пространство'],
    ['Tab', { shift: true }, 'предишно пространство'],
    ['1', {}, 'пространство 1'],
    ['2', {}, 'пространство 2'],
    ['9', {}, 'пространство 9'],
    ['=', {}, 'приближи'],
    ['-', {}, 'отдалечи'],
    ['0', {}, 'мащаб 100%'],
    ['`', { code: 'Backquote' }, 'следваща станция'],
    ['`', { shift: true, code: 'Backquote' }, 'предишна станция'],
    [' ', { shift: true, code: 'Space' }, 'говори'],
    ['n', { alt: true }, 'нова станция']
  ]

  console.log(`\n— клавишите: ${keys.length} комбинации —`)
  await run(`window.__t.key('t'); return true`)
  await sleep(800)
  for (const [key, opts, what] of keys) {
    await run(`window.__t.key(${JSON.stringify(key)}, ${JSON.stringify(opts)}); return true`)
    await sleep(key === 'n' && opts.alt ? 2200 : 260)
    const errs = await drain(`клавиш: ${what}`)
    did(`клавиш: ${what}`)
    if (errs.length) console.log(`  ГРЕШКА  ${what} — ${errs[0]}`)
  }
  for (const extra of extras()) extra.destroy()
  await sleep(400)
  console.log(`  без грешки: ${seen.filter((s) => s.where.startsWith('клавиш')).length === 0}`)

  /* ============================================ controls inside windows */

  console.log('\n— бутоните вътре в прозорците —')

  async function controls(setup, name, steps) {
    await run(`window.__t.clear(); await new Promise((r) => setTimeout(r, 300)); ${setup}; return true`)
    await sleep(1200)
    for (const [what, code] of steps) {
      await run(`${code}; return true`)
      await sleep(360)
      const errs = await drain(`${name}: ${what}`)
      did(`${name}: ${what}`)
      console.log(`  ${errs.length ? 'ГРЕШКА' : 'ok'}  ${name} — ${what}${errs.length ? ' — ' + errs[0] : ''}`)
    }
  }

  await controls(`window.__t.key('t')`, 'терминал', [
    ['клик в тялото', `window.__t.press(document.querySelector('.w20-window--terminal .w20-window-body'), 'pointerup')`],
    ['двоен клик по заглавието', `document.querySelector('.w20-window--terminal .w20-window-bar').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`],
    ['двоен клик обратно', `document.querySelector('.w20-window--terminal .w20-window-bar').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`],
    ['влачене за оразмеряване', `
      const g = document.querySelector('.w20-window--terminal .w20-window-grip')
      window.__t.press(g, 'pointerdown', { clientX: 0, clientY: 0 })
      window.__t.press(g, 'pointermove', { clientX: 120, clientY: 90 })
      window.__t.press(g, 'pointerup', { clientX: 120, clientY: 90 })`],
    ['влачене на заглавието', `
      const b = document.querySelector('.w20-window--terminal .w20-window-bar')
      window.__t.press(b, 'pointerdown', { clientX: 0, clientY: 0 })
      window.__t.press(b, 'pointermove', { clientX: 60, clientY: 40 })
      window.__t.press(b, 'pointerup', { clientX: 60, clientY: 40 })`],
    ['затваряне', `document.querySelector('.w20-window--terminal .w20-window-close').click()`]
  ])

  await controls(`window.__t.key('n')`, 'бележка', [
    ['писане', `
      const a = document.querySelector('.w20-note')
      a.value = 'проба'
      a.dispatchEvent(new Event('input', { bubbles: true }))`],
    ['затваряне', `document.querySelector('.w20-window--note .w20-window-close').click()`]
  ])

  await controls(
    `const d = window.__t.dock(); d[window.__t.dockLabels().indexOf('Браузър')].click()`,
    'браузър',
    [
      ['адрес', `
        const b = document.querySelector('.w20-web-url')
        b.value = 'http://localhost:8137/'
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((r) => setTimeout(r, 2500))`],
      ['презареди', `document.querySelector('.w20-web-btn[data-role="reload"]').click()`],
      ['назад', `document.querySelector('.w20-web-btn[data-role="back"]').click()`],
      ['напред', `document.querySelector('.w20-web-btn[data-role="forward"]').click()`],
      ['навън', `document.querySelector('.w20-web-btn[data-role="external"]').click()`],
      ['празен адрес', `
        const b = document.querySelector('.w20-web-url')
        b.value = '   '
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`],
      ['адрес, който не съществува', `
        const b = document.querySelector('.w20-web-url')
        b.value = 'http://localhost:9/нищо'
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((r) => setTimeout(r, 1500))`],
      ['Escape в адреса', `
        const b = document.querySelector('.w20-web-url')
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`]
    ]
  )

  // Not throwing is not the same as telling the user. An address the guest
  // refuses outright has to end up on the screen, not only in a log.
  const refused = await run(`
    const f = document.querySelector('.w20-web-fail')
    return { shown: !f.hidden, text: f.textContent,
             badge: document.querySelector('.w20-window--web .w20-window-badge').textContent }
  `)
  expect(
    'отказан адрес се показва на потребителя, без вътрешни подробности',
    refused.shown && /не се отвори/.test(refused.text) && !/remote method/.test(refused.text),
    `${refused.badge} · ${refused.text.slice(0, 60)}`)

  const loaded = await run(`
    const b = document.querySelector('.w20-web-url')
    b.value = 'http://localhost:8137/'
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((r) => setTimeout(r, 2600))
    const f = document.querySelector('webview')
    let at = ''
    try { at = f.getURL() } catch {}
    return { at, title: document.querySelector('.w20-window--web .w20-window-title').textContent,
             fail: document.querySelector('.w20-web-fail').hidden }
  `)
  expect('след отказа браузърът се съвзема и зарежда', loaded.at === 'http://localhost:8137/' && loaded.fail,
    `${loaded.at} · ${loaded.title}`)
  expect('прозорецът носи заглавието на страницата', loaded.title === 'Тестова страница', loaded.title)
  await run(`document.querySelector('.w20-window--web .w20-window-close').click(); return true`)
  await sleep(300)
  await drain('браузър: проверки')

  await controls(
    `const d = window.__t.dock(); d[window.__t.dockLabels().indexOf('Файлове')].click()`,
    'файлове',
    [
      ['път към истинска папка', `
        const b = document.querySelector('.w20-files-path')
        b.value = ${JSON.stringify(SRC_DIR)}
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((r) => setTimeout(r, 700))`],
      ['влизане в папка', `document.querySelectorAll('.w20-files-row.is-dir')[0].click()`],
      ['отваряне на файл', `
        await new Promise((r) => setTimeout(r, 600))
        const f = [...document.querySelectorAll('.w20-files-row:not(.is-dir)')][0]
        if (f) f.click()`],
      ['нагоре', `document.querySelector('.w20-files-btn[data-role="up"]').click()`],
      ['терминал тук', `document.querySelector('.w20-files-btn[data-role="term"]').click()`],
      ['път, който не съществува', `
        const b = document.querySelector('.w20-files-path')
        b.value = '/няма/такава/папка'
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((r) => setTimeout(r, 500))`],
      ['затваряне', `document.querySelector('.w20-window--files .w20-window-close').click()`]
    ]
  )

  await controls(
    `const d = window.__t.dock(); d[window.__t.dockLabels().indexOf('VS Code')].click()`,
    'редактор',
    [
      ['изчакване на сървъра', `await new Promise((r) => setTimeout(r, 2600))`],
      ['затваряне', `document.querySelector('.w20-window--web .w20-window-close').click()`]
    ]
  )

  await controls(`window.__t.key('k')`, 'настройки', [
    ['отваряне', `
      await window.__t.type('настройки')
      await window.__t.runLabel('Настройки')
      await new Promise((r) => setTimeout(r, 700))`],
    ['запазване без ключ', `document.querySelector('[data-role="save"]').click()`],
    ['запазване с ключ', `
      document.querySelector('[data-role="stt-key"]').value = 'gsk-проба'
      document.querySelector('[data-role="stt-model"]').value = 'whisper-large-v3'
      document.querySelector('[data-role="save"]').click()
      await new Promise((r) => setTimeout(r, 500))`],
    ['всяка услуга в списъците', `
      for (const role of ['stt-provider', 'ai-provider', 'speech-engine']) {
        const select = document.querySelector('[data-role="' + role + '"]')
        for (const option of [...select.options]) {
          select.value = option.value
          select.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }`],
    ['скорост на гласа', `
      const r = document.querySelector('[data-role="speech-rate"]')
      r.value = '1.3'
      r.dispatchEvent(new Event('input', { bubbles: true }))`],
    ['линк за ключ', `
      document.querySelector('[data-role="ai-provider"]').value = 'groq'
      document.querySelector('[data-role="ai-provider"]').dispatchEvent(new Event('change', { bubbles: true }))
      // The real address is out on the internet; the check stays on this machine.
      const link = document.querySelector('[data-role="ai-key-link"]')
      link.dataset.url = 'http://127.0.0.1:${PAGE_PORT}/'
      link.click()
      await new Promise((r) => setTimeout(r, 300))
      document.querySelector('.w20-window--web .w20-window-close')?.click()`],
    ['пробвай гласа', `
      document.querySelector('[data-role="speech-engine"]').value = 'off'
      document.querySelector('[data-role="try"]').click()
      await new Promise((r) => setTimeout(r, 1500))`],
    ['затваряне', `document.querySelector('.w20-window--settings .w20-window-close').click()`]
  ])

  /* ================================================ the shell's own chrome */

  console.log('\n— лентата, разделите, картата —')
  const chrome = [
    ['микрофонът', `document.querySelector('.w20-bar-mic').click()`],
    ['микрофонът пак', `document.querySelector('.w20-bar-mic').click()`],
    ['бутонът „+“', `document.querySelector('.w20-bar-add').click()`],
    ['раздел на пространство', `document.querySelectorAll('.w20-tab')[0].click()`],
    ['последният раздел', `const t = document.querySelectorAll('.w20-tab'); t[t.length - 1].click()`],
    ['клик по картата', `
      const c = document.querySelector('.w20-map-canvas')
      const r = c.getBoundingClientRect()
      window.__t.press(c, 'pointerdown', { clientX: r.left + 30, clientY: r.top + 30 })
      window.__t.press(c, 'pointermove', { clientX: r.left + 90, clientY: r.top + 70 })
      window.__t.press(c, 'pointerup', { clientX: r.left + 90, clientY: r.top + 70 })`],
    ['клик по картата при празно пространство', `
      window.__t.clear()
      await new Promise((r) => setTimeout(r, 300))
      const c = document.querySelector('.w20-map-canvas')
      const r = c.getBoundingClientRect()
      window.__t.press(c, 'pointerdown', { clientX: r.left + 10, clientY: r.top + 10 })
      window.__t.press(c, 'pointerup', { clientX: r.left + 10, clientY: r.top + 10 })`],
    ['стрелки и Enter в лентата', `
      const i = document.querySelector('.w20-bar-input')
      i.focus(); i.value = 'нов'; i.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`],
    ['Escape в лентата', `
      const i = document.querySelector('.w20-bar-input')
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`],
    ['Enter в празна лента', `
      const i = document.querySelector('.w20-bar-input')
      i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`],
    ['безсмислица в лентата', `
      const i = document.querySelector('.w20-bar-input')
      i.focus(); i.value = 'ъъъщщщьььй'; i.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 80))
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`],
    ['влачене по празното платно', `
      const vp = document.getElementById('viewport')
      window.__t.press(vp, 'pointerdown', { clientX: 700, clientY: 400 })
      window.__t.press(vp, 'pointermove', { clientX: 620, clientY: 340 })
      window.__t.press(vp, 'pointerup', { clientX: 620, clientY: 340 })`],
    ['колелце и мащаб', `
      const vp = document.getElementById('viewport')
      vp.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }))
      vp.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, clientX: 700, clientY: 400, bubbles: true, cancelable: true }))`]
  ]
  for (const [what, code] of chrome) {
    await run(`${code}; return true`)
    await sleep(340)
    const errs = await drain(`лента: ${what}`)
    did(`лента: ${what}`)
    console.log(`  ${errs.length ? 'ГРЕШКА' : 'ok'}  ${what}${errs.length ? ' — ' + errs[0] : ''}`)
  }

  /* -------------------------------- the awkward ones: empty and repeated */

  console.log('\n— празни и повторени случаи —')
  const edges = [
    ['разгъване без избран прозорец', `window.__t.clear(); await new Promise((r) => setTimeout(r, 300)); window.__t.key('e', { shift: true })`],
    ['затваряне без избран прозорец', `window.__t.key('w')`],
    ['подреждане на празно пространство', `window.__t.key('g', { shift: true })`],
    ['побиране на празно пространство', `window.__t.key('0', { shift: true, code: 'Digit0' })`],
    ['затваряне на последното пространство', `
      for (let i = 0; i < 8; i += 1) {
        await window.__t.type('Затвори пространство')
        const rows = [...document.querySelectorAll('.w20-bar-row')]
        const at = rows.findIndex((r) => r.querySelector('.w20-bar-row-label').textContent.startsWith('Затвори пространство'))
        if (at >= 0) rows[at].click()
        await new Promise((r) => setTimeout(r, 200))
      }`],
    ['двайсет нови пространства подред', `
      for (let i = 0; i < 20; i += 1) window.__t.key('n', { shift: true })`],
    ['превключване през всички раздели', `
      for (const tab of document.querySelectorAll('.w20-tab')) { tab.click(); await new Promise((r) => setTimeout(r, 40)) }`],
    ['затваряне на прозорец два пъти', `
      window.__t.key('t')
      await new Promise((r) => setTimeout(r, 700))
      const btn = document.querySelector('.w20-window--terminal .w20-window-close')
      btn.click(); btn.click()`]
  ]
  for (const [what, code] of edges) {
    await run(`${code}; return true`)
    await sleep(420)
    const errs = await drain(`ръб: ${what}`)
    did(`ръб: ${what}`)
    console.log(`  ${errs.length ? 'ГРЕШКА' : 'ok'}  ${what}${errs.length ? ' — ' + errs[0] : ''}`)
  }

  /* ============================================================ the ИИ */

  console.log('\n— ИИ навигацията —')
  const secret = 'gsk-тайна-проба'
  const safe = await run(`
    return JSON.stringify(await window.w20.settings.set({
      stt: { provider: 'custom', endpoint: 'http://127.0.0.1:${AI_PORT}/v1', model: '' },
      ai: { provider: 'custom', endpoint: 'http://127.0.0.1:${AI_PORT}/v1', model: 'проба' },
      speech: { engine: 'off' },
      keys: { groq: '${secret}' }
    }))`)
  expect('ключът не стига до платното', !safe.includes(secret))
  expect('ИИ е готов със свой адрес', JSON.parse(safe).ai.ready === true)

  const heard = await run(`return await window.w20.voice.transcribe(new Uint8Array(4000).buffer, 'audio/webm')`)
  expect('гласът минава през своя адрес', heard.ok && heard.text === 'нова бележка', JSON.stringify(heard))

  async function ask(text) {
    await run(`window.__t.clear(); return true`)
    await sleep(300)
    await run(`return await window.__t.type(${JSON.stringify(text)})`)
    const clicked = await run(`return await window.__t.runLabel('Попитай ИИ')`)
    await sleep(700)
    return clicked
  }

  expect('лентата предлага „Попитай ИИ“', await ask('направи ми бележка за утре'))
  expect('ИИ отваря бележка', (await run('return window.__t.kinds()')).includes('note'))
  const asked = aiRequests.filter((r) => r.url.endsWith('/chat/completions')).pop()
  expect('ИИ вижда командите', !!asked && asked.body.includes('new:note —'))

  await ask('измислена команда')
  expect('измислена команда не прави нищо', (await run('return window.__t.nodes().length')) === 0)

  const tabsBefore = await run(`return document.querySelectorAll('.w20-tab').length`)
  await ask('затвори пространството')
  const tabsAfter = await run(`return document.querySelectorAll('.w20-tab').length`)
  const waiting = await run(`return document.querySelector('.w20-bar-input').value`)
  expect('необратимото чака Enter', tabsAfter === tabsBefore && waiting.startsWith('Затвори пространство'), waiting)
  await run(`document.querySelector('.w20-bar-input').value = ''; document.querySelector('.w20-bar-input').blur(); return true`)

  did('ИИ: бележка, измислена команда, необратима команда')

  await sleep(600)
  await drain('накрая')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`натиснати: ${clicks.length}`)
  console.log(`открити команди в лентата: ${commands.length}`)
  console.log(`терминали пуснати: ${spawned.length} · програми стартирани: ${launched.length} · пътища към Windows: ${opened.length}`)
  if (seen.length) {
    console.log(`\nГРЕШКИ: ${seen.length}`)
    for (const e of seen) console.log(`  [${e.where}] ${e.message}`)
  } else {
    console.log('\nГРЕШКИ: няма')
  }
  if (failures.length) {
    console.log(`НЕИЗПЪЛНЕНИ ТВЪРДЕНИЯ: ${failures.length}`)
    for (const f of failures) console.log(`  ${f.name} — ${f.detail}`)
  }
  pageServer.close()
  aiServer.close()
  app.exit(seen.length + failures.length ? 1 : 0)
}

main().catch((err) => {
  console.error('ХАРНЕС ПАДНА:', err)
  app.exit(2)
})
