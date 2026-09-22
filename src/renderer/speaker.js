/**
 * The station's voice.
 *
 * Chromium's own speechSynthesis first — free, offline, no delay — but only
 * with a Bulgarian voice: Bulgarian read by an English voice is worse than
 * silence. Without one, the main process asks Windows itself (or Azure, if
 * that is what Settings say). A reason it cannot speak is told once, not on
 * every reply.
 */

export function createSpeaker({ toast }) {
  let config = null
  let audio = null
  let warned = ''

  async function settings() {
    if (!config) {
      const state = await window.w20.settings.get()
      config = (state && state.speech) || { engine: 'off' }
    }
    return config
  }

  /** Voices arrive asynchronously; the first call can see an empty list. */
  function voices() {
    if (!('speechSynthesis' in window)) return Promise.resolve([])
    const now = speechSynthesis.getVoices()
    if (now.length) return Promise.resolve(now)
    return new Promise((resolve) => {
      const done = () => resolve(speechSynthesis.getVoices())
      speechSynthesis.addEventListener('voiceschanged', done, { once: true })
      setTimeout(done, 800)
    })
  }

  async function bulgarianVoices() {
    return (await voices()).filter((v) => /^bg/i.test(v.lang))
  }

  function stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel()
    if (audio) {
      audio.pause()
      URL.revokeObjectURL(audio.src)
      audio = null
    }
  }

  async function say(text, { force = false } = {}) {
    const cfg = await settings()
    if (!text || (cfg.engine === 'off' && !force)) return false
    stop()

    if (cfg.engine !== 'azure') {
      const list = await bulgarianVoices()
      const voice = list.find((v) => v.name === cfg.voice) || list[0]
      if (voice) {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.voice = voice
        utterance.lang = voice.lang
        utterance.rate = Number(cfg.rate) || 1
        speechSynthesis.speak(utterance)
        return true
      }
    }

    const result = await window.w20.speech.say(text)
    if (!result || !result.ok) {
      const error = (result && result.error) || ''
      if (error && (force || error !== warned)) toast(error, { tone: 'warn', timeout: 12000 })
      warned = error
      return false
    }
    const blob = new Blob([result.audio], { type: result.mimeType })
    audio = new Audio(URL.createObjectURL(blob))
    audio.play().catch(() => {})
    return true
  }

  return {
    say,
    stop,
    bulgarianVoices,
    /** Settings changed — read them again on the next reply. */
    reload: () => {
      config = null
      warned = ''
    }
  }
}
