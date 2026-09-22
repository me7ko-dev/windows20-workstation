'use strict'

const { execFile } = require('child_process')

/**
 * Text to speech, for when the renderer cannot say it itself.
 *
 * The renderer tries Chromium's speechSynthesis first — free, offline and
 * instant. But on Windows Chromium only sees the older SAPI voices, and the
 * Bulgarian one (Microsoft Ivan) is installed as a newer OneCore voice. So
 * the second route asks Windows directly through its own WinRT synthesizer,
 * which does see it. Both are free and need no internet.
 *
 * Azure is the optional third: its neural Bulgarian voices (Kalina, Borislav)
 * sound far more human, and its free F0 tier covers a desktop's worth of
 * replies — but it needs an Azure account.
 */

// Text travels in an environment variable as UTF-8 base64: Windows PowerShell
// reads its console in the OEM code page, where Cyrillic does not survive.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'bg*' } | Select-Object -First 1
if (-not $voice) { exit 3 }
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = $voice
$synth.Options.SpeakingRate = [double]$env:W20_TTS_RATE
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:W20_TTS))
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[Console]::Out.Write([Convert]::ToBase64String($bytes))
`

const NO_BULGARIAN_VOICE =
  'В Windows няма инсталиран български глас. Добави го от Настройки на Windows → Час и език → ' +
  'Говор → Добавяне на гласове → Български. Или избери Azure в Настройките на станцията.'

function sayWindows(text, rate) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'Системният глас извън браузъра работи само под Windows.' })
  }
  const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        env: { ...process.env, W20_TTS: Buffer.from(text, 'utf8').toString('base64'), W20_TTS_RATE: String(rate || 1) },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30000,
        windowsHide: true
      },
      (err, stdout) => {
        if (err) {
          resolve({ ok: false, error: err.code === 3 ? NO_BULGARIAN_VOICE : `Windows не можа да прочете текста: ${err.message}` })
          return
        }
        const audio = Buffer.from(String(stdout).trim(), 'base64')
        resolve(audio.length ? { ok: true, audio, mimeType: 'audio/wav' } : { ok: false, error: 'Windows върна празен звук.' })
      }
    )
  })
}

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch])
}

async function sayAzure(text, config, key) {
  if (!key) return { ok: false, error: 'Няма ключ за Azure Speech. Въведи го в Настройки или избери системния глас.' }
  const region = (config.azureRegion || 'westeurope').trim()
  const voice = (config.azureVoice || 'bg-BG-KalinaNeural').trim()
  const rate = Math.round(((Number(config.rate) || 1) - 1) * 100)
  const ssml =
    `<speak version="1.0" xml:lang="bg-BG"><voice name="${escapeXml(voice)}">` +
    `<prosody rate="${rate >= 0 ? '+' : ''}${rate}%">${escapeXml(text)}</prosody></voice></speak>`
  try {
    const response = await fetch(`https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'windows20-workstation'
      },
      body: ssml
    })
    if (!response.ok) {
      return { ok: false, error: `Azure отказа (${response.status}). Провери ключа и региона.` }
    }
    return { ok: true, audio: Buffer.from(await response.arrayBuffer()), mimeType: 'audio/mpeg' }
  } catch (err) {
    return { ok: false, error: `Няма връзка с Azure: ${err.message}` }
  }
}

async function say(text, settings) {
  const state = settings.read()
  const config = state.speech
  const clean = String(text || '').trim().slice(0, 1500)
  if (!clean || config.engine === 'off') return { ok: false, error: '' }
  if (config.engine === 'azure') return sayAzure(clean, config, state.keys.azure)
  return sayWindows(clean, config.rate)
}

module.exports = { say }
