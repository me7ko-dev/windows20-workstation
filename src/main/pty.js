'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

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

/**
 * Keyed by owner *and* id: two station windows number their terminals
 * independently, so the renderer's id alone is not unique across the app.
 */
const sessions = new Map()
const keyFor = (owner, id) => `${owner}\u0000${id}`

function defaultShell() {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/bash'
  // PowerShell 7 if it's installed, otherwise the one that always is.
  return process.env.W20_SHELL || 'powershell.exe'
}

/**
 * CreateProcess (what ConPTY spawns through) only runs actual Win32
 * executables. A `.cmd`/`.bat` shim — which is what `npm install -g`
 * produces for `claude`, `codex`, `gemini`, etc. — is a batch script, not a
 * PE binary, so spawning one directly fails with "not a valid Win32
 * application" (error 193). Hand those to cmd.exe instead, the same way
 * Node's own `child_process.spawn` does behind the scenes on Windows.
 */
function resolveSpawn(file, args) {
  // A window saved before the fix may still hold the extensionless sh shim;
  // its `.cmd` twin sits beside it.
  if (process.platform === 'win32' && !path.extname(file) && fs.existsSync(`${file}.cmd`)) {
    file = `${file}.cmd`
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', file, ...args] }
  }
  return { file, args }
}

function create({ owner, id, cwd, shell, args = [], cols = 80, rows = 24, env = {} }, onData, onExit) {
  if (!pty) throw new Error(`node-pty is not built: ${ptyError}`)
  const key = keyFor(owner, id)
  if (sessions.has(key)) return sessions.get(key)

  const { file, args: spawnArgs } = resolveSpawn(shell || defaultShell(), args)
  const proc = pty.spawn(file, spawnArgs, {
    name: 'xterm-color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: { ...process.env, ...env, TERM: 'xterm-256color' },
    useConpty: process.platform === 'win32'
  })

  proc.onData((data) => onData(id, data))
  proc.onExit(({ exitCode }) => {
    sessions.delete(key)
    onExit(id, exitCode)
  })

  sessions.set(key, proc)
  return proc
}

function write(owner, id, data) {
  const proc = sessions.get(keyFor(owner, id))
  if (proc) proc.write(data)
}

function resize(owner, id, cols, rows) {
  const proc = sessions.get(keyFor(owner, id))
  if (!proc) return
  try {
    proc.resize(Math.max(cols, 2), Math.max(rows, 2))
  } catch {
    // the process exited between the resize and this call — nothing to do
  }
}

function killKey(key) {
  const proc = sessions.get(key)
  if (!proc) return
  try {
    proc.kill()
  } catch {
    // already gone
  }
  sessions.delete(key)
}

function kill(owner, id) {
  killKey(keyFor(owner, id))
}

/** A station window closed: everything running in it goes with it. */
function killOwner(owner) {
  const prefix = `${owner}\u0000`
  for (const key of Array.from(sessions.keys())) {
    if (key.startsWith(prefix)) killKey(key)
  }
}

function killAll() {
  for (const key of Array.from(sessions.keys())) killKey(key)
}

module.exports = {
  create,
  write,
  resize,
  kill,
  killOwner,
  killAll,
  defaultShell,
  available: () => Boolean(pty),
  error: () => ptyError
}
