'use strict'

const fs = require('fs')
const path = require('path')
const { PROVIDERS } = require('./providers')

/**
 * Settings that never belong in the repo — API keys above all.
 *
 * Kept in the OS user-data folder, not in the project, and never sent to the
 * renderer: the renderer only ever learns *whether* a key is configured, so a
 * bug in canvas code cannot read it out.
 *
 * Keys are stored once per service, not once per job: one free Groq key both
 * hears and thinks, and typing it twice is how the second copy goes stale.
 */
function createSettings(userDataDir) {
  const file = path.join(userDataDir, 'settings.json')

  const DEFAULTS = {
    // Hearing: speech to text.
    stt: {
      provider: 'groq',
      model: '',
      language: 'bg',
      endpoint: '',
      // Before keys were per service, the one key lived here. Still read so an
      // older settings file keeps its voice.
      apiKey: ''
    },
    // Thinking: what a sentence the command table did not know means.
    ai: {
      provider: 'groq',
      model: '',
      endpoint: '',
      // When the chosen service is out of free requests, try the others.
      fallback: true
    },
    // Speaking back.
    speech: {
      engine: 'system', // system | azure | off
      voice: '',
      rate: 1,
      azureRegion: 'westeurope',
      azureVoice: 'bg-BG-KalinaNeural'
    },
    keys: {}
  }

  const SECTIONS = ['stt', 'ai', 'speech', 'keys']

  function read() {
    let parsed = {}
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8')) || {}
    } catch {
      parsed = {}
    }
    const out = {}
    for (const section of SECTIONS) out[section] = { ...DEFAULTS[section], ...(parsed[section] || {}) }
    return out
  }

  function write(patch) {
    const next = read()
    for (const section of SECTIONS) {
      if (patch[section] && typeof patch[section] === 'object') Object.assign(next[section], patch[section])
    }
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
      fs.renameSync(tmp, file)
      return true
    } catch {
      return false
    }
  }

  /** The key for a service, with the pre-split voice key as a fallback. */
  function keyFor(provider, state = read()) {
    const stored = state.keys[provider]
    if (stored) return stored
    if (provider === state.stt.provider && state.stt.apiKey) return state.stt.apiKey
    return ''
  }

  /** Whether a job can run: a key where the service needs one. */
  function ready(provider, state) {
    const known = PROVIDERS[provider]
    if (!known) return false
    return !known.needsKey || Boolean(keyFor(provider, state))
  }

  /** What the renderer is allowed to know: everything except the keys. */
  function safe() {
    const state = read()
    const hasKey = {}
    for (const id of Object.keys(PROVIDERS)) hasKey[id] = Boolean(keyFor(id, state))
    hasKey.azure = Boolean(state.keys.azure)
    return {
      stt: {
        provider: state.stt.provider,
        model: state.stt.model,
        language: state.stt.language,
        endpoint: state.stt.endpoint,
        hasKey: hasKey[state.stt.provider] || false,
        ready: ready(state.stt.provider, state)
      },
      ai: {
        provider: state.ai.provider,
        model: state.ai.model,
        endpoint: state.ai.endpoint,
        fallback: state.ai.fallback !== false,
        hasKey: hasKey[state.ai.provider] || false,
        ready: ready(state.ai.provider, state) && (state.ai.provider !== 'custom' || Boolean(state.ai.endpoint))
      },
      speech: { ...state.speech },
      hasKey
    }
  }

  return { read, write, safe, keyFor, file }
}

module.exports = { createSettings }
