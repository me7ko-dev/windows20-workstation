'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * Genesis — the user's own agent (github.com/me7ko-dev/genesis-agent) — as the
 * brain of the chat window.
 *
 * Genesis serves an OpenAI-compatible /v1/chat/completions of its own
 * (genesis_agent/product_api.py) with its Brain behind it: its routing, its
 * providers, its keys in ~/.genesis/.env. The station only talks to it.
 *
 * If it is not running, the station starts it — bound to 127.0.0.1, not to
 * the 0.0.0.0 its own `python -m genesis_agent.product_api` picks, because
 * that API has no auth and the local network has no business in it.
 */

const HOME = os.homedir()
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
const DEFAULT_URL = 'http://127.0.0.1:8100'

let child = null
let starting = null
let lastError = ''

function root(url) {
  return String(url || DEFAULT_URL)
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
}

async function healthy(url, timeoutMs = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${root(url)}/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** The Python that has genesis_agent installed: its venv, wherever pipx put it. */
function findPython() {
  const win = process.platform === 'win32'
  const py = win ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
  const candidates = [
    process.env.GENESIS_PYTHON,
    path.join(HOME, 'pipx', 'venvs', 'genesis-agent', py),
    path.join(LOCAL, 'pipx', 'pipx', 'venvs', 'genesis-agent', py),
    path.join(HOME, '.local', 'pipx', 'venvs', 'genesis-agent', py),
    path.join(HOME, '.local', 'share', 'pipx', 'venvs', 'genesis-agent', py),
    path.join(HOME, '.venvs', 'genesis', py)
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p)) || null
}

/**
 * Genesis answering at `url`, started first if it has to be.
 * Resolves { ok, started, error }.
 */
async function ensure({ url = DEFAULT_URL, autostart = true, env = {} } = {}) {
  if (await healthy(url)) return { ok: true }
  if (!autostart) return { ok: false, error: 'Genesis не е пуснат (самостоятелното пускане е изключено в Настройки).' }
  if (starting) return starting

  starting = (async () => {
    const python = findPython()
    if (!python) {
      return {
        ok: false,
        error:
          'Genesis не е намерен. Инсталирай го: pipx install git+https://github.com/me7ko-dev/genesis-agent ' +
          'и pipx inject genesis-agent fastapi uvicorn — или пусни API-то му сам на порт 8100.'
      }
    }
    const port = (/:(\d+)/.exec(root(url).replace(/^\w+:\/\//, '')) || [])[1] || '8100'
    const { spawn } = require('child_process')
    let output = ''
    try {
      child = spawn(python, ['-m', 'uvicorn', 'genesis_agent.product_api:app', '--host', '127.0.0.1', '--port', port], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8' }
      })
    } catch (err) {
      return { ok: false, error: `Genesis не тръгна: ${err.message}` }
    }
    const keep = (chunk) => {
      output = (output + String(chunk)).slice(-800)
    }
    if (child.stdout) child.stdout.on('data', keep)
    if (child.stderr) child.stderr.on('data', keep)
    let exited = null
    child.on('exit', (code) => {
      exited = code
      child = null
    })
    child.on('error', (err) => {
      exited = err.message
      child = null
    })

    // Its first start imports the whole Brain; give it time.
    for (let i = 0; i < 60; i += 1) {
      if (exited !== null) break
      if (await healthy(url, 1000)) return { ok: true, started: true }
      await new Promise((r) => setTimeout(r, 500))
    }
    lastError = /No module named '?(fastapi|uvicorn)/.test(output)
      ? 'На Genesis му липсват fastapi и uvicorn: pipx inject genesis-agent fastapi uvicorn'
      : `Genesis не отговори${exited !== null ? ` (спря: ${exited})` : ''}. ${output.trim().split('\n').slice(-3).join(' ')}`
    stop()
    return { ok: false, error: lastError.trim() }
  })()

  try {
    return await starting
  } finally {
    starting = null
  }
}

/** Only the Genesis this station started — never one the user runs. */
function stop() {
  if (!child) return
  try {
    child.kill()
  } catch {
    // already gone
  }
  child = null
}

module.exports = { ensure, stop, healthy, findPython, DEFAULT_URL, root }
