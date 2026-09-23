/**
 * A conversation with the AI, as a window on the canvas.
 *
 * It talks to the same service as the voice — Groq, Gemini, OpenRouter, Grok
 * or Ollama, with the same fallback — and the reply streams in as it is
 * written. A command in a ``` block gets two buttons: copy it, or type it
 * into the terminal last used. Typed, never run: Enter stays the user's.
 *
 * Everything is put on the page as text, never as HTML, so an answer cannot
 * smuggle markup into the station.
 */

const MAX_SAVED = 40

let seq = 0

export function mountChat(win, { messages = [], onChange, speaker, sendToTerminal, openSettings } = {}) {
  const history = messages.filter((m) => m && typeof m.content === 'string').slice(-MAX_SAVED)

  const wrap = document.createElement('div')
  wrap.className = 'w20-chat'
  wrap.innerHTML = `
    <div class="w20-chat-log" data-role="log"></div>
    <div class="w20-chat-compose">
      <textarea data-role="input" rows="2" placeholder="Попитай нещо… (Enter изпраща, Shift+Enter нов ред)" spellcheck="false"></textarea>
      <div class="w20-chat-actions">
        <button class="w20-chat-btn is-send" data-role="send" title="Изпрати (Enter)">➤</button>
        <button class="w20-chat-btn" data-role="stop" title="Спри отговора" hidden>■</button>
        <button class="w20-chat-btn" data-role="clear" title="Нов разговор">⟲</button>
      </div>
    </div>
  `
  const $ = (role) => wrap.querySelector(`[data-role="${role}"]`)
  const log = $('log')
  const input = $('input')
  let busy = null // { requestId, el, text }

  function save() {
    if (onChange) onChange(history.slice(-MAX_SAVED))
  }

  /** Text with ``` blocks and `inline code`, built from text nodes only. */
  function render(el, text) {
    el.textContent = ''
    const parts = text.split(/```/)
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        // A fence: the first line may name the language.
        const nl = part.indexOf('\n')
        const lang = nl > -1 ? part.slice(0, nl).trim() : ''
        const code = (nl > -1 && /^[\w+-]*$/.test(lang) ? part.slice(nl + 1) : part).replace(/\n$/, '')
        el.appendChild(codeBlock(code, lang, i === parts.length - 1))
        return
      }
      // The blank lines around a fence are the block's margin, not text.
      if (parts.length > 1) part = part.replace(/^\n+|\n+$/g, '')
      if (!part) return
      const p = document.createElement('div')
      p.className = 'w20-chat-text'
      part.split(/(`[^`\n]+`)/).forEach((bit) => {
        if (/^`[^`\n]+`$/.test(bit)) {
          const c = document.createElement('code')
          c.textContent = bit.slice(1, -1)
          p.appendChild(c)
        } else if (bit) {
          p.appendChild(document.createTextNode(bit))
        }
      })
      el.appendChild(p)
    })
  }

  function codeBlock(code, lang, open) {
    const box = document.createElement('div')
    box.className = 'w20-chat-code'
    const pre = document.createElement('pre')
    pre.textContent = code
    box.appendChild(pre)
    // Still being written: no buttons for half a command.
    if (open && busy) return box
    const bar = document.createElement('div')
    bar.className = 'w20-chat-code-bar'
    const tag = document.createElement('span')
    tag.textContent = lang || 'код'
    const copy = document.createElement('button')
    copy.textContent = 'Копирай'
    copy.addEventListener('click', () => {
      window.w20.clipboard.write(code)
      copy.textContent = 'Копирано ✓'
      setTimeout(() => (copy.textContent = 'Копирай'), 1400)
    })
    const run = document.createElement('button')
    run.textContent = '› В терминала'
    run.title = 'Написва командата в терминала, без да натиска Enter'
    run.addEventListener('click', () => {
      const where = sendToTerminal ? sendToTerminal(code) : null
      run.textContent = where ? `› в „${where}“ ✓` : 'няма отворен терминал'
      setTimeout(() => (run.textContent = '› В терминала'), 1800)
    })
    bar.append(tag, copy, run)
    box.prepend(bar)
    return box
  }

  function bubble(message) {
    const el = document.createElement('div')
    el.className = `w20-chat-msg is-${message.role}${message.error ? ' is-error' : ''}`
    const body = document.createElement('div')
    body.className = 'w20-chat-body'
    if (message.role === 'assistant') render(body, message.content)
    else body.textContent = message.content
    el.appendChild(body)
    if (message.role === 'assistant' && (message.via || message.content)) {
      const foot = document.createElement('div')
      foot.className = 'w20-chat-foot'
      const via = document.createElement('span')
      via.textContent = message.via || ''
      foot.appendChild(via)
      if (speaker && message.content && !message.error) {
        const say = document.createElement('button')
        say.textContent = '🔊'
        say.title = 'Прочети на глас'
        say.addEventListener('click', () => speaker.say(message.content.replace(/```[\s\S]*?```/g, ' '), { force: true }))
        foot.appendChild(say)
      }
      el.appendChild(foot)
    }
    log.appendChild(el)
    return { el, body }
  }

  function empty() {
    const el = document.createElement('div')
    el.className = 'w20-chat-empty'
    el.innerHTML = `<b>✦</b><p>Питай каквото искаш — на български.</p>`
    const tips = ['Как да видя кой процес държи порт 3000?', 'Обясни ми какво прави git rebase', 'Напиши PowerShell скрипт, който чисти temp']
    for (const tip of tips) {
      const b = document.createElement('button')
      b.textContent = tip
      b.addEventListener('click', () => {
        input.value = tip
        send()
      })
      el.appendChild(b)
    }
    log.appendChild(el)
  }

  function redraw() {
    log.textContent = ''
    if (!history.length) empty()
    for (const m of history) bubble(m)
    log.scrollTop = log.scrollHeight
  }

  function nearBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 60
  }

  async function send() {
    const text = input.value.trim()
    if (!text || busy) return
    input.value = ''
    const empties = log.querySelector('.w20-chat-empty')
    if (empties) empties.remove()
    history.push({ role: 'user', content: text })
    bubble(history[history.length - 1])

    seq += 1
    const requestId = `${win.node.id}:${Date.now()}:${seq}`
    const answer = { role: 'assistant', content: '' }
    const view = bubble(answer)
    view.el.classList.add('is-streaming')
    busy = { requestId, answer, view }
    $('send').hidden = true
    $('stop').hidden = false
    log.scrollTop = log.scrollHeight

    const result = await window.w20.ai.chat({
      requestId,
      messages: history.map(({ role, content }) => ({ role, content }))
    })
    busy = null
    $('send').hidden = false
    $('stop').hidden = true
    view.el.remove()

    if (!result.ok) {
      history.pop() // the question stays in the box to send again
      input.value = text
      redraw()
      const failed = bubble({ role: 'assistant', content: result.error, error: true, via: '' })
      if (openSettings && /Настройки/.test(result.error)) {
        const b = document.createElement('button')
        b.className = 'w20-chat-inline'
        b.textContent = 'Отвори Настройки'
        b.addEventListener('click', openSettings)
        failed.body.appendChild(b)
      }
      log.scrollTop = log.scrollHeight
      return
    }
    if (typeof result.content === 'string' && result.content.length >= answer.content.length) answer.content = result.content
    // Stopped before the first word: nothing to keep.
    if (!answer.content) {
      history.pop()
      input.value = text
      redraw()
      return
    }
    const name = result.provider ? `${result.provider}${result.model ? ` · ${result.model}` : ''}` : ''
    answer.via = [name, result.fellBack ? 'резервна услуга' : '', result.stopped ? 'спрян' : '', result.cut ? 'прекъснат' : '']
      .filter(Boolean)
      .join(' · ')
    history.push(answer)
    while (history.length > MAX_SAVED) history.shift()
    bubble(answer)
    log.scrollTop = log.scrollHeight
    save()
  }

  const offDelta = window.w20.ai.onDelta(({ requestId, delta }) => {
    if (!busy || busy.requestId !== requestId) return
    const stick = nearBottom()
    busy.answer.content += delta
    render(busy.view.body, busy.answer.content)
    if (stick) log.scrollTop = log.scrollHeight
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
      e.preventDefault()
      send()
    }
  })
  $('send').addEventListener('click', send)
  $('stop').addEventListener('click', () => {
    if (busy) window.w20.ai.stop(busy.requestId)
  })
  $('clear').addEventListener('click', () => {
    if (busy) window.w20.ai.stop(busy.requestId)
    history.length = 0
    save()
    redraw()
    input.focus()
  })

  redraw()
  win.body.appendChild(wrap)

  return {
    focus: () => input.focus(),
    /** Put a question in and send it — from the command bar or the voice. */
    ask: (text) => {
      input.value = text
      send()
    },
    destroy: () => {
      if (busy) window.w20.ai.stop(busy.requestId)
      offDelta()
      wrap.remove()
    }
  }
}
