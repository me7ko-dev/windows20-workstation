/**
 * Hearing, thinking, speaking — and the keys for them.
 *
 * Keys are written straight to the main process and never read back — a key
 * field shows whether one is stored, not what it is, so a screenshot of the
 * canvas cannot leak it. One key per service: a free Groq key typed once both
 * hears and thinks.
 */
import { setTheme, chosen } from '../theme.js'

export function mountSettings(win, { speaker, onSaved, openWeb } = {}) {
  const wrap = document.createElement('div')
  wrap.className = 'w20-settings'
  wrap.innerHTML = `
    <p class="w20-settings-status">
      Всичко тук може да е безплатно: Groq дава безплатен ключ, който и чува, и мисли;
      Ollama работи на този компютър без ключ; гласът на Windows говори български без интернет.
    </p>

    <h3 class="w20-settings-section">Чуване — говор в текст</h3>
    <label class="w20-field">
      <span>Услуга</span>
      <select data-role="stt-provider"></select>
    </label>
    <label class="w20-field" data-role="stt-key-row">
      <span data-role="stt-key-label">Ключ</span>
      <input type="password" data-role="stt-key" spellcheck="false" />
    </label>
    <a class="w20-settings-link" data-role="stt-key-link" hidden>Вземи безплатен ключ →</a>
    <div class="w20-settings-row">
      <label class="w20-field">
        <span>Модел</span>
        <input type="text" data-role="stt-model" spellcheck="false" />
      </label>
      <label class="w20-field">
        <span>Език</span>
        <input type="text" data-role="stt-lang" spellcheck="false" />
      </label>
    </div>
    <label class="w20-field" data-role="stt-endpoint-row">
      <span>Адрес</span>
      <input type="text" data-role="stt-endpoint" placeholder="http://localhost:8000/v1" spellcheck="false" />
    </label>

    <h3 class="w20-settings-section">Мислене — ИИ навигация</h3>
    <label class="w20-field">
      <span>Услуга</span>
      <select data-role="ai-provider"></select>
    </label>
    <label class="w20-field" data-role="ai-key-row">
      <span data-role="ai-key-label">Ключ</span>
      <input type="password" data-role="ai-key" spellcheck="false" />
    </label>
    <a class="w20-settings-link" data-role="ai-key-link" hidden>Вземи безплатен ключ →</a>
    <label class="w20-field">
      <span>Модел</span>
      <input type="text" data-role="ai-model" spellcheck="false" />
    </label>
    <label class="w20-field" data-role="ai-endpoint-row">
      <span>Адрес</span>
      <input type="text" data-role="ai-endpoint" placeholder="http://localhost:1234/v1" spellcheck="false" />
    </label>
    <label class="w20-check">
      <input type="checkbox" data-role="ai-fallback" />
      <span>Свърши ли безплатният лимит — пробвай другите услуги с ключ и Ollama</span>
    </label>

    <h3 class="w20-settings-section">Говорене — отговорът на глас</h3>
    <label class="w20-field">
      <span>Глас</span>
      <select data-role="speech-engine">
        <option value="system">Гласът на Windows — безплатно, без интернет</option>
        <option value="azure">Azure — по-жив глас, безплатен план F0</option>
        <option value="off">Без глас — само текст</option>
      </select>
    </label>
    <label class="w20-field" data-role="speech-voice-row">
      <span>Български глас</span>
      <select data-role="speech-voice"></select>
    </label>
    <div class="w20-settings-row" data-role="azure-row">
      <label class="w20-field">
        <span>Ключ за Azure Speech</span>
        <input type="password" data-role="azure-key" spellcheck="false" />
      </label>
      <label class="w20-field">
        <span>Регион</span>
        <input type="text" data-role="azure-region" spellcheck="false" />
      </label>
    </div>
    <label class="w20-field" data-role="azure-voice-row">
      <span>Глас в Azure</span>
      <select data-role="azure-voice">
        <option value="bg-BG-KalinaNeural">Калина</option>
        <option value="bg-BG-BorislavNeural">Борислав</option>
      </select>
    </label>
    <label class="w20-field">
      <span>Скорост: <b data-role="rate-value">1.0</b></span>
      <input type="range" min="0.6" max="1.6" step="0.1" data-role="speech-rate" />
    </label>

    <h3 class="w20-settings-section">Изглед и клавиши</h3>
    <label class="w20-field">
      <span>Тема</span>
      <select data-role="theme">
        <option value="dark">Тъмна</option>
        <option value="light">Светла</option>
        <option value="system">Като Windows</option>
      </select>
    </label>
    <div class="w20-settings-row">
      <button class="w20-settings-save is-quiet" data-role="edit-keys">Промени клавишите…</button>
    </div>
    <p class="w20-settings-hint">Отваря keybindings.json. Запазиш ли го, новите клавиши важат веднага. Там са и двата глобални: Ctrl+Alt+W показва станцията отвсякъде, Ctrl+Alt+Space я показва и слуша.</p>

    <div class="w20-settings-row">
      <button class="w20-settings-save" data-role="save">Запази</button>
      <button class="w20-settings-save is-quiet" data-role="try">Пробвай гласа</button>
    </div>
    <p class="w20-settings-status" data-role="status"></p>
  `

  const $ = (role) => wrap.querySelector(`[data-role="${role}"]`)
  const status = $('status')

  let catalog = { chat: [], stt: [] }
  let state = null

  function fillSelect(select, entries) {
    select.innerHTML = ''
    for (const entry of entries) {
      const option = document.createElement('option')
      option.value = entry.id
      option.textContent = entry.title
      select.appendChild(option)
    }
  }

  /** Show only what the chosen service needs: a key, an address, a link. */
  function syncSection(prefix, list) {
    const id = $(`${prefix}-provider`).value
    const entry = list.find((p) => p.id === id) || {}
    const hasKey = state && state.hasKey[id]
    $(`${prefix}-key-row`).hidden = !entry.needsKey && id !== 'custom'
    $(`${prefix}-key-label`).textContent = id === 'custom' ? 'Ключ (ако услугата иска)' : `Ключ за ${entry.title || id}`
    $(`${prefix}-key`).placeholder = hasKey ? 'ключът е запазен — въведи нов, за да го смениш' : 'постави ключа тук'
    $(`${prefix}-endpoint-row`).hidden = id !== 'custom'
    $(`${prefix}-model`).placeholder = entry.model ? `по подразбиране: ${entry.model}` : 'име на модела'
    const link = $(`${prefix}-key-link`)
    link.hidden = !entry.keyUrl
    link.textContent = id === 'ollama' ? 'Изтегли Ollama →' : 'Вземи безплатен ключ →'
    link.dataset.url = entry.keyUrl || ''
  }

  function syncSpeech() {
    const engine = $('speech-engine').value
    $('speech-voice-row').hidden = engine !== 'system'
    $('azure-row').hidden = engine !== 'azure'
    $('azure-voice-row').hidden = engine !== 'azure'
    $('azure-key').placeholder = state && state.hasKey.azure ? 'ключът е запазен' : 'ключ от Azure портала'
    $('rate-value').textContent = Number($('speech-rate').value).toFixed(1)
  }

  async function fillVoices(selected) {
    const select = $('speech-voice')
    const voices = speaker ? await speaker.bulgarianVoices() : []
    select.innerHTML = ''
    const auto = document.createElement('option')
    auto.value = ''
    auto.textContent = voices.length ? 'първият намерен' : 'гласът на Windows (Microsoft Иван)'
    select.appendChild(auto)
    for (const v of voices) {
      const option = document.createElement('option')
      option.value = v.name
      option.textContent = v.name
      select.appendChild(option)
    }
    select.value = voices.some((v) => v.name === selected) ? selected : ''
  }

  function describe(next) {
    const parts = []
    parts.push(next.stt.ready ? 'Чуването е готово.' : 'Чуването чака ключ.')
    parts.push(next.ai.ready ? 'ИИ навигацията е готова.' : 'ИИ навигацията чака ключ.')
    if (next.speech.engine === 'off') parts.push('Гласът е изключен.')
    return parts.join(' ')
  }

  async function load() {
    const [providers, current] = await Promise.all([window.w20.providers(), window.w20.settings.get()])
    if (!current) return
    catalog = providers || catalog
    state = current
    fillSelect($('stt-provider'), catalog.stt)
    fillSelect($('ai-provider'), catalog.chat)
    $('stt-provider').value = state.stt.provider
    $('stt-model').value = state.stt.model
    $('stt-lang').value = state.stt.language
    $('stt-endpoint').value = state.stt.endpoint
    $('ai-provider').value = state.ai.provider
    $('ai-model').value = state.ai.model
    $('ai-endpoint').value = state.ai.endpoint
    $('ai-fallback').checked = state.ai.fallback !== false
    $('speech-engine').value = state.speech.engine
    $('speech-rate').value = String(state.speech.rate || 1)
    $('azure-region').value = state.speech.azureRegion
    $('azure-voice').value = state.speech.azureVoice
    await fillVoices(state.speech.voice)
    syncSection('stt', catalog.stt)
    syncSection('ai', catalog.chat)
    syncSpeech()
    status.textContent = describe(state)
  }

  $('theme').value = chosen()
  // A theme is seen at once — no Save needed to try it.
  $('theme').addEventListener('change', () => setTheme($('theme').value))
  $('edit-keys').addEventListener('click', () => document.dispatchEvent(new CustomEvent('w20:edit-keys')))

  $('stt-provider').addEventListener('change', () => syncSection('stt', catalog.stt))
  $('ai-provider').addEventListener('change', () => syncSection('ai', catalog.chat))
  $('speech-engine').addEventListener('change', syncSpeech)
  $('speech-rate').addEventListener('input', syncSpeech)

  for (const prefix of ['stt', 'ai']) {
    $(`${prefix}-key-link`).addEventListener('click', () => {
      const url = $(`${prefix}-key-link`).dataset.url
      if (url && openWeb) openWeb(url)
    })
  }

  async function save() {
    const sttProvider = $('stt-provider').value
    const aiProvider = $('ai-provider').value
    const patch = {
      stt: {
        provider: sttProvider,
        model: $('stt-model').value.trim(),
        language: $('stt-lang').value.trim(),
        endpoint: $('stt-endpoint').value.trim()
      },
      ai: {
        provider: aiProvider,
        model: $('ai-model').value.trim(),
        endpoint: $('ai-endpoint').value.trim(),
        fallback: $('ai-fallback').checked
      },
      speech: {
        engine: $('speech-engine').value,
        voice: $('speech-voice').value,
        rate: Number($('speech-rate').value) || 1,
        azureRegion: $('azure-region').value.trim() || 'westeurope',
        azureVoice: $('azure-voice').value
      },
      keys: {}
    }
    // An empty field means "leave the stored key alone", not "erase it".
    const sttKey = $('stt-key').value.trim()
    const aiKey = $('ai-key').value.trim()
    const azureKey = $('azure-key').value.trim()
    if (sttKey) patch.keys[sttProvider] = sttKey
    if (aiKey) patch.keys[aiProvider] = aiKey
    if (azureKey) patch.keys.azure = azureKey

    const next = await window.w20.settings.set(patch)
    if (!next) return null
    state = next
    for (const role of ['stt-key', 'ai-key', 'azure-key']) $(role).value = ''
    syncSection('stt', catalog.stt)
    syncSection('ai', catalog.chat)
    syncSpeech()
    status.textContent = `Запазено. ${describe(next)}`
    if (speaker) speaker.reload()
    if (onSaved) onSaved(next)
    return next
  }

  $('save').addEventListener('click', save)
  $('try').addEventListener('click', async () => {
    await save()
    if (speaker) speaker.say('Здравей! Аз съм гласът на работната станция. Кажи ми какво да отворя.', { force: true })
  })

  load()
  win.body.appendChild(wrap)
  return { focus: () => $('stt-provider').focus(), destroy: () => wrap.remove() }
}
