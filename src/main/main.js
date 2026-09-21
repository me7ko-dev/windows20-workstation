'use strict'

const path = require('path')
const os = require('os')
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')

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
      spellcheck: false
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
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
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
