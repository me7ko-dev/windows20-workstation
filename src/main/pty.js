'use strict'

const os = require('os')

/**
 * Real terminals, not transcripts. On Windows this goes through ConPTY, which
 * is what lets a full-screen TUI (Claude Code, vim, anything that repaints)
 * behave the same way it does in Windows Terminal. `node-pty` is a native
 * module, so a missing build is a normal state we report rather than crash on.
 */
let pty = null
let ptyError = null
try {
  pty = require('node-pty')
} catch (err) {
  ptyError = err.message
}

const sessions = new Map()

function defaultShell() {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/bash'
  // PowerShell 7 if it's installed, otherwise the one that always is.
  return process.env.W20_SHELL || 'powershell.exe'
}

function create({ id, cwd, shell, args = [], cols = 80, rows = 24 }, onData, onExit) {
  if (!pty) throw new Error(`node-pty is not built: ${ptyError}`)
  if (sessions.has(id)) return sessions.get(id)

  const proc = pty.spawn(shell || defaultShell(), args, {
    name: 'xterm-color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' },
    useConpty: process.platform === 'win32'
  })

  proc.onData((data) => onData(id, data))
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    onExit(id, exitCode)
  })

  sessions.set(id, proc)
  return proc
}

function write(id, data) {
  const proc = sessions.get(id)
  if (proc) proc.write(data)
}

function resize(id, cols, rows) {
  const proc = sessions.get(id)
  if (!proc) return
  try {
    proc.resize(Math.max(cols, 2), Math.max(rows, 2))
  } catch {
    // the process exited between the resize and this call — nothing to do
  }
}

function kill(id) {
  const proc = sessions.get(id)
  if (!proc) return
  try {
    proc.kill()
  } catch {
    // already gone
  }
  sessions.delete(id)
}

function killAll() {
  for (const id of Array.from(sessions.keys())) kill(id)
}

module.exports = { create, write, resize, kill, killAll, defaultShell, available: () => Boolean(pty), error: () => ptyError }
