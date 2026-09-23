'use strict'

const path = require('path')
const os = require('os')
const fsp = require('fs/promises')
const { app, BrowserWindow, ipcMain, shell, dialog, screen, Menu, globalShortcut, nativeTheme } = require('electron')

const term = require('./pty')
const { detect } = require('./programs')
const { createStore } = require('./store')
const { createSettings } = require('./settings')
const { transcribe } = require('./stt')
const ai = require('./ai')
const speech = require('./speech')
const { catalog: providerCatalog } = require('./providers')
const { createKeybindings } = require('./keybindings')
const genesis = require('./genesis')

let store = null
let settings = null
let keybindings = null
let programCache = null
let quitting = false
let lastFocused = null

/**
 * Every open station window, by the id of the webContents that asked. A station
 * is a whole workstation — its own workspaces, its own layout on disk and its
 * own terminals — so nothing here may be global except the machine itself.
 */
const stations = new Map()

function programs() {
  if (!programCache) programCache = detect()
  return programCache
}

/** The station that sent an IPC message. */
function stationOf(event) {
  return stations.get(event.sender.id) || null
}

/** Stations in a stable order, so cycling always goes the same way round. */
function ordered() {
  return Array.from(stations.values()).sort((a, b) => a.id.localeCompare(b.id))
}

/** Lowest number not already taken by an open station. */
function nextStationId() {
  const taken = new Set(Array.from(stations.values()).map((s) => Number(s.id)))
  let n = 1
  while (taken.has(n)) n += 1
  return String(n).padStart(2, '0')
}

function createWindow(stationId) {
  const id = stationId || nextStationId()
  // Cascade, so opening a second station does not hide the first one exactly.
  const previous = Array.from(stations.values()).pop()
  const from = previous ? previous.win.getBounds() : null

  const win = new BrowserWindow({
    width: from ? from.width : 1440,
    height: from ? from.height : 900,
    x: from ? from.x + 32 : undefined,
    y: from ? from.y + 32 : undefined,
    // Low enough that three stations tile on a 1920 screen; below this the
    // dock and the command bar have nowhere left to shrink to.
    minWidth: 620,
    minHeight: 520,
    show: false,
    backgroundColor: '#0b0d12',
    title: `Windows 20 Workstation — ${id}`,
    // A custom title bar, because the canvas is the whole surface — but the
    // Windows caption buttons stay native so snap layouts keep working.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b0d12',
      symbolColor: '#eef1f7',
      height: 38
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Web windows on the canvas — the browser, and the editor served by
      // VS Code's own web mode. A <webview> is its own process with no
      // preload and no node, so a page cannot reach this application.
      webviewTag: true
    }
  })

  const contentsId = win.webContents.id
  stations.set(contentsId, { id, win })
  store.remember(id)

  win.once('ready-to-show', () => win.show())
  // The global keys go to the station last in front.
  lastFocused = win
  win.on('focus', () => {
    lastFocused = win
  })
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  // A canvas window opening a link must never navigate the shell itself away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Web windows on the canvas. The guest gets no preload and no node, whatever
  // the renderer asked for — a page on the canvas is a page, not a plugin.
  win.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    params.allowpopups = false
  })

  // The canvas is our own page, but it must not be able to grant itself
  // anything beyond the microphone the voice bar needs.
  win.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture')
  })

  win.on('closed', () => {
    stations.delete(contentsId)
    // The windows on this canvas were the processes; none of them outlives it.
    term.killOwner(id)
    // Closing a station is a decision; quitting with it open is not.
    if (!quitting) store.forget(id)
  })

  return win
}

app.whenReady().then(() => {
  // No application menu. Its accelerators — Ctrl+W closing the whole window,
  // Ctrl+R reloading it, Ctrl+0/+/- zooming the page — would fire over the
  // station's own keys. Text fields still copy and paste on their own.
  Menu.setApplicationMenu(null)
  store = createStore(app.getPath('userData'))
  settings = createSettings(app.getPath('userData'))
  keybindings = createKeybindings(app.getPath('userData'))
  applyTheme(settings.read().look.theme)
  registerGlobal()
  // Genesis starts with the station, as its own process, so the chat finds it
  // already awake. Not waited for: the station does not need it to open.
  const chatConfig = settings.read().chat
  if (chatConfig.provider === 'genesis' && chatConfig.autostart !== false) {
    genesis.ensure({ url: chatConfig.genesisUrl, autostart: true, env: agentEnv(settings) }).catch(() => {})
  }
  // Edited keybindings.json: every station takes the new keys, and so do the
  // global ones, without a restart.
  keybindings.watch(() => {
    registerGlobal()
    const result = keybindings.load()
    for (const { win } of stations.values()) {
      if (!win.isDestroyed()) win.webContents.send('keys:changed', result)
    }
  })

  // Three stations open at quit come back as three stations.
  const previous = store.order()
  if (previous.length) previous.forEach((id) => createWindow(id))
  else createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  term.killAll()
  stopEditors()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // Genesis is not stopped here: it is its own process and outlives the station.
  globalShortcut.unregisterAll()
  if (keybindings) keybindings.unwatch()
})

app.on('before-quit', () => {
  stopEditors()
  quitting = true
  term.killAll()
})

/* -------------------------------------------------------------- stations */

ipcMain.handle('station:info', (e) => {
  const station = stationOf(e)
  return station ? { id: station.id, count: stations.size } : null
})

ipcMain.handle('station:open', () => {
  const win = createWindow()
  return { id: stations.get(win.webContents.id).id }
})

/**
 * Turn to the next station. Two OS windows cannot share one 3D transform, so
 * the flip is played in halves: the one being left turns away, and the one
 * arriving turns in as it comes forward. Neither half is worth waiting on if
 * there is nowhere to turn to.
 */
const FLIP_MS = 170

ipcMain.handle('station:cycle', async (e, delta) => {
  const from = stationOf(e)
  const list = ordered()
  if (!from || list.length < 2) return null

  const at = list.findIndex((s) => s.id === from.id)
  const step = delta < 0 ? -1 : 1
  const to = list[(at + step + list.length) % list.length]

  const direction = step > 0 ? 'forward' : 'back'
  from.win.webContents.send('station:flip', { half: 'out', direction })
  await new Promise((resolve) => setTimeout(resolve, FLIP_MS))

  if (to.win.isDestroyed()) return null
  if (to.win.isMinimized()) to.win.restore()
  to.win.show()
  to.win.focus()
  to.win.webContents.send('station:flip', { half: 'in', direction })
  return { id: to.id }
})

/** Side by side across the screen — kept as a choice, never the default. */
ipcMain.handle('station:tile', () => {
  const list = ordered()
  if (!list.length) return null
  const area = screen.getPrimaryDisplay().workArea
  const width = Math.floor(area.width / list.length)
  list.forEach((station, i) => {
    if (station.win.isMinimized()) station.win.restore()
    station.win.setBounds({
      x: area.x + i * width,
      y: area.y,
      width: i === list.length - 1 ? area.width - i * width : width,
      height: area.height
    })
  })
  return { count: list.length }
})

/* ---------------------------------------------------------------- system */

ipcMain.handle('programs:list', () => ({
  programs: programs(),
  ptyAvailable: term.available(),
  ptyError: term.error(),
  shell: term.defaultShell(),
  platform: process.platform
}))

ipcMain.handle('sys:home', () => os.homedir())

ipcMain.handle('sys:pick-folder', async (e) => {
  const station = stationOf(e)
  if (!station) return null
  const result = await dialog.showOpenDialog(station.win, {
    properties: ['openDirectory'],
    title: 'Избери папка на проекта'
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('sys:open-path', async (_e, target) => {
  if (typeof target !== 'string' || !target) return { ok: false, error: 'empty path' }
  if (/^https?:\/\//.test(target)) {
    await shell.openExternal(target)
    return { ok: true }
  }
  const error = await shell.openPath(target)
  return error ? { ok: false, error } : { ok: true }
})

/* ------------------------------------------------------------- the files */

/**
 * Explorer, on the canvas. Directory listings only — reading a file's contents
 * is not offered, so a bug in the canvas code cannot turn into a way to read
 * the disk; opening a file hands it to Windows, exactly as double-clicking it
 * in Explorer would.
 */
ipcMain.handle('fs:list', async (_e, target) => {
  const dir = typeof target === 'string' && target ? target : os.homedir()
  try {
    const found = await fsp.readdir(dir, { withFileTypes: true })
    const entries = []
    for (const item of found) {
      // Dotfiles and system entries are noise in a file picker; the path box
      // still reaches them by name.
      if (item.name.startsWith('.')) continue
      let size = 0
      let mtime = 0
      try {
        const stat = await fsp.stat(path.join(dir, item.name))
        size = stat.size
        mtime = stat.mtimeMs
      } catch {
        // a link to nowhere, or no permission to stat it — list it anyway
      }
      entries.push({ name: item.name, dir: item.isDirectory(), size, mtime })
    }
    entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    const parent = path.dirname(dir)
    return { ok: true, path: dir, parent: parent === dir ? null : parent, entries }
  } catch (err) {
    return { ok: false, error: err.message, path: dir }
  }
})

/* --------------------------------------------------------- the editor web */

/**
 * VS Code has a web mode of its own — `code serve-web` runs the real editor
 * behind a local URL. That is the only supported way to get it *inside* this
 * window: Windows gives no way to reparent another process's window, so the
 * alternative is a frame pretending to be an editor.
 *
 * The URL it prints carries a connection token, so the server is not open to
 * anything else running on the machine. One server per program, shared by
 * every editor window on every station.
 */
const editors = new Map() // program id -> { child, url }

function serveWeb(program) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    let child
    try {
      child = spawn(program.path, ['serve-web', '--accept-server-license-terms'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      resolve({ ok: false, error: err.message })
      return
    }

    let settled = false
    let noise = ''
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const read = (chunk) => {
      const text = String(chunk)
      noise += text
      const url = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/\S*/.exec(text)
      if (url) {
        editors.set(program.id, { child, url: url[0] })
        done({ ok: true, url: url[0] })
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (err) => done({ ok: false, error: err.message }))
    child.on('exit', (code) =>
      done({ ok: false, error: `${program.title} спря (${code})\n${noise.slice(-400)}` })
    )

    // Long enough for a first run, which downloads the server component.
    const timer = setTimeout(
      () => done({ ok: false, error: `${program.title} не отговори навреме\n${noise.slice(-400)}` }),
      60000
    )
  })
}

ipcMain.handle('editor:serve', async (_e, id) => {
  const running = editors.get(id)
  if (running && !running.child.killed) return { ok: true, url: running.url }

  const program = programs().find((p) => p.id === id)
  if (!program) return { ok: false, error: `няма такава програма: ${id}` }
  if (!program.installed) return { ok: false, error: `${program.title} не е инсталирана` }
  if (process.platform !== 'win32' && !program.path) {
    return { ok: false, error: `${program.title} не е намерена` }
  }
  return serveWeb(program)
})

function stopEditors() {
  for (const { child } of editors.values()) {
    try {
      child.kill()
    } catch {
      // already gone
    }
  }
  editors.clear()
}

ipcMain.handle('program:launch', async (_e, { id, args }) => {
  const program = programs().find((p) => p.id === id)
  if (!program) return { ok: false, error: `няма такава програма: ${id}` }
  if (!program.installed) return { ok: false, error: `${program.title} не е инсталирана` }

  const { spawn } = require('child_process')
  try {
    const child = spawn(program.path, Array.isArray(args) ? args : [], {
      detached: true,
      stdio: 'ignore',
      shell: false
    })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/* ------------------------------------------------------------- terminals */

/** The environment variables each agent CLI reads its key from. */
function agentEnv(store) {
  const state = store.read()
  const env = {}
  const put = (provider, ...names) => {
    const key = store.keyFor(provider, state)
    if (key) for (const name of names) env[name] = key
  }
  put('groq', 'GROQ_API_KEY')
  put('gemini', 'GEMINI_API_KEY', 'GOOGLE_API_KEY')
  put('openrouter', 'OPENROUTER_API_KEY')
  put('xai', 'XAI_API_KEY')
  return env
}

ipcMain.handle('term:create', (e, opts) => {
  const station = stationOf(e)
  if (!station) return { ok: false, error: 'няма такава станция' }

  // Output goes back to the station that asked for it, never to whichever
  // window happens to be open.
  const send = (channel) => (id, payload) => {
    if (!station.win.isDestroyed()) station.win.webContents.send(channel, { id, ...payload })
  }

  // An agent gets the free keys from Settings in its environment, so Gemini
  // CLI, Aider or OpenCode start on the same free service the voice uses. The
  // renderer only names the program; the keys never pass through it.
  const program = opts && opts.programId ? programs().find((p) => p.id === opts.programId) : null
  const env = program && program.kind === 'agent' && settings ? agentEnv(settings) : {}
  const { programId, env: _ignored, ...rest } = opts || {}

  try {
    term.create(
      { ...rest, env, owner: station.id },
      (id, data) => send('term:data')(id, { data }),
      (id, exitCode) => send('term:exit')(id, { exitCode })
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.on('term:write', (e, { id, data }) => {
  const station = stationOf(e)
  if (station) term.write(station.id, id, data)
})

ipcMain.on('term:resize', (e, { id, cols, rows }) => {
  const station = stationOf(e)
  if (station) term.resize(station.id, id, cols, rows)
})

ipcMain.on('term:kill', (e, { id }) => {
  const station = stationOf(e)
  if (station) term.kill(station.id, id)
})

/* ----------------------------------------------------------------- voice */

ipcMain.handle('voice:transcribe', async (_e, { buffer, mimeType }) => {
  if (!settings) return { ok: false, error: 'Настройките още не са заредени.' }
  return transcribe({ audio: Buffer.from(buffer), mimeType }, settings)
})

ipcMain.handle('ai:navigate', async (_e, request) => {
  if (!settings) return { ok: false, error: 'Настройките още не са заредени.' }
  return ai.navigate(request || {}, settings)
})

ipcMain.handle('speech:say', async (_e, text) => {
  if (!settings) return { ok: false, error: 'Настройките още не са заредени.' }
  return speech.say(text, settings)
})

ipcMain.handle('providers:list', () => providerCatalog())

/** Chats in flight, so the Stop button can cut one off. */
const chats = new Map() // requestId -> AbortController

ipcMain.handle('ai:chat', async (e, request) => {
  if (!settings) return { ok: false, error: 'Настройките още не са заредени.' }
  const requestId = String((request && request.requestId) || '')
  const controller = new AbortController()
  chats.set(requestId, controller)
  const sender = e.sender
  try {
    // Genesis is the chat's brain unless Settings say otherwise; started here
    // if it is not running yet, with the same free keys the agents get.
    const chatConfig = settings.read().chat
    let own = null
    if (chatConfig.provider === 'genesis') {
      if (!sender.isDestroyed()) sender.send('ai:delta', { requestId, status: 'genesis' })
      own = await genesis.ensure({ url: chatConfig.genesisUrl, autostart: chatConfig.autostart !== false, env: agentEnv(settings) })
    }
    return await ai.chat(
      request || {},
      settings,
      (delta) => {
        if (!sender.isDestroyed()) sender.send('ai:delta', { requestId, delta })
      },
      controller.signal,
      { genesis: own }
    )
  } finally {
    chats.delete(requestId)
  }
})

ipcMain.on('ai:stop', (_e, requestId) => {
  const controller = chats.get(String(requestId))
  if (controller) controller.abort()
})

/* --------------------------------------------------------------- Genesis */

ipcMain.handle('genesis:status', async () => {
  const chatConfig = settings ? settings.read().chat : {}
  return { ...(await genesis.status(chatConfig.genesisUrl)), ref: chatConfig.genesisRef || genesis.DEFAULT_REF }
})

/**
 * The install or upgrade, for a terminal window on the canvas. The API the
 * station started is stopped first: on Windows pipx cannot replace a venv
 * whose python.exe is running.
 */
ipcMain.handle('genesis:install', () => {
  genesis.stop()
  const chatConfig = settings ? settings.read().chat : {}
  return genesis.installCommand(chatConfig.genesisRef || genesis.DEFAULT_REF)
})

ipcMain.handle('genesis:window', () => {
  try {
    return { ok: genesis.openWindow() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/* ------------------------------------------------------------- the look */

const TITLE_COLORS = {
  dark: { color: '#0b0d12', symbolColor: '#eef1f7' },
  light: { color: '#e9edf3', symbolColor: '#141821' }
}

function applyTheme(choice) {
  nativeTheme.themeSource = choice === 'light' ? 'light' : choice === 'system' ? 'system' : 'dark'
}

ipcMain.on('ui:theme', (e, mode) => {
  const colors = TITLE_COLORS[mode === 'light' ? 'light' : 'dark']
  const station = stationOf(e)
  if (settings) applyTheme(settings.read().look.theme)
  for (const { win } of stations.values()) {
    if (win.isDestroyed()) continue
    try {
      win.setBackgroundColor(colors.color)
      // Only Windows (and a hidden title bar) draws an overlay to recolour.
      if (process.platform === 'win32') win.setTitleBarOverlay({ ...colors, height: 38 })
    } catch {
      // no overlay on this platform
    }
    // The other stations follow the one where it was changed.
    if (station && win !== station.win && settings) win.webContents.send('ui:theme', settings.read().look.theme)
  }
})

/* -------------------------------------------------------- the keys file */

ipcMain.handle('keys:load', () => (keybindings ? keybindings.load() : { keys: {}, problems: [] }))

ipcMain.handle('keys:open', async (_e, defaults) => {
  if (!keybindings) return { ok: false, error: 'още не е готово' }
  const file = keybindings.ensure(defaults)
  const error = await shell.openPath(file)
  return error ? { ok: false, error, file } : { ok: true, file }
})

/**
 * Keys that work from anywhere in Windows, with the station in the background
 * or minimised: bring it forward, or bring it forward and start listening.
 */
function registerGlobal() {
  globalShortcut.unregisterAll()
  if (!keybindings) return
  const wanted = keybindings.global()
  const failed = []
  for (const [what, accelerator] of Object.entries(wanted)) {
    if (!accelerator) continue
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => globalKey(what))
    } catch {
      ok = false
    }
    // Taken by another program, or not a key Electron understands.
    if (!ok) failed.push(`${accelerator}`)
  }
  keybindings.setGlobalProblems(failed)
}

function globalKey(what) {
  const win = lastFocused && !lastFocused.isDestroyed() ? lastFocused : (ordered()[0] || {}).win
  if (!win) {
    createWindow()
    return
  }
  // The same key hides it again, when it is already the window in front.
  if (what === 'show' && win.isFocused() && win.isVisible() && !win.isMinimized()) {
    win.minimize()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (what !== 'show') win.webContents.send('ui:global', what)
}

ipcMain.handle('settings:get', () => (settings ? settings.safe() : null))

ipcMain.handle('settings:set', (_e, patch) => {
  if (!settings) return null
  settings.write(patch || {})
  if (patch && patch.look) applyTheme(settings.read().look.theme)
  return settings.safe()
})

/* ----------------------------------------------------------------- state */

ipcMain.handle('state:load', (e) => {
  const station = stationOf(e)
  return station ? store.loadStation(station.id) : null
})

ipcMain.handle('state:save', (e, state) => {
  const station = stationOf(e)
  return station ? store.saveStation(station.id, state) : false
})
