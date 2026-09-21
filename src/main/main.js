'use strict'

const path = require('path')
const os = require('os')
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')

const term = require('./pty')
const { detect } = require('./programs')
const { createStore } = require('./store')

let mainWindow = null
let store = null
let programCache = null

function programs() {
  if (!programCache) programCache = detect()
  return programCache
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Windows 20 Workstation',
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

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  // A canvas window opening a link must never navigate the shell itself away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  term.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => term.killAll())

/* ---------------------------------------------------------------- system */

ipcMain.handle('programs:list', () => ({
  programs: programs(),
  ptyAvailable: term.available(),
  ptyError: term.error(),
  shell: term.defaultShell(),
  platform: process.platform
}))

ipcMain.handle('sys:home', () => os.homedir())

ipcMain.handle('sys:pick-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
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

ipcMain.handle('term:create', (_e, opts) => {
  try {
    term.create(
      opts,
      (id, data) => mainWindow && mainWindow.webContents.send('term:data', { id, data }),
      (id, exitCode) => mainWindow && mainWindow.webContents.send('term:exit', { id, exitCode })
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.on('term:write', (_e, { id, data }) => term.write(id, data))
ipcMain.on('term:resize', (_e, { id, cols, rows }) => term.resize(id, cols, rows))
ipcMain.on('term:kill', (_e, { id }) => term.kill(id))

/* ----------------------------------------------------------------- state */

ipcMain.handle('state:load', () => (store ? store.read() : null))
ipcMain.handle('state:save', (_e, state) => (store ? store.write(state) : false))
