'use strict'

/**
 * Screenshots of the real app, for the README and for looking at a change.
 *
 *   npm run shots        (writes docs/screenshots/*.jpg)
 *
 * Same edges as the click check: no real processes start. The terminals get
 * a stand-in that prints what an agent or a shell would, so the pictures show
 * the station the way it looks in use.
 */

const Module = require('module')
const http = require('http')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const PAGE_PORT = 8137
const page = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Документация</title></head>
  <body style="margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#f6f7fb;color:#1c2030">
  <div style="padding:26px 34px"><h1 style="margin:0 0 6px;font-size:26px">Windows 20 Workstation</h1>
  <p style="color:#5b6275;margin:0 0 18px">Четири полета, по четири прозореца. Всичко остро, нищо не се мащабира.</p>
  ${['Станции и полета', 'Клавиши и водещ клавиш', 'Глас и ИИ безплатно', 'Картини в 4K']
    .map((t, i) => `<div style="background:#fff;border-radius:12px;padding:14px 18px;margin:10px 0;box-shadow:0 2px 8px rgba(0,0,0,.06)"><b>${i + 1}. ${t}</b><div style="height:8px;background:#e8ebf3;border-radius:4px;margin-top:10px;width:${90 - i * 12}%"></div></div>`)
    .join('')}
  </div></body></html>`)
})

// A chat service on localhost that answers the way a model does — in pieces.
const AI_PORT = 8140
const ANSWER = [
  'Порт 3000 държи процесът с този PID. Виж кой е и го спри:\n\n',
  '```powershell\nGet-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess\n',
  'Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess\n```\n\n',
  'Ако е `node` от друг проект — по-добре го спри от неговия терминал с `Ctrl+C`.'
]
const ai = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    for (const piece of ANSWER) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
})

/* ------------------------------------------------ what the terminals say */

const E = '\x1b['
const CLAUDE = [
  `${E}38;5;209m╭───────────────────────────────────────────────╮${E}0m`,
  `${E}38;5;209m│${E}0m ${E}1m✻ Welcome to Claude Code!${E}0m                     ${E}38;5;209m│${E}0m`,
  `${E}38;5;209m│${E}0m   ${E}2mcwd: C:\\Users\\me7ko\\windows20-workstation${E}0m  ${E}38;5;209m│${E}0m`,
  `${E}38;5;209m╰───────────────────────────────────────────────╯${E}0m`,
  '',
  `${E}1m> ${E}0mнаправи полетата 4 × 4 и изчисти резолюцията`,
  '',
  `${E}38;5;114m●${E}0m Read ${E}1msrc/renderer/canvas.js${E}0m ${E}2m(372 lines)${E}0m`,
  `${E}38;5;114m●${E}0m Update ${E}1msrc/renderer/fields.js${E}0m`,
  `  ${E}38;5;71m+ export const CAPACITY = FIELDS * SLOTS${E}0m`,
  `  ${E}38;5;71m+ export function layout(ws, area) {${E}0m`,
  `  ${E}38;5;167m- plane.style.transform = \`translate3d(…)\`${E}0m`,
  `${E}38;5;114m●${E}0m Bash ${E}1mnpm run check${E}0m`,
  `  ${E}2m⎿ 0 грешки · 52 команди · 150 натискания${E}0m`,
  '',
  `${E}38;5;209m✻${E}0m ${E}3mThinking… (esc to interrupt)${E}0m`
]
const SHELL = [
  `${E}38;5;39mPS C:\\work\\station>${E}0m git log --oneline -6`,
  `${E}33m8cc151b${E}0m Hear, think and answer in Bulgarian`,
  `${E}33m614e487${E}0m Plan: a calmer look, everything from the keyboard`,
  `${E}33me46ddf0${E}0m Press every button in the app`,
  `${E}33mb3a01bf${E}0m Run the dock's programs inside the station`,
  `${E}33mc85eb5c${E}0m Expand the selected window`,
  `${E}33m9fadd6c${E}0m Find your work again: a canvas map`,
  `${E}38;5;39mPS C:\\work\\station>${E}0m npm run check`,
  `${E}32m  ok${E}0m  всички станции`,
  `${E}32m  ok${E}0m  полета 4 × 4`,
  `${E}32m  ok${E}0m  картини в 4K`,
  `${E}1mГРЕШКИ: няма${E}0m`,
  `${E}38;5;39mPS C:\\work\\station>${E}0m `
]
const TOP = [
  `${E}1m  PID  ИМЕ              CPU   ПАМЕТ${E}0m`,
  ...['node', 'claude', 'electron', 'ollama', 'pwsh', 'git']
    .map((n, i) => `${String(4120 + i * 37).padStart(5)}  ${n.padEnd(16)} ${E}3${(i % 6) + 1}m${(12.4 - i * 1.7).toFixed(1).padStart(4)}%${E}0m  ${(820 - i * 110).toString().padStart(4)} MB`),
  '',
  `${E}32m████████████████████${E}0m${E}2m░░░░░░░░░░${E}0m  CPU 38%`,
  `${E}36m██████████████${E}0m${E}2m░░░░░░░░░░░░░░░░${E}0m  RAM 46%`
]

const ptyStub = {
  spawn(shell, args, opts) {
    const handlers = { data: [], exit: [] }
    const proc = {
      onData: (fn) => handlers.data.push(fn),
      onExit: (fn) => handlers.exit.push(fn),
      write() {},
      resize() {},
      kill() {
        for (const fn of handlers.exit) fn({ exitCode: 0 })
      }
    }
    const who = String(shell || '')
    const lines = /claude/i.test(who) ? CLAUDE : /top|htop/i.test(who) ? TOP : SHELL
    setTimeout(() => {
      for (const fn of handlers.data) fn(lines.join('\r\n'))
    }, 60)
    return proc
  }
}
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'node-pty') return 'node-pty-stub'
  return originalResolve.call(this, request, ...rest)
}
require.cache['node-pty-stub'] = { id: 'node-pty-stub', filename: 'node-pty-stub', loaded: true, exports: ptyStub }

// Every program "installed", so the dock looks the way it does on a real machine.
const programs = require('../src/main/programs')
const realDetect = programs.detect
programs.detect = () => realDetect().map((p) => ({ ...p, installed: true, path: p.path || `C:\\bin\\${p.command}` }))

const electron = require('electron')
const { app, BrowserWindow } = electron
app.setPath('userData', '/tmp/w20-shots-data')
fs.rmSync('/tmp/w20-shots-data', { recursive: true, force: true })
require('../src/main/main.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await new Promise((r) => page.listen(PAGE_PORT, '127.0.0.1', r))
  await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r))
  await app.whenReady()
  await sleep(2500)
  const win = BrowserWindow.getAllWindows()[0]
  win.setSize(1600, 1000)
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !message.includes('Security Warning')) errors.push(message)
  })
  const run = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true)
  const key = (code, o = {}) =>
    run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '', code: ${JSON.stringify(code)},
      ctrlKey: ${!!o.ctrl}, shiftKey: ${!!o.shift}, altKey: ${!!o.alt}, bubbles: true, cancelable: true })); return true`)

  async function waitPicture() {
    for (let i = 0; i < 80; i += 1) {
      const sharp = await run(`return getComputedStyle(document.body).getPropertyValue('--wallpaper').includes('blob:')`)
      if (sharp) break
      await sleep(250)
    }
    await sleep(2500)
  }

  async function shot(name) {
    await sleep(500)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${name}.jpg`), image.toJPEG(90))
    console.log(`  ${name}.jpg`)
  }

  const open = (id) => run(`document.querySelectorAll('.w20-dock-item')[${id}].click(); return true`)
  const dockIndex = async (title) =>
    run(`return [...document.querySelectorAll('.w20-dock-label')].findIndex((l) => l.textContent === ${JSON.stringify(title)})`)

  console.log('скрийншоти:')
  await waitPicture()
  await shot('01-empty-station')

  // Station 01: four fields.
  await open(await dockIndex('Claude Code'))
  await sleep(300)
  await open(await dockIndex('PowerShell'))
  await sleep(300)
  await run(`
    const b = document.querySelectorAll('.w20-dock-item')
    return true`)
  await open(await dockIndex('Браузър'))
  await sleep(400)
  await run(`
    const box = document.querySelector('.w20-window--web .w20-web-url')
    box.value = 'http://localhost:${PAGE_PORT}/'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true`)
  await key('KeyN', { ctrl: true })
  await sleep(300)
  await run(`
    const n = document.querySelector('.w20-window--note textarea')
    n.value = 'План за днес\\n\\n• полетата 4 × 4 ✓\\n• всички станции с F3 ✓\\n• картини в 4K ✓\\n• глас и ИИ на български ✓\\n\\nCtrl+Space → буква, F1 — всички клавиши'
    n.dispatchEvent(new Event('input', { bubbles: true }))
    return true`)
  // Second window in field 2 and a third in field 4.
  await run(`document.querySelectorAll('.w20-window--terminal')[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true`)
  await key('KeyT', { ctrl: true, alt: true })
  await sleep(300)
  await open(await dockIndex('Файлове'))
  await sleep(1500)
  await shot('02-four-fields')

  // Solo: one window over the whole station.
  await run(`document.querySelector('.w20-window--terminal').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true`)
  await key('KeyE', { ctrl: true, shift: true })
  await sleep(700)
  await shot('03-solo')
  await key('KeyE', { ctrl: true, shift: true })
  await sleep(400)

  // A couple more stations with something in them, for the overview.
  await key('Digit2', { ctrl: true })
  await waitPicture()
  await open(await dockIndex('Gemini'))
  await sleep(300)
  await open(await dockIndex('PowerShell'))
  await sleep(300)
  await key('Digit3', { ctrl: true })
  await sleep(300)
  await key('KeyN', { ctrl: true })
  await sleep(300)
  await key('Digit1', { ctrl: true })
  await sleep(600)
  await key('F3')
  await sleep(3500)
  await shot('04-all-stations')
  await key('Escape')
  await sleep(500)

  await key('F1')
  await sleep(600)
  await shot('05-keys')
  await key('Escape')

  await key('Space', { ctrl: true })
  await sleep(300)
  await shot('06-leader')
  await key('Escape')
  await sleep(300)

  await key('Digit4', { ctrl: true })
  await waitPicture()
  await run(`
    const input = document.querySelector('.w20-bar-input')
    input.focus(); input.value = 'настройки'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 100))
    ;[...document.querySelectorAll('.w20-bar-row')].find((r) => r.textContent.includes('Настройки')).click()
    return true`)
  await sleep(1200)
  await shot('07-settings')

  // Station 05: a terminal and the chat, answered in Bulgarian with a command.
  await run(`await window.w20.settings.set({ ai: { provider: 'custom', endpoint: 'http://127.0.0.1:${AI_PORT}/v1', model: 'gpt-oss-120b' } }); return true`)
  await key('Digit5', { ctrl: true })
  await waitPicture()
  await open(await dockIndex('PowerShell'))
  await sleep(300)
  await key('KeyI', { ctrl: true, shift: true })
  await sleep(400)
  await run(`
    const box = document.querySelector('.w20-chat textarea')
    box.value = 'Кой процес държи порт 3000?'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    return true`)
  await sleep(1500)
  await shot('08-chat')

  // The same four fields of station 01, in the light theme.
  await key('Digit1', { ctrl: true })
  await sleep(300)
  await key('KeyL', { ctrl: true, alt: true })
  await waitPicture()
  await shot('09-light')
  await key('KeyL', { ctrl: true, alt: true })

  if (errors.length) console.log('грешки в конзолата:\n  ' + errors.join('\n  '))
  page.close()
  ai.close()
  app.exit(0)
}

main().catch((err) => {
  console.error(err)
  app.exit(2)
})
