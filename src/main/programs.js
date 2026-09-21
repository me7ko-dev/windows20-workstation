'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

/**
 * What's actually installed on this machine.
 *
 * Two kinds of program live side by side here, and the difference matters:
 *
 *  - `kind: 'agent'` / `'shell'` — a CLI we run *inside* a canvas window
 *    through ConPTY, so the window really is the running program.
 *  - `kind: 'external'` — a GUI app (VS Code, Cursor, Explorer). Windows has
 *    no supported way to reparent another process's window into ours, so
 *    these launch as their own top-level windows. Pretending otherwise would
 *    just produce an empty frame.
 */

const HOME = os.homedir()
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
const PROGRAMS = process.env.ProgramFiles || 'C:\\Program Files'
const PROGRAMS_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

const CATALOG = [
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
    kind: 'external',
    command: 'code.cmd',
    accent: '#2f9fe8',
    candidates: [
      path.join(LOCAL, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(PROGRAMS, 'Microsoft VS Code', 'Code.exe')
    ],
    description: 'Отваря се като собствен прозорец на Windows.'
  },
  {
    id: 'cursor',
    title: 'Cursor',
    icon: '▲',
    kind: 'external',
    command: 'cursor.cmd',
    accent: '#eef1f7',
    candidates: [
      path.join(LOCAL, 'Programs', 'cursor', 'Cursor.exe'),
      path.join(PROGRAMS, 'Cursor', 'Cursor.exe')
    ],
    description: 'Отваря се като собствен прозорец на Windows.'
  },
  {
    id: 'windows-terminal',
    title: 'Windows Terminal',
    icon: '▭',
    kind: 'external',
    command: 'wt.exe',
    accent: '#4cc2ff',
    description: 'Системният терминал.'
  },
  {
    id: 'explorer',
    title: 'Explorer',
    icon: '🗂',
    kind: 'external',
    command: 'explorer.exe',
    accent: '#ffd166',
    description: 'Файловият мениджър на Windows.'
  },
  {
    id: 'chrome',
    title: 'Chrome',
    icon: '◎',
    kind: 'external',
    command: 'chrome.exe',
    accent: '#4caf50',
    candidates: [
      path.join(PROGRAMS, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAMS_X86, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ],
    description: 'Истинският Chrome, като отделен прозорец.'
  }
]

function onPath(command) {
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which'
    const out = execFileSync(finder, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = out.split(/\r?\n/).find((line) => line.trim())
    return first ? first.trim() : null
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

/** The catalog, each entry marked with whether it's actually on this machine. */
function detect() {
  return CATALOG.map((program) => {
    const resolved = resolve(program)
    const { candidates, ...rest } = program
    return { ...rest, path: resolved, installed: Boolean(resolved) }
  })
}

module.exports = { detect, CATALOG }
