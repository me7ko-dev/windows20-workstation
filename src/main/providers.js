'use strict'

/**
 * The services that can hear, think and speak for the station.
 *
 * Nearly every service worth using — free ones included — speaks the OpenAI
 * wire format, so a provider here is data, not code: an address, a default
 * model and whether it needs a key. The free ones come first because that is
 * the point; the paid one stays so a key someone already has keeps working.
 *
 * Models are only defaults. Services retire them, so every one can be changed
 * in Settings without touching this file.
 */

const PROVIDERS = {
  groq: {
    title: 'Groq — безплатен ключ',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatModel: 'llama-3.3-70b-versatile',
    sttModel: 'whisper-large-v3',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys'
  },
  gemini: {
    title: 'Google Gemini — безплатен ключ',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chatModel: 'gemini-2.5-flash',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    title: 'OpenRouter — безплатни модели',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'meta-llama/llama-3.3-70b-instruct:free',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys'
  },
  ollama: {
    title: 'Ollama — на този компютър, без ключ',
    baseUrl: 'http://localhost:11434/v1',
    chatModel: 'qwen2.5:7b',
    needsKey: false,
    keyUrl: 'https://ollama.com/download'
  },
  openai: {
    title: 'OpenAI — платен',
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini',
    sttModel: 'whisper-1',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  custom: {
    title: 'Свой адрес (OpenAI-съвместим)',
    baseUrl: '',
    chatModel: '',
    sttModel: 'whisper-1',
    needsKey: false
  }
}

/** Which providers each job can use — only some of them transcribe. */
const CHAT_PROVIDERS = ['groq', 'gemini', 'openrouter', 'ollama', 'openai', 'custom']
const STT_PROVIDERS = ['groq', 'openai', 'custom']

/** What the renderer may show: titles and defaults, never anything secret. */
function catalog() {
  const pick = (ids, modelKey) =>
    ids.map((id) => ({
      id,
      title: PROVIDERS[id].title,
      model: PROVIDERS[id][modelKey] || '',
      needsKey: PROVIDERS[id].needsKey,
      keyUrl: PROVIDERS[id].keyUrl || ''
    }))
  return { chat: pick(CHAT_PROVIDERS, 'chatModel'), stt: pick(STT_PROVIDERS, 'sttModel') }
}

module.exports = { PROVIDERS, CHAT_PROVIDERS, STT_PROVIDERS, catalog }
