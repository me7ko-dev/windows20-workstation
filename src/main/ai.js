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

/**
 * Models wrap JSON in prose or fences often enough that parsing must forgive
 * it. A reply names one command, or — Genesis may chain them — a list under
 * `actions`; both come back as `actions`, with the first also as `command`.
 */
function parseReply(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      const one = (a) =>
        a && typeof a.command === 'string' && a.command && a.command !== 'null'
          ? { command: a.command, arg: typeof a.arg === 'string' ? a.arg : '' }
          : null
      const actions = (Array.isArray(parsed.actions) ? parsed.actions.map(one) : [one(parsed)]).filter(Boolean).slice(0, 6)
      return {
        command: actions[0] ? actions[0].command : null,
        arg: actions[0] ? actions[0].arg : '',
        actions,
        say: typeof parsed.say === 'string' ? parsed.say : ''
      }
    } catch {
      // fall through: treat the whole reply as speech
    }
  }
  return { command: null, arg: '', actions: [], say: text.trim().slice(0, 400) }
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

function requestBody(provider, model, messages, extra = {}) {
  const body = { model, messages, temperature: 0.2, max_tokens: 1200, ...extra }
  // gpt-oss thinks before it answers; for picking a command, a little is plenty.
  if (provider === 'groq' && /gpt-oss/.test(model)) body.reasoning_effort = 'low'
  return body
}

/**
 * Try one service: its model, or — if that model has been retired — the one
 * the service lists now.
 */
async function tryProvider(provider, { model, endpoint, apiKey, messages, timeoutMs, send = ask }) {
  const known = PROVIDERS[provider]
  const url = chatUrl(provider, endpoint)
  if (!url) return { status: 0, detail: 'няма адрес' }
  let use = model || models.remembered(provider, 'chat') || known.chatModel
  let result = await send(url, apiKey, use, timeoutMs)
  if (result.status !== 200 && models.modelIsGone(result.status, result.detail) && known.prefer) {
    const base = endpoint || known.baseUrl
    const next = await models.discover(provider, 'chat', base, apiKey, known.prefer)
    if (next && next !== use) {
      use = next
      result = await send(url, apiKey, use, timeoutMs)
    }
  }
  return { ...result, model: result.served || use }
}

/**
 * The chosen service, then — if falling back is on — every other one that is
 * set up. Ollama costs nothing to try and answers at once when it is not
 * there; the others only when their key is set.
 */
function chainFor(config, state, settings) {
  const chain = [config.provider]
  if (config.fallback !== false) {
    for (const id of FALLBACK_ORDER) {
      if (chain.includes(id)) continue
      const p = PROVIDERS[id]
      if (id === 'ollama' || (p.needsKey && settings.keyFor(id, state))) chain.push(id)
    }
  }
  return chain
}

/** Whether the chosen service can be asked at all, in words for the user. */
function notReady(config, state, settings) {
  const known = PROVIDERS[config.provider]
  if (!known) return `Непозната услуга за ИИ: ${config.provider}`
  if (known.needsKey && !settings.keyFor(config.provider, state)) {
    return 'Няма ключ за ИИ. Отвори Настройки — ключът за Groq или Gemini е безплатен.'
  }
  if (config.provider === 'custom' && !config.endpoint) return 'Няма адрес за ИИ услугата. Попълни го в Настройки.'
  return ''
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
  const problem = notReady(config, state, settings)
  if (problem) return { ok: false, error: problem }

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

  const chain = chainFor(config, state, settings)
  const failures = []
  for (const provider of chain) {
    const primary = provider === config.provider
    const result = await tryProvider(provider, {
      model: primary ? config.model : '',
      endpoint: primary ? config.endpoint : '',
      apiKey: settings.keyFor(provider, state),
      timeoutMs: primary ? 20000 : 12000,
      send: (url, apiKey, model, timeoutMs) => ask(url, apiKey, requestBody(provider, model, messages), timeoutMs)
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

/* ------------------------------------------------- Genesis at the wheel */

/**
 * Genesis keeps its own system prompt, so the rules travel in the message.
 * It may chain actions; each id is still checked against the list by the
 * renderer, and anything marked for confirmation waits for the user's Enter.
 */
const GENESIS_RULES = `[Гласово управление на „Windows 20 Workstation“]
Ти управляваш станцията вместо потребителя. Той ти говори на глас, на български.
Отговори САМО с един JSON обект, без нищо около него:
{"actions": [{"command": "<id от списъка>", "arg": "<текст или празно>"}], "say": "<какво да кажеш на глас>"}

Правила:
- "actions" е редът, в който да се изпълнят командите — нула, една или няколко. Само id от списъка, нищо измислено.
- "arg" само за команди, които приемат текст.
- "terminal:type" пише текст в последния терминал, без да натиска Enter — Enter остава за потребителя.
- "say" е кратко, на български, без markdown и емоджи, защото се чете на глас.
- Ако е въпрос, а не действие — "actions" е празен и отговаряш в "say".`

async function command({ text, commands, context, history }, genesis) {
  const list = (commands || [])
    .slice(0, 200)
    .map((c) => `${c.id} — ${c.label}${c.takesArg ? ' (приема текст в "arg")' : ''}`)
    .join('\n')
  // The last few spoken turns, so "и затвори го" knows what "го" is.
  const before = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  const messages = [
    ...before,
    {
      role: 'user',
      content: `${GENESIS_RULES}\n\nКоманди в момента:\n${list}\n\n${context ? `Какво има на екрана: ${context}\n\n` : ''}Потребителят каза: „${text}“`
    }
  ]
  const url = `${String(genesis.url || '').replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`
  const result = await ask(url, '', { model: 'genesis-agent', messages, temperature: 0.2, max_tokens: 1200 }, 180000)
  if (result.status !== 200) return { ok: false, error: explain('genesis', result) }
  if (!result.content) return { ok: false, error: 'Genesis върна празен отговор.' }
  return { ok: true, provider: 'genesis', model: 'genesis-agent', fellBack: false, ...parseReply(result.content) }
}

/* ------------------------------------------------------------ the chat */

const CHAT_SYSTEM = `Ти си ИИ помощникът в „Windows 20 Workstation“ — работна станция на Windows с терминали, агенти за код (Claude Code, Gemini CLI, Aider) и браузър.
Отговаряй на езика, на който ти пишат — по подразбиране на български. Бъди кратък и конкретен.
Команди за терминала давай в блок \`\`\`, по една на ред, за PowerShell, освен ако не питат за друго — потребителят може да ги прати в терминала с един бутон.
Не измисляй факти; ако не знаеш, кажи го.`

/**
 * The station, told to whoever answers the chat: the date (a model has no
 * clock and will otherwise guess its training year), what is on screen, and
 * the actions it may take. Actions go in one ```w20 block at the end of the
 * reply; the chat hides it, checks every id against its own list and runs
 * them. `web:lookup`/`web:read` come back as a message so it can answer.
 */
function stationPrompt(station) {
  if (!station || !Array.isArray(station.commands)) return ''
  const list = station.commands
    .slice(0, 200)
    .map((c) => `${c.id} — ${c.label}${c.takesArg ? ' (arg: текст)' : ''}`)
    .concat([
      'web:lookup — търси в интернет; резултатите ти се връщат и тогава отговаряш (arg: заявка)',
      'web:read — чете уеб страница и ти връща текста ѝ (arg: адрес)'
    ])
    .join('\n')
  return `[Станцията] Днес е ${station.now || new Date().toString()}.
Ти си ИИ чатът в „Windows 20 Workstation“ и можеш да действаш в нея — не само да съветваш.
${station.context ? `На екрана: ${station.context}\n` : ''}
Когато потребителят иска нещо, което станцията прави сама (браузър, терминал, програма, тема, станция…), НЕ давай PowerShell команди — направи го. Сложи НАКРАЯ на отговора си точно един блок:
\`\`\`w20
{"actions": [{"command": "<id>", "arg": "<текст или празно>"}]}
\`\`\`
Правила:
- Само id от списъка долу, в реда, в който да се изпълнят. Без блок, ако няма какво да се прави.
- Въпрос за нещо актуално (дата, новини, версии, цени, „провери в Google“) — не гадай и не казвай, че нямаш интернет: използвай web:lookup, а после при нужда web:read. Резултатите идват в съобщение, започващо с „[Станцията]“; тогава отговори с тях и посочи източника.
- terminal:type само пише в терминала, без Enter.
- Текстът преди блока е кратък — какво правиш, на езика на потребителя.

Команди:
${list}`
}

/**
 * One streamed request. Resolves when the reply is complete — or with the
 * status of a refusal, before anything was streamed, so the next service can
 * be tried.
 */
async function stream(url, apiKey, body, timeoutMs, onDelta, signal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal) signal.addEventListener('abort', abort)
  // Waiting for the first byte is bounded; a long answer, once it flows, is not.
  let timer = setTimeout(abort, timeoutMs)
  const idle = () => {
    clearTimeout(timer)
    timer = setTimeout(abort, 45000)
  }
  let text = ''
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal
    })
    if (!response.ok) return { status: response.status, detail: (await response.text()).slice(0, 300) }
    idle()

    // A service that ignores `stream` answers with plain JSON.
    const type = response.headers.get('content-type') || ''
    if (!/event-stream/.test(type)) {
      const data = await response.json()
      const message = data && data.choices && data.choices[0] && data.choices[0].message
      text = message && message.content ? String(message.content) : ''
      if (text) onDelta(text)
      // Genesis names the model its Brain picked; worth showing.
      return { status: 200, content: text, served: data && typeof data.model === 'string' ? data.model : '' }
    }

    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      idle()
      buffer += decoder.decode(chunk, { stream: true })
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return { status: 200, content: text }
        try {
          const data = JSON.parse(payload)
          const delta = data.choices && data.choices[0] && data.choices[0].delta
          const piece = delta && typeof delta.content === 'string' ? delta.content : ''
          if (piece) {
            text += piece
            onDelta(piece)
          }
        } catch {
          // a keep-alive or a comment line
        }
      }
    }
    return { status: 200, content: text }
  } catch (err) {
    if (signal && signal.aborted) return { status: 200, content: text, stopped: true }
    // Cut off half-way: what arrived is still the answer, just shorter.
    if (text) return { status: 200, content: text, cut: true }
    return { status: 0, detail: err.name === 'AbortError' ? `не отговори за ${Math.round(timeoutMs / 1000)} секунди` : err.message }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', abort)
  }
}

/**
 * A conversation with the chosen service, streamed. Falls back like the
 * navigation does, but only before the first word: once a service has started
 * answering, switching would stitch two answers together.
 */
async function chat({ messages, station }, settings, onDelta, signal, { genesis = null } = {}) {
  const state = settings.read()
  const config = state.ai
  // Genesis first when it is the chat's brain and answering; the navigation
  // service and its fallbacks after it, unless falling back is off.
  const useGenesis = Boolean(genesis)
  const problem = notReady(config, state, settings)
  if (!useGenesis && problem) return { ok: false, error: problem }
  if (useGenesis && !genesis.ok && (problem || config.fallback === false)) {
    return { ok: false, error: `${genesis.error}${problem ? ` Резервната услуга също не е готова: ${problem}` : ''}` }
  }

  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 16000) }))
  if (!history.length) return { ok: false, error: 'Няма въпрос.' }
  const told = stationPrompt(station)
  const full = [{ role: 'system', content: told ? `${CHAT_SYSTEM}\n\n${told}` : CHAT_SYSTEM }, ...history]
  // Genesis keeps its own system prompt and puts ours after it: only the station.
  const forGenesis = told ? [{ role: 'system', content: told }, ...history] : history

  const failures = []
  let chain = []
  if (useGenesis && genesis.ok) chain.push('genesis')
  else if (useGenesis) failures.push(genesis.error)
  if (!problem && (!useGenesis || config.fallback !== false)) chain = chain.concat(chainFor(config, state, settings))
  const first = chain[0]
  for (const provider of chain) {
    if (signal && signal.aborted) break
    const primary = provider === first
    const own = provider === 'genesis'
    const result = await tryProvider(provider, {
      model: own ? 'genesis-agent' : provider === config.provider ? config.model : '',
      endpoint: own ? `${String(state.chat.genesisUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '')}/v1` : provider === config.provider ? config.endpoint : '',
      apiKey: own ? '' : settings.keyFor(provider, state),
      // Genesis thinks with its whole Brain — routing, fallbacks — so it gets longer.
      timeoutMs: own ? 180000 : primary ? 25000 : 15000,
      send: (url, apiKey, model, timeoutMs) =>
        stream(
          url,
          apiKey,
          // Genesis has its own voice and its own system prompt; ours would be a second one.
          requestBody(provider, model, own ? forGenesis : full, { temperature: 0.4, max_tokens: 4096 }),
          timeoutMs,
          onDelta,
          signal
        )
    })
    if (result.status === 200) {
      if (!result.content && !result.stopped) {
        failures.push(`${provider}: празен отговор`)
        continue
      }
      // The whole text as well: the pieces travel as separate messages and
      // the last of them can arrive after this reply does.
      return {
        ok: true,
        content: result.content || '',
        provider,
        model: result.model,
        fellBack: !primary || (useGenesis && !own),
        note: useGenesis && !own ? failures[0] || '' : '',
        stopped: Boolean(result.stopped),
        cut: Boolean(result.cut)
      }
    }
    failures.push(explain(provider, result))
  }
  if (signal && signal.aborted) return { ok: true, stopped: true }
  return { ok: false, error: `ИИ не отговори. ${failures.join(' · ')}` }
}

module.exports = { navigate, command, chat, parseReply, chatUrl, stationPrompt }
