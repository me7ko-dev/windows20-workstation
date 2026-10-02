'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { parseReply, stationPrompt, CHAT_SYSTEM } = require('./ai')

/**
 * Claude Code as the station's brain: the `claude` already installed on this
 * machine, run headless with `-p`, so it answers on the owner's own
 * subscription. For the person at this laptop only — nothing here hands the
 * login to anyone else or reads it.
 *
 * It runs with no tools. For the voice it reads the station's commands and
 * answers with JSON, the same contract Genesis has; real work (code, files,
 * projects) goes to `claude:task`, a terminal where the interactive Claude
 * Code runs and every step is seen and approved by the user.
 *
 * The long part of a request travels on stdin, not the command line: Windows
 * caps a command line at 32 767 characters and a .cmd shim mangles quotes.
 */

let found = null

function locate() {
  if (found && fs.existsSync(found)) return found
  const candidates = [
    process.env.W20_CLAUDE,
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return (found = candidate)
  }
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const pick =
      process.platform === 'win32'
        ? lines.find((l) => /\.exe$/i.test(l)) || lines.find((l) => /\.cmd$/i.test(l))
        : lines[0]
    if (pick) return (found = pick)
  } catch {
    // not on PATH
  }
  return null
}

/** Why it failed, in words the user can act on. */
function explain(text) {
  const t = String(text || '')
  if (/login|log in|api key|authenticat|unauthori/i.test(t)) {
    return 'Claude Code не е влязъл в профила ти. Отвори терминал, пусни claude и напиши /login.'
  }
  if (/rate limit|usage limit|limit reached|5-hour|weekly/i.test(t)) {
    return 'Лимитът на абонамента за Claude е изчерпан за момента.'
  }
  if (/overloaded|\b529\b/i.test(t)) return 'Claude е претоварен в момента — опитай след малко.'
  if (/connection error|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed? ?out|network/i.test(t)) {
    return 'Claude Code няма връзка с интернет (или DNS отговаря бавно) — опитай пак.'
  }
  return `Claude Code: ${t.trim().slice(0, 300) || 'не отговори'}`
}

/**
 * One headless run. `stream` gives the text as it is written, through
 * `onDelta`; otherwise the whole reply comes back at the end.
 */
function run({ prompt, system, model, stream = false, timeoutMs = 90000, signal, onDelta }) {
  return new Promise((resolve) => {
    const exe = locate()
    if (!exe) {
      resolve({ ok: false, error: 'Claude Code не е намерен на този компютър (npm install -g @anthropic-ai/claude-code).' })
      return
    }

    const args = [
      '-p',
      '--model', model || 'haiku',
      '--tools', '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--system-prompt', system,
      '--output-format', stream ? 'stream-json' : 'json'
    ]
    if (stream) args.push('--verbose', '--include-partial-messages')

    const viaCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)
    let child
    try {
      child = spawn(viaCmd ? process.env.ComSpec || 'cmd.exe' : exe, viaCmd ? ['/d', '/s', '/c', exe, ...args] : args, {
        cwd: os.tmpdir(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      resolve({ ok: false, error: explain(err.message) })
      return
    }

    let out = ''
    let err = ''
    let text = ''
    let model_ = ''
    let final = null
    let buffer = ''
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', stop)
      resolve(result)
    }
    const stop = () => {
      try {
        child.kill()
      } catch {
        // already gone
      }
      finish({ ok: true, text, model: model_, stopped: true })
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // already gone
      }
      finish(text ? { ok: true, text, model: model_, cut: true } : { ok: false, error: `Claude Code не отговори за ${Math.round(timeoutMs / 1000)} секунди.` })
    }, timeoutMs)
    if (signal) {
      if (signal.aborted) return stop()
      signal.addEventListener('abort', stop)
    }

    const line = (raw) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      let event
      try {
        event = JSON.parse(trimmed)
      } catch {
        return
      }
      if (event.type === 'system' && event.model) model_ = event.model
      if (event.type === 'stream_event' && event.event && event.event.type === 'content_block_delta') {
        const delta = event.event.delta
        if (delta && delta.type === 'text_delta' && delta.text) {
          text += delta.text
          if (onDelta) onDelta(delta.text)
        }
      }
      if (event.type === 'result') final = event
    }

    // Anything odd about the child from here on is a failed answer, never a
    // thrown error: the caller falls back to the free services on {ok:false}.
    try {
      wire()
    } catch (e) {
      try {
        child.kill()
      } catch {
        // already gone
      }
      finish({ ok: false, error: explain(e.message) })
    }

    function wire() {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        if (!stream) {
          out += chunk
          return
        }
        buffer += chunk
        let nl
        while ((nl = buffer.indexOf('\n')) !== -1) {
          line(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
        }
      })
      child.stderr.on('data', (chunk) => {
        err += chunk
      })
      child.on('error', (e) => finish({ ok: false, error: explain(e.message) }))
      child.on('close', () => {
        if (stream) {
          if (buffer) line(buffer)
        } else {
          try {
            final = JSON.parse(out)
          } catch {
            final = null
          }
        }
        if (final && final.modelUsage && !model_) model_ = Object.keys(final.modelUsage)[0] || ''
        if (final && !final.is_error && typeof final.result === 'string') {
          finish({ ok: true, text: stream && text ? text : final.result, model: model_ })
          return
        }
        if (text) {
          finish({ ok: true, text, model: model_, cut: true })
          return
        }
        finish({ ok: false, error: explain((final && (final.result || final.subtype)) || err || out) })
      })

      child.stdin.on('error', () => {})
      child.stdin.end(prompt, 'utf8')
    }
  })
}

/* ------------------------------------------------------------ the voice */

const VOICE_SYSTEM =
  'Ти си гласовото управление на AI Workstation. Отговаряш САМО с един JSON обект по правилата в съобщението, без нищо друго.'

const VOICE_RULES = `[Гласово управление на „AI Workstation“]
Ти управляваш станцията вместо потребителя. Той ти говори на глас, на български.
Отговори САМО с един JSON обект, без нищо около него:
{"actions": [{"command": "<id от списъка>", "arg": "<текст или празно>"}], "say": "<какво да кажеш на глас>"}

Правила:
- "actions" е редът, в който да се изпълнят командите — нула, една или няколко. Само id от списъка, нищо измислено.
- "arg" само за команди, които приемат текст.
- Музика: „пусни X“ → music:play с X; „пусни нещо за кодене“ → music:vibe; „спри/пусни музиката“ → music:toggle; „следващата“ → music:next.
- Истинска работа с код, файлове или проекти („направи ми…“, „оправи…“, „създай папка…“) → claude:task с ясна задача на български. Тя се отваря в терминал, където потребителят вижда и одобрява всяка стъпка.
- "terminal:type" пише текст в последния терминал, без да натиска Enter.
- "say" е кратко, на български, без markdown и без емоджи, защото се чете на глас.
- Ако е въпрос, а не действие — "actions" е празен и отговаряш в "say".`

async function command({ text, commands, context, history }, config = {}) {
  const list = (commands || [])
    .slice(0, 220)
    .map((c) => `${c.id} — ${c.label}${c.takesArg ? ' (приема текст в "arg")' : ''}`)
    .join('\n')
  // The last few spoken turns, so "и затвори го" knows what "го" is.
  const before = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Потребителят' : 'Ти'}: ${m.content.slice(0, 1000)}`)
    .join('\n')
  const prompt =
    `${VOICE_RULES}\n\n` +
    (before ? `Досега:\n${before}\n\n` : '') +
    `Команди в момента:\n${list}\n\n` +
    (context ? `Какво има на екрана: ${context}\n\n` : '') +
    `Сега е ${new Date().toLocaleString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.\n\n` +
    `Потребителят каза: „${text}“`
  const result = await run({ prompt, system: VOICE_SYSTEM, model: config.voiceModel || 'haiku', timeoutMs: 60000 })
  if (!result.ok) return result
  const reply = parseReply(result.text)
  // Read aloud: an emoji is noise to a voice.
  reply.say = reply.say.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim()
  return { ok: true, provider: 'claude', model: result.model || config.voiceModel || 'haiku', fellBack: false, ...reply }
}

/* ------------------------------------------------------------- the chat */

async function chat({ messages, station }, config = {}, onDelta, signal) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-24)
  if (!history.length) return { ok: false, error: 'Няма въпрос.' }
  const last = history[history.length - 1]
  const earlier = history
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? 'Потребителят' : 'Ти'}: ${m.content.slice(0, 8000)}`)
    .join('\n\n')
  const told = stationPrompt(station)
  const prompt =
    (told ? `${told}\n\n---\n` : '') +
    (earlier ? `Разговорът досега:\n${earlier}\n\n---\n` : '') +
    last.content.slice(0, 16000)
  const result = await run({
    prompt,
    system: CHAT_SYSTEM.replace(/\n/g, ' '),
    model: config.chatModel || 'sonnet',
    stream: true,
    onDelta,
    signal,
    timeoutMs: 300000
  })
  if (!result.ok) return result
  return {
    ok: true,
    content: result.text,
    provider: 'claude',
    model: result.model || config.chatModel || 'sonnet',
    fellBack: false,
    stopped: Boolean(result.stopped),
    cut: Boolean(result.cut)
  }
}

function status() {
  const exe = locate()
  return { found: Boolean(exe), path: exe || '' }
}

module.exports = { command, chat, status, locate }
