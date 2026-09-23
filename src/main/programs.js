'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

/**
 * What's actually installed on this machine.
 *
 * Every entry here opens *inside* the station. Windows still gives no way to
 * reparent another process's window into ours, so where a GUI app cannot be
 * embedded the station runs the same thing its own way:
 *
 *  - `kind: 'agent'` / `'shell'` — a CLI in a canvas window through ConPTY.
 *    The window really is the running program.
 *  - `kind: 'editor'` — VS Code and its relatives, through `serve-web`: their
 *    own web mode, in a canvas window. The real editor, not a mock-up.
 *  - `kind: 'web'` — a browser window on the canvas. Same engine as Chrome,
 *    because it is Chromium.
 *  - `kind: 'files'` — the file browser on the canvas, with the one thing
 *    Explorer cannot do: a terminal opened where you are looking.
 *  - `kind: 'external'` — what is genuinely left: a launch card, honest about
 *    opening its own window.
 */

const HOME = os.homedir()
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
const PROGRAMS = process.env.ProgramFiles || 'C:\\Program Files'
const PROGRAMS_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

const CATALOG = [
  {
    id: 'genesis',
    title: 'Genesis',
    icon: '✺',
    kind: 'agent',
    command: 'genesis',
    accent: '#c4b5fd',
    candidates: [
      path.join(HOME, '.local', 'bin', 'genesis.exe'),
      path.join(LOCAL, 'pipx', 'pipx', 'venvs', 'genesis-agent', 'Scripts', 'genesis.exe'),
      path.join(HOME, '.venvs', 'genesis', 'Scripts', 'genesis.exe'),
      path.join(HOME, 'pipx', 'venvs', 'genesis-agent', 'Scripts', 'genesis.exe')
    ],
    description: 'Genesis — твоят агент: терминал, умения, памет между сесиите. Той е и мозъкът на ИИ чата.'
  },
  {
    id: 'claude',
    title: 'Claude Code',
    icon: '✦',
    kind: 'agent',
    command: 'claude',
    accent: '#d97757',
    description: 'Claude Code в истински терминал на платното.'
  },
  {
    id: 'codex',
    title: 'Codex',
    icon: '◈',
    kind: 'agent',
    command: 'codex',
    accent: '#9aa2b1',
    description: 'OpenAI Codex CLI.'
  },
  {
    id: 'gemini',
    title: 'Gemini',
    icon: '✧',
    kind: 'agent',
    command: 'gemini',
    accent: '#5ea8ff',
    description: 'Gemini CLI.'
  },
  {
    id: 'aider',
    title: 'Aider',
    icon: '⌬',
    kind: 'agent',
    command: 'aider',
    accent: '#14b8a6',
    description: 'Aider — агент за код; тръгва с безплатния ключ от Настройки (Groq, Gemini, OpenRouter).'
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    icon: '◰',
    kind: 'agent',
    command: 'opencode',
    accent: '#f97316',
    description: 'OpenCode — агент за код с безплатни модели.'
  },
  {
    id: 'qwen',
    title: 'Qwen Code',
    icon: '◇',
    kind: 'agent',
    command: 'qwen',
    accent: '#8b5cf6',
    description: 'Qwen Code CLI.'
  },
  {
    id: 'ollama',
    title: 'Ollama',
    icon: 'λ',
    kind: 'agent',
    command: 'ollama',
    args: ['run', 'qwen2.5:7b'],
    accent: '#e5e7eb',
    description: 'Модел на този компютър — без ключ и без интернет.'
  },
  {
    id: 'powershell',
    title: 'PowerShell',
    icon: '›',
    kind: 'shell',
    command: 'powershell.exe',
    accent: '#5ee0ff',
    description: 'Обикновен терминал.'
  },
  {
    id: 'pwsh',
    title: 'PowerShell 7',
    icon: '»',
    kind: 'shell',
    command: 'pwsh.exe',
    accent: '#5ee0ff',
    description: 'PowerShell 7, ако е инсталиран.'
  },
  {
    id: 'cmd',
    title: 'Command Prompt',
    icon: 'C:\\',
    kind: 'shell',
    command: 'cmd.exe',
    accent: '#9aa2b1',
    description: 'Класическият cmd.'
  },
  {
    id: 'git-bash',
    title: 'Git Bash',
    icon: '⑂',
    kind: 'shell',
    command: 'bash.exe',
    accent: '#f0803c',
    candidates: [path.join(PROGRAMS, 'Git', 'bin', 'bash.exe')],
    description: 'Bash от Git for Windows.'
  },
  {
    id: 'vscode',
    title: 'VS Code',
    icon: '⧉',
    kind: 'editor',
    command: 'code.cmd',
    accent: '#2f9fe8',
    candidates: [
      path.join(LOCAL, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(PROGRAMS, 'Microsoft VS Code', 'bin', 'code.cmd')
    ],
    description: 'Истинският редактор, в прозорец на платното (code serve-web).'
  },
  {
    id: 'cursor',
    title: 'Cursor',
    icon: '▲',
    kind: 'editor',
    command: 'cursor.cmd',
    accent: '#eef1f7',
    candidates: [
      path.join(LOCAL, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(PROGRAMS, 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd')
    ],
    description: 'Като VS Code — ако изданието му носи serve-web.'
  },
  {
    id: 'windows-terminal',
    title: 'Windows Terminal',
    icon: '▭',
    kind: 'shell',
    command: 'wt.exe',
    useDefaultShell: true,
    accent: '#4cc2ff',
    description: 'Отваря обикновен терминал тук — станцията вече е терминален дом.'
  },
  {
    id: 'files',
    title: 'Файлове',
    icon: '🗂',
    kind: 'files',
    native: 'Explorer',
    command: 'explorer.exe',
    accent: '#ffd166',
    description: 'Файловете, на платното — с терминал в папката, която гледаш.'
  },
  {
    id: 'browser',
    title: 'Браузър',
    icon: '◎',
    kind: 'web',
    native: 'Chrome',
    command: 'chrome.exe',
    accent: '#4caf50',
    candidates: [
      path.join(PROGRAMS, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAMS_X86, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ],
    description: 'Браузър в прозорец на платното — същият Chromium.'
  }
]

function onPath(command) {
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which'
    const out = execFileSync(finder, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const found = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (process.platform !== 'win32') return found[0] || null
    // `where` lists npm's extensionless sh shim first (…\npm\claude), which
    // Windows cannot start. Only what CreateProcess runs counts, .exe first.
    const rank = (file) => ['.exe', '.cmd', '.bat', '.com'].indexOf(path.extname(file).toLowerCase())
    const runnable = found.filter((file) => rank(file) >= 0).sort((a, b) => rank(a) - rank(b))
    return runnable[0] || null
  } catch {
    return null
  }
}

function resolve(program) {
  for (const candidate of program.candidates || []) {
    if (fs.existsSync(candidate)) return candidate
  }
  return onPath(program.command)
}

/**
 * The catalog, each entry marked with whether it's actually on this machine.
 *
 * The browser and the file window are ours — they are always available, and
 * their `path` says only whether the Windows program they stand in for is also
 * here, for the command that opens the native one.
 */
function detect() {
  return CATALOG.map((program) => {
    const resolved = resolve(program)
    const { candidates, ...rest } = program
    const ours = program.kind === 'web' || program.kind === 'files'
    return {
      ...rest,
      path: resolved,
      installed: ours ? true : Boolean(resolved),
      nativeInstalled: Boolean(resolved)
    }
  })
}

module.exports = { detect, CATALOG }
