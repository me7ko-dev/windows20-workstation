'use strict'

const { PROVIDERS } = require('./providers')

/**
 * What a sentence means, when the command table does not know it.
 *
 * The model never invents an action. It gets the list of what the station can
 * do right now — the same entries the command bar shows — and answers with one
 * of their ids, or none. The renderer checks the id against that list again
 * before running anything, so a model that makes one up does nothing.
 *
 * Whatever it says back is Bulgarian and short, because it is read aloud.
 */

const SYSTEM = `Ти си гласовото управление на „Windows 20 Workstation“ — безкраен десктоп с прозорци на платно.
Потребителят ти говори на български. Получаваш списък с команди, които станцията може да изпълни в момента, във вид „id — описание“.

Отговаряй САМО с един JSON обект, без нищо друго около него:
{"command": "<id от списъка или null>", "arg": "<текст или празно>", "say": "<какво да кажеш на глас>"}

Правила:
- Избери команда само ако потребителят ясно иска това действие. Не измисляй id, което го няма в списъка.
- "arg" се попълва само за команди, чието описание казва, че приемат текст (например търсене в интернет).
- "say" е на български, кратко — едно или две изречения, без markdown, без емоджи, защото се чете на глас.
- Ако е въпрос, а не команда, "command" е null и отговаряш кратко в "say".
- Ако не си сигурен какво иска, "command" е null и питаш кратко в "say".`

/** Models wrap JSON in prose or fences often enough that parsing must forgive it. */
function parseReply(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      return {
        command: typeof parsed.command === 'string' && parsed.command !== 'null' ? parsed.command : null,
        arg: typeof parsed.arg === 'string' ? parsed.arg : '',
        say: typeof parsed.say === 'string' ? parsed.say : ''
      }
    } catch {
      // fall through: treat the whole reply as speech
    }
  }
  return { command: null, arg: '', say: text.trim().slice(0, 400) }
}

function chatUrl(provider, endpoint) {
  const base = (endpoint || (PROVIDERS[provider] && PROVIDERS[provider].baseUrl) || '').replace(/\/+$/, '')
  if (!base) return ''
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

async function navigate({ text, commands, context }, settings) {
  const state = settings.read()
  const config = state.ai
  const known = PROVIDERS[config.provider]
  const apiKey = settings.keyFor(config.provider, state)

  if (!known) return { ok: false, error: `Непозната услуга за ИИ: ${config.provider}` }
  if (known.needsKey && !apiKey) {
    return { ok: false, error: 'Няма ключ за ИИ. Отвори Настройки — ключът за Groq или Gemini е безплатен.' }
  }
  const url = chatUrl(config.provider, config.endpoint)
  if (!url) return { ok: false, error: 'Няма адрес за ИИ услугата. Попълни го в Настройки.' }

  const list = (commands || [])
    .slice(0, 200)
    .map((c) => `${c.id} — ${c.label}${c.takesArg ? ' (приема текст в "arg")' : ''}`)
    .join('\n')

  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Команди в момента:\n${list}\n\n${context ? `Какво има на екрана: ${context}\n\n` : ''}Потребителят каза: „${text}“`
    }
  ]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model || known.chatModel,
        messages,
        temperature: 0.2,
        max_tokens: 400
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const detail = await response.text()
      const hint =
        response.status === 429
          ? ' Безплатният лимит е изчерпан за момента — опитай след малко или смени услугата.'
          : response.status === 404
            ? ' Може моделът вече да не съществува — смени го в Настройки.'
            : ''
      // Never echo the key back, whatever the service says.
      return { ok: false, error: `ИИ услугата отказа (${response.status}).${hint} ${detail.slice(0, 200)}` }
    }

    const data = await response.json()
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!content) return { ok: false, error: 'ИИ услугата върна празен отговор.' }
    return { ok: true, ...parseReply(String(content)) }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'ИИ услугата не отговори за 20 секунди.' }
    const local = config.provider === 'ollama' ? ' Пуснат ли е Ollama?' : ''
    return { ok: false, error: `Няма връзка с ИИ услугата: ${err.message}.${local}` }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { navigate, parseReply, chatUrl }
