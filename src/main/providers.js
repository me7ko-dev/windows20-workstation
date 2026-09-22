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
    chatModel: 'openai/gpt-oss-120b',
    sttModel: 'whisper-large-v3',
    // When a model is retired, the first of these the service still lists.
    prefer: [/gpt-oss-120b/, /gpt-oss/, /llama-4/, /qwen/, /llama/],
    sttPrefer: [/^whisper-large-v3$/, /whisper-large-v3-turbo/, /whisper/],
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys'
  },
  gemini: {
    title: 'Google Gemini — безплатен ключ',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // Flash-Lite: the free tier allows hundreds of requests a day, Flash tens.
    chatModel: 'gemini-3.1-flash-lite',
    prefer: [/flash-lite(?!.*preview)/, /flash-lite/, /flash(?!.*(image|tts|live|audio))/],
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    title: 'OpenRouter — безплатни модели',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'openai/gpt-oss-120b:free',
    prefer: [/gpt-oss.*:free$/, /(llama|qwen|gemma|deepseek|mistral).*:free$/, /:free$/],
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys'
  },
  xai: {
    title: 'xAI Grok — с кредити в xAI',
    baseUrl: 'https://api.x.ai/v1',
    chatModel: 'grok-4.3',
    prefer: [/^grok-4\.\d+$/, /^grok-4/, /^grok/],
    needsKey: true,
    keyUrl: 'https://console.x.ai'
  },
  ollama: {
    title: 'Ollama — на този компютър, без ключ',
    baseUrl: 'http://localhost:11434/v1',
    chatModel: 'qwen2.5:7b',
    prefer: [/qwen/, /llama/, /gemma/, /./],
    needsKey: false,
    keyUrl: 'https://ollama.com/download'
  },
  whisper: {
    title: 'Whisper на този компютър — без ключ, без интернет',
    // speaches (faster-whisper-server) on its default port. Any other
    // OpenAI-compatible Whisper server works through „Свой адрес“.
    baseUrl: 'http://localhost:8000/v1',
    sttModel: 'Systran/faster-whisper-large-v3',
    sttPrefer: [/large-v3/, /whisper/],
    needsKey: false,
    keyUrl: 'https://speaches.ai'
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
const CHAT_PROVIDERS = ['groq', 'gemini', 'openrouter', 'ollama', 'xai', 'openai', 'custom']
const STT_PROVIDERS = ['groq', 'whisper', 'openai', 'custom']

/** Who steps in when the chosen service is out of free requests, in order. */
const FALLBACK_ORDER = ['groq', 'gemini', 'openrouter', 'xai', 'ollama']

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

module.exports = { PROVIDERS, CHAT_PROVIDERS, STT_PROVIDERS, FALLBACK_ORDER, catalog }
