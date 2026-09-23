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
 * Genesis is an autonomous agent, not a part of the station: it runs as its
 * own process. The station starts it when it starts (and again when the chat
 * finds it gone), detached, so closing the station does not stop it — the
 * next station just finds it answering. It is bound to 127.0.0.1, not to the
 * 0.0.0.0 its own `python -m genesis_agent.product_api` picks, because that
 * API has no auth and the local network has no business in it.
 *
 * Installed and upgraded from the branch that carries the Windows installer
 * and /update (claude/token-upgrade-ipe4yg), with the repo's own
 * scripts/install_windows.ps1 — plus fastapi and uvicorn, which the API
 * needs and the package does not pull in.
 */

const HOME = os.homedir()
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
const DEFAULT_URL = 'http://127.0.0.1:8100'

const DEFAULT_REF = 'claude/token-upgrade-ipe4yg'
const REPO = 'https://github.com/me7ko-dev/genesis-agent'
const STATE_DIR = path.join(HOME, '.genesis')
const PID_FILE = path.join(STATE_DIR, 'station-api.pid')
const LOG_FILE = path.join(STATE_DIR, 'station-api.log')

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
          'Genesis не е инсталиран. „Инсталирай / обнови Genesis“ (в лентата или в Настройки) го слага от клона с ъпгрейда — ' +
          'или пусни API-то му сам на порт 8100.'
      }
    }
    const port = (/:(\d+)/.exec(root(url).replace(/^\w+:\/\//, '')) || [])[1] || '8100'
    const { spawn } = require('child_process')
    let child
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true })
      const log = fs.openSync(LOG_FILE, 'w')
      // Its own process: detached, its output to a file rather than to us,
      // so it outlives the station that started it.
      child = spawn(python, ['-m', 'uvicorn', 'genesis_agent.product_api:app', '--host', '127.0.0.1', '--port', port], {
        detached: true,
        stdio: ['ignore', log, log],
        windowsHide: true,
        env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8' }
      })
      fs.closeSync(log)
    } catch (err) {
      return { ok: false, error: `Genesis не тръгна: ${err.message}` }
    }
    let exited = null
    child.on('exit', (code) => {
      exited = code
    })
    child.on('error', (err) => {
      exited = err.message
    })
    if (child.pid) {
      try {
        fs.writeFileSync(PID_FILE, String(child.pid))
      } catch {
        // only needed to stop it before an upgrade
      }
    }
    if (child.unref) child.unref()

    // Its first start imports the whole Brain; give it time.
    for (let i = 0; i < 60; i += 1) {
      if (exited !== null) break
      if (await healthy(url, 1000)) return { ok: true, started: true }
      await new Promise((r) => setTimeout(r, 500))
    }
    let output = ''
    try {
      output = fs.readFileSync(LOG_FILE, 'utf8').slice(-800)
    } catch {
      output = ''
    }
    lastError = /No module named '?(fastapi|uvicorn)/.test(output)
      ? 'На Genesis му липсват fastapi и uvicorn — „Инсталирай / обнови Genesis“ ги слага.'
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

/**
 * Stop the Genesis API this station started — by the pid it wrote, since the
 * station that started it may be long gone. Needed before an upgrade: on
 * Windows a running python.exe in the venv cannot be replaced.
 */
function stop() {
  let pid = 0
  try {
    pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  } catch {
    return false
  }
  try {
    fs.rmSync(PID_FILE, { force: true })
  } catch {
    // gone already
  }
  if (!pid) return false
  try {
    process.kill(pid)
    return true
  } catch {
    return false
  }
}

const SAFE_REF = /^[\w.\/-]{1,100}$/

/**
 * The install or upgrade, as a program for a terminal window — so the user
 * watches it happen and sees any error pip or pipx prints.
 */
function installCommand(ref = DEFAULT_REF, platform = process.platform) {
  const branch = SAFE_REF.test(ref || '') ? ref : DEFAULT_REF
  const spec = `git+${REPO}@${branch}`
  if (platform === 'win32') {
    const raw = `https://raw.githubusercontent.com/me7ko-dev/genesis-agent/${branch}/scripts/install_windows.ps1`
    const script = [
      'chcp 65001 > $null',
      "$ErrorActionPreference = 'Continue'",
      `Write-Host 'Genesis - install / upgrade from ${branch}' -ForegroundColor Cyan`,
      "$tmp = Join-Path $env:TEMP 'genesis_install_windows.ps1'",
      `curl.exe -sSL -o $tmp '${raw}'`,
      // The branch's own installer: it finds a real Python, pipx, Git Bash.
      "if ((Test-Path $tmp) -and (Select-String -Path $tmp -Pattern 'pipx' -Quiet)) {",
      `  powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Ref '${branch}'`,
      '} else {',
      "  Write-Host 'No install_windows.ps1 on this branch - installing with pipx directly.'",
      '  py -m pip install --user --upgrade pipx',
      '  py -m pipx ensurepath',
      `  py -m pipx install --force '${spec}'`,
      '}',
      "Write-Host 'Adding the API server (fastapi, uvicorn)...' -ForegroundColor Cyan",
      "if (Get-Command py -ErrorAction SilentlyContinue) { py -m pipx inject genesis-agent fastapi uvicorn } else { python -m pipx inject genesis-agent fastapi uvicorn }",
      "Write-Host ''",
      "Write-Host 'Done. Genesis runs on its own now; the station chat (Ctrl+Shift+I) talks to it.' -ForegroundColor Green",
      "Write-Host 'First time: run  genesis setup  (in a new terminal) for its API keys.'"
    ].join('\n')
    return { shell: 'powershell.exe', args: ['-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', script], ref: branch }
  }
  const script = [
    `echo "Genesis - install / upgrade from ${branch}"`,
    `pipx install --force '${spec}'`,
    'pipx inject genesis-agent fastapi uvicorn',
    'echo "Done. First time: genesis setup"',
    'exec "${SHELL:-bash}"'
  ].join(' && ')
  return { shell: 'bash', args: ['-lc', script], ref: branch }
}

/** Genesis's own terminal chat, in its own Windows window — apart from the station. */
function openWindow() {
  const { spawn } = require('child_process')
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', 'start "Genesis" genesis'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          windowsVerbatimArguments: true
        })
      : spawn('x-terminal-emulator', ['-e', 'genesis'], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  if (child.unref) child.unref()
  return true
}

async function status(url) {
  return { running: await healthy(url), python: Boolean(findPython()), url: root(url) }
}

module.exports = { ensure, stop, healthy, findPython, installCommand, openWindow, status, DEFAULT_URL, DEFAULT_REF, root }
