/**
 * The microphone.
 *
 * Two destinations, decided by what the user was last touching:
 *  - a focused terminal → the words are typed into it (dictation);
 *  - anything else → the words become a command.
 *
 * The distinction matters because the same sentence means different things in
 * each: "отвори настройките" typed into Claude Code is a prompt, but said to
 * the desktop it is an action.
 *
 * One press is enough. The station listens, and when the speaking stops it
 * sends what it heard by itself; a second press sends at once. A short tone
 * says it started and another that it sent, so the key works with the window
 * behind other programs too.
 */

// How quiet counts as "stopped talking", and for how long.
const SILENCE_MS = 1200
const NOTHING_SAID_MS = 7000
const LONGEST_MS = 45000

/** Two short notes: up when listening starts, down when it sends. */
function tone(freqs) {
  try {
    const ctx = new AudioContext()
    let t = ctx.currentTime + 0.01
    for (const f of freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.13)
      t += 0.1
    }
    setTimeout(() => ctx.close().catch(() => {}), 700)
  } catch {
    // no audio device — the light on the button still says it
  }
}

export function createVoice({ onTranscript, onState }) {
  let recorder = null
  let chunks = []
  let stream = null
  let state = 'idle' // idle | listening | working
  let watch = null
  let discard = false
  let options = {}

  function setState(next, detail) {
    state = next
    onState(next, detail)
  }

  /**
   * Listens to the level, not the words: a little room noise first to learn
   * how quiet the room is, then speech, then a pause long enough to mean done.
   */
  function watchLevel() {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const data = new Float32Array(analyser.fftSize)
    const started = performance.now()
    let floor = Infinity
    let heard = false
    let quietSince = 0

    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i]
      const level = Math.sqrt(sum / data.length)
      const now = performance.now()
      if (now - started < 250) {
        floor = Math.min(floor, level)
        return
      }
      const threshold = Math.max(0.018, (Number.isFinite(floor) ? floor : 0) * 3)
      if (level > threshold) {
        heard = true
        quietSince = 0
      } else if (heard) {
        if (!quietSince) quietSince = now
        else if (now - quietSince > SILENCE_MS) stop()
      }
      if (!heard && now - started > NOTHING_SAID_MS) cancel()
      if (now - started > LONGEST_MS) stop()
    }, 80)

    return () => {
      clearInterval(timer)
      ctx.close().catch(() => {})
    }
  }

  async function start(opts = {}) {
    if (state !== 'idle') return
    options = opts
    // A slow DNS costs seconds; spent while the user speaks, it costs nothing.
    if (window.w20.voice.warm) window.w20.voice.warm()
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      })
    } catch (err) {
      setState('idle')
      onTranscript({ ok: false, error: `Няма достъп до микрофона: ${err.message}` })
      return
    }

    chunks = []
    discard = false
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data)
    }

    recorder.onstop = async () => {
      if (watch) {
        watch()
        watch = null
      }
      releaseStream()
      const blob = new Blob(chunks, { type: mimeType })
      chunks = []

      // Nothing said, or a slipped click: sending it would spend a request
      // to be told there was nothing there.
      if (discard || blob.size < 2000) {
        setState('idle')
        if (discard) {
          tone([330])
          onTranscript({ ok: false, quiet: true, error: 'Не чух нищо — натисни пак и говори.' })
        }
        return
      }

      tone([880, 620])
      setState('working')
      const buffer = await blob.arrayBuffer()
      const result = await window.w20.voice.transcribe(buffer, mimeType)
      setState('idle')
      onTranscript({ ...result, options })
    }

    recorder.start()
    watch = watchLevel()
    tone([620, 880])
    setState('listening')
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else releaseStream()
  }

  function cancel() {
    discard = true
    stop()
  }

  function releaseStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
  }

  function toggle(opts) {
    if (state === 'listening') stop()
    else if (state === 'idle') start(opts)
  }

  return {
    toggle,
    start,
    stop,
    get state() {
      return state
    }
  }
}
