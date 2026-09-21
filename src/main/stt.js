'use strict'

/**
 * Speech to text.
 *
 * Electron ships no speech recognition — Chromium's Web Speech API talks to a
 * Google service that Electron builds do not carry — so audio recorded in the
 * renderer is posted to a transcription endpoint from here, where the key
 * lives. Bulgarian is the default language because guessing it from silence
 * is what makes a dictation feel broken.
 */

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/audio/transcriptions'
}

async function transcribe({ audio, mimeType }, settings) {
  const config = settings.read().stt

  if (!config.apiKey) {
    return { ok: false, error: 'Няма ключ за транскрипция. Отвори Настройки и го въведи.' }
  }

  const endpoint = config.endpoint || ENDPOINTS[config.provider]
  if (!endpoint) {
    return { ok: false, error: `Непозната услуга: ${config.provider}` }
  }

  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), 'speech.webm')
  form.append('model', config.model || 'whisper-1')
  if (config.language) form.append('language', config.language)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
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

module.exports = { transcribe, ENDPOINTS }
