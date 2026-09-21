/**
 * The key panel. The key is written straight to the main process and never
 * read back — the field shows whether one is stored, not what it is, so a
 * screenshot of the canvas cannot leak it.
 */
export function mountSettings(win, { onSaved }) {
  const wrap = document.createElement('div')
  wrap.className = 'w20-settings'
  wrap.innerHTML = `
    <label class="w20-field">
      <span>Ключ за транскрипция</span>
      <input type="password" data-role="key" placeholder="sk-…" spellcheck="false" />
    </label>
    <label class="w20-field">
      <span>Модел</span>
      <input type="text" data-role="model" spellcheck="false" />
    </label>
    <label class="w20-field">
      <span>Език</span>
      <input type="text" data-role="lang" spellcheck="false" />
    </label>
    <label class="w20-field">
      <span>Собствен адрес (по избор)</span>
      <input type="text" data-role="endpoint" placeholder="по подразбиране: OpenAI" spellcheck="false" />
    </label>
    <button class="w20-settings-save" data-role="save">Запази</button>
    <p class="w20-settings-status" data-role="status"></p>
  `

  const keyInput = wrap.querySelector('[data-role="key"]')
  const modelInput = wrap.querySelector('[data-role="model"]')
  const langInput = wrap.querySelector('[data-role="lang"]')
  const endpointInput = wrap.querySelector('[data-role="endpoint"]')
  const status = wrap.querySelector('[data-role="status"]')

  window.w20.settings.get().then((state) => {
    if (!state) return
    modelInput.value = state.stt.model
    langInput.value = state.stt.language
    endpointInput.value = state.stt.endpoint
    keyInput.placeholder = state.stt.hasKey ? 'ключът е запазен — въведи нов, за да го смениш' : 'sk-…'
    status.textContent = state.stt.hasKey ? 'Готово за глас.' : 'Без ключ гласът няма да работи.'
  })

  wrap.querySelector('[data-role="save"]').addEventListener('click', async () => {
    const patch = {
      stt: {
        model: modelInput.value.trim() || 'whisper-1',
        language: langInput.value.trim(),
        endpoint: endpointInput.value.trim()
      }
    }
    // An empty field means "leave the stored key alone", not "erase it".
    if (keyInput.value.trim()) patch.stt.apiKey = keyInput.value.trim()

    const state = await window.w20.settings.set(patch)
    keyInput.value = ''
    keyInput.placeholder = state.stt.hasKey ? 'ключът е запазен' : 'sk-…'
    status.textContent = state.stt.hasKey ? 'Запазено. Гласът е готов.' : 'Запазено, но още няма ключ.'
    if (onSaved) onSaved(state)
  })

  win.body.appendChild(wrap)
  return { focus: () => keyInput.focus(), destroy: () => wrap.remove() }
}
