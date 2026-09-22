'use strict'

const { PROVIDERS, FALLBACK_ORDER } = require('./providers')
const models = require('./models')

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

/** One request to one service. `status` 0 means it never answered. */
async function ask(url, apiKey, body, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!response.ok) return { status: response.status, detail: (await response.text()).slice(0, 300) }
    const data = await response.json()
    const message = data && data.choices && data.choices[0] && data.choices[0].message
    return { status: 200, content: message && message.content ? String(message.content) : '' }
  } catch (err) {
    return { status: 0, detail: err.name === 'AbortError' ? `не отговори за ${Math.round(timeoutMs / 1000)} секунди` : err.message }
  } finally {
    clearTimeout(timer)
  }
}

function requestBody(provider, model, messages) {
  const body = { model, messages, temperature: 0.2, max_tokens: 1200 }
  // gpt-oss thinks before it answers; for picking a command, a little is plenty.
  if (provider === 'groq' && /gpt-oss/.test(model)) body.reasoning_effort = 'low'
  return body
}

/**
 * Try one service: its model, or — if that model has been retired — the one
 * the service lists now.
 */
async function tryProvider(provider, { model, endpoint, apiKey, messages, timeoutMs }) {
  const known = PROVIDERS[provider]
  const url = chatUrl(provider, endpoint)
  if (!url) return { status: 0, detail: 'няма адрес' }
  let use = model || models.remembered(provider, 'chat') || known.chatModel
  let result = await ask(url, apiKey, requestBody(provider, use, messages), timeoutMs)
  if (result.status !== 200 && models.modelIsGone(result.status, result.detail) && known.prefer) {
    const base = endpoint || known.baseUrl
    const next = await models.discover(provider, 'chat', base, apiKey, known.prefer)
    if (next && next !== use) {
      use = next
      result = await ask(url, apiKey, requestBody(provider, use, messages), timeoutMs)
    }
  }
  return { ...result, model: use }
}

function explain(provider, result) {
  const title = (PROVIDERS[provider] && PROVIDERS[provider].title.split(' —')[0]) || provider
  if (result.status === 0) return `${title}: няма връзка (${result.detail})${provider === 'ollama' ? ' — пуснат ли е Ollama?' : ''}`
  if (result.status === 429) return `${title}: безплатният лимит е изчерпан за момента`
  if (result.status === 401 || result.status === 403) return `${title}: ключът не е приет`
  if (models.modelIsGone(result.status, result.detail)) return `${title}: моделът вече не съществува — смени го в Настройки`
  return `${title}: отказ (${result.status}) ${result.detail || ''}`.trim()
}

/**
 * The chosen service first; when it is out of free requests, down or refuses
 * the key, the next one that is set up — so a busy free tier is a detour, not
 * a dead end. Only services with a key (or none needed) are tried.
 */
async function navigate({ text, commands, context }, settings) {
  const state = settings.read()
  const config = state.ai
  const known = PROVIDERS[config.provider]
  if (!known) return { ok: false, error: `Непозната услуга за ИИ: ${config.provider}` }
  if (known.needsKey && !settings.keyFor(config.provider, state)) {
    return { ok: false, error: 'Няма ключ за ИИ. Отвори Настройки — ключът за Groq или Gemini е безплатен.' }
  }
  if (config.provider === 'custom' && !config.endpoint) {
    return { ok: false, error: 'Няма адрес за ИИ услугата. Попълни го в Настройки.' }
  }

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

  const chain = [config.provider]
  if (config.fallback !== false) {
    for (const id of FALLBACK_ORDER) {
      if (chain.includes(id)) continue
      const p = PROVIDERS[id]
      // Ollama costs nothing to try and answers at once when it is not there;
      // the others only when their key is set.
      if (id === 'ollama' || (p.needsKey && settings.keyFor(id, state))) chain.push(id)
    }
  }

  const failures = []
  for (const provider of chain) {
    const primary = provider === config.provider
    const result = await tryProvider(provider, {
      model: primary ? config.model : '',
      endpoint: primary ? config.endpoint : '',
      apiKey: settings.keyFor(provider, state),
      messages,
      timeoutMs: primary ? 20000 : 12000
    })
    if (result.status === 200) {
      if (!result.content) {
        failures.push(`${provider}: празен отговор`)
        continue
      }
      return {
        ok: true,
        provider,
        model: result.model,
        fellBack: !primary,
        ...parseReply(result.content)
      }
    }
    failures.push(explain(provider, result))
  }
  // Never echo a key back, whatever the services said.
  return { ok: false, error: `ИИ не отговори. ${failures.join(' · ')}` }
}

module.exports = { navigate, parseReply, chatUrl }
