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
 */

export function createVoice({ onTranscript, onState }) {
  let recorder = null
  let chunks = []
  let stream = null
  let state = 'idle' // idle | listening | working

  function setState(next, detail) {
    state = next
    onState(next, detail)
  }

  async function start() {
    if (state !== 'idle') return
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
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data)
    }

    recorder.onstop = async () => {
      releaseStream()
      const blob = new Blob(chunks, { type: mimeType })
      chunks = []

      // Anything this short is a slipped click, not speech — sending it would
      // spend a request to be told there was nothing there.
      if (blob.size < 2000) {
        setState('idle')
        return
      }

      setState('working')
      const buffer = await blob.arrayBuffer()
      const result = await window.w20.voice.transcribe(buffer, mimeType)
      setState('idle')
      onTranscript(result)
    }

    recorder.start()
    setState('listening')
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else releaseStream()
  }

  function releaseStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
  }

  function toggle() {
    if (state === 'listening') stop()
    else if (state === 'idle') start()
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
