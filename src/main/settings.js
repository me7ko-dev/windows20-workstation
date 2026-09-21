'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Settings that never belong in the repo — an API key above all.
 *
 * Kept in the OS user-data folder, not in the project, and never sent to the
 * renderer: the renderer only ever learns *whether* a key is configured, so a
 * bug in canvas code cannot read it out.
 */
function createSettings(userDataDir) {
  const file = path.join(userDataDir, 'settings.json')

  const DEFAULTS = {
    stt: {
      provider: 'openai',
      model: 'whisper-1',
      language: 'bg',
      endpoint: '',
      apiKey: ''
    }
  }

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { ...DEFAULTS, ...parsed, stt: { ...DEFAULTS.stt, ...(parsed.stt || {}) } }
    } catch {
      return { ...DEFAULTS, stt: { ...DEFAULTS.stt } }
    }
  }

  function write(patch) {
    const next = read()
    if (patch.stt) Object.assign(next.stt, patch.stt)
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

  /** What the renderer is allowed to know: everything except the key itself. */
  function safe() {
    const state = read()
    return {
      stt: {
        provider: state.stt.provider,
        model: state.stt.model,
        language: state.stt.language,
        endpoint: state.stt.endpoint,
        hasKey: Boolean(state.stt.apiKey)
      }
    }
  }

  return { read, write, safe, file }
}

module.exports = { createSettings }
