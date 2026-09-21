'use strict'

const path = require('path')
const os = require('os')
const fsp = require('fs/promises')
const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron')

const term = require('./pty')
const { detect } = require('./programs')
const { createStore } = require('./store')
const { createSettings } = require('./settings')
const { transcribe } = require('./stt')

let store = null
let settings = null
let programCache = null
let quitting = false

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
  store = createStore(app.getPath('userData'))
  settings = createSettings(app.getPath('userData'))

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

ipcMain.handle('term:create', (e, opts) => {
  const station = stationOf(e)
  if (!station) return { ok: false, error: 'няма такава станция' }

  // Output goes back to the station that asked for it, never to whichever
  // window happens to be open.
  const send = (channel) => (id, payload) => {
    if (!station.win.isDestroyed()) station.win.webContents.send(channel, { id, ...payload })
  }

  try {
    term.create(
      { ...opts, owner: station.id },
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

ipcMain.handle('settings:get', () => (settings ? settings.safe() : null))

ipcMain.handle('settings:set', (_e, patch) => {
  if (!settings) return null
  settings.write(patch || {})
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
