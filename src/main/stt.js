'use strict'

const { PROVIDERS } = require('./providers')

/**
 * Speech to text.
 *
 * Electron ships no speech recognition — Chromium's Web Speech API talks to a
 * Google service that Electron builds do not carry — so audio recorded in the
 * renderer is posted to a transcription endpoint from here, where the key
 * lives. Groq is the default because its Whisper is free with a key that asks
 * for no card, and it hears Bulgarian well. Bulgarian is the default language
 * because guessing it from silence is what makes a dictation feel broken.
 */

/** A custom address may be the service root or the transcription URL itself. */
function transcriptionUrl(provider, endpoint) {
  if (endpoint) {
    const trimmed = endpoint.replace(/\/+$/, '')
    return /\/audio\/transcriptions$/.test(trimmed) ? trimmed : `${trimmed}/audio/transcriptions`
  }
  const known = PROVIDERS[provider]
  return known && known.baseUrl ? `${known.baseUrl}/audio/transcriptions` : ''
}

async function transcribe({ audio, mimeType }, settings) {
  const state = settings.read()
  const config = state.stt
  const known = PROVIDERS[config.provider]
  const apiKey = settings.keyFor(config.provider, state)

  if (known && known.needsKey && !apiKey) {
    return { ok: false, error: 'Няма ключ за разпознаване на говор. Отвори Настройки и го въведи — за Groq е безплатен.' }
  }

  const endpoint = transcriptionUrl(config.provider, config.endpoint)
  if (!endpoint) {
    return { ok: false, error: `Няма адрес за услугата „${config.provider}“. Попълни го в Настройки.` }
  }

  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), 'speech.webm')
  form.append('model', config.model || (known && known.sttModel) || 'whisper-1')
  if (config.language) form.append('language', config.language)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form
    })

    if (!response.ok) {
      const detail = await response.text()
      // Never echo the key back, whatever the service says.
      return { ok: false, error: `Услугата отказа (${response.status}): ${detail.slice(0, 300)}` }
    }

    const data = await response.json()
    const text = (data.text || '').trim()
    return text ? { ok: true, text } : { ok: false, error: 'Нищо не беше разпознато.' }
  } catch (err) {
    return { ok: false, error: `Няма връзка с услугата: ${err.message}` }
  }
}

module.exports = { transcribe, transcriptionUrl }
