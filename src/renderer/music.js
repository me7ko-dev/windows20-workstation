/**
 * Music: the owner's own YouTube Music, in a player of the station's own.
 *
 * The real page — music.youtube.com — runs in a <webview> with a session of
 * its own that is kept between runs, so it is the user's account: playlists,
 * likes, Premium if there is one. The station draws the player around it
 * (what is playing, the controls, the playlists) and answers to the voice.
 * Nothing is downloaded: YouTube streams it, as it does in its own app.
 *
 * The page is never `display: none` — a page that is not laid out may stop —
 * it is moved off-screen instead, so the music keeps playing in every
 * station and with the player closed. It is created only when first asked
 * for, so a station that never plays music never pays for it.
 */

const HOME = 'https://music.youtube.com/'
const PARTITION = 'persist:music'
// Google turns away sign-ins from browsers it does not recognise; this is the
// Chromium inside this Electron, saying so without the Electron part.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const VIBE = 'lofi hip hop beats to code to'
const STORE = 'w20-music-playlists'

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6.5 5h4v14h-4zm7 0h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2.2v12H6zm3.6 6 8.4 6V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M15.8 6H18v12h-2.2zM6 18l8.4-6L6 6z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M3 9.2v5.6h3.8L12 19.6V4.4L6.8 9.2zm12.6 2.8a4.3 4.3 0 0 0-2.3-3.8v7.6a4.3 4.3 0 0 0 2.3-3.8z"/></svg>',
  wide: '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M12 3v10.4A3.9 3.9 0 1 0 14 17V7.2h4.6V3z"/></svg>'
}

/* What the page is doing. Run inside YouTube Music, so plain DOM only. */
const INFO = `(() => {
  const v = document.querySelector('video')
  const bar = document.querySelector('ytmusic-player-bar')
  const pick = (s) => (bar && bar.querySelector(s)) || null
  const text = (s) => { const e = pick(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : '' }
  const img = pick('img.image') || pick('.thumbnail img')
  // The attribute, not .src: an empty src reads back as the page's own address.
  const src = img ? img.getAttribute('src') || '' : ''
  return {
    title: text('.title'),
    byline: text('.byline'),
    art: /^https:/.test(src) && !src.startsWith(location.origin) ? src : '',
    paused: v ? v.paused : true,
    time: v ? v.currentTime : 0,
    duration: v && isFinite(v.duration) ? v.duration : 0,
    volume: v ? v.volume : 1,
    host: location.host,
    // YouTube's own player marks an advert with this class.
    ad: Boolean(document.querySelector('.ad-showing')),
    signedOut: Boolean(document.querySelector('a.sign-in-link, ytmusic-nav-bar a[href*="ServiceLogin"]'))
  }
})()`

const FIRST_SONG = `(() => {
  if (/^consent\\./.test(location.host)) return 'CONSENT'
  const a = document.querySelector('ytmusic-card-shelf-renderer a[href*="watch?v="], ytmusic-shelf-renderer a[href*="watch?v="], ytmusic-search-page a[href*="watch?v="]')
  return a ? a.getAttribute('href') : ''
})()`

const PLAYLIST_FIRST = `(() => {
  if (/^consent\\./.test(location.host)) return 'CONSENT'
  const a = document.querySelector('ytmusic-playlist-shelf-renderer a[href*="watch?v="], ytmusic-section-list-renderer a[href*="watch?v="], ytmusic-browse-response a[href*="watch?v="]')
  return a ? a.getAttribute('href') : ''
})()`

const PLAYLISTS = `(() => {
  const out = []
  const seen = new Set()
  for (const a of document.querySelectorAll('a[href*="playlist?list="]')) {
    let id = ''
    try { id = new URL(a.getAttribute('href'), location.href).searchParams.get('list') || '' } catch (e) {}
    if (!id || seen.has(id) || id === 'SE') continue
    const card = a.closest('ytmusic-two-row-item-renderer, ytmusic-responsive-list-item-renderer')
    const t = card && (card.querySelector('.title') || card.querySelector('[title]'))
    const title = ((t && (t.getAttribute('title') || t.textContent)) || a.getAttribute('title') || a.textContent || '').replace(/\\s+/g, ' ').trim()
    if (!title) continue
    seen.add(id)
    out.push({ id, title: title.slice(0, 60) })
  }
  return out.slice(0, 40)
})()`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// YouTube asks once about cookies (consent.youtube.com) before anything plays.
// That choice is the owner's, so the page is shown to them, not clicked away.
const CONSENT_NOTE = 'YouTube пита за бисквитките — избери веднъж в прозореца вдясно. После „Вход“ горе вдясно, за да е твоят профил.'
const onConsent = (now) => Boolean(now && /^consent\./.test(now.host || ''))

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** The bar's cover is 60 px; Google serves any size of the same picture. */
function bigArt(url) {
  if (!url) return ''
  return url.replace(/=w\d+-h\d+[^&?#]*/, '=w544-h544-l90-rj')
}

export function createMusic({ toast }) {
  const el = document.createElement('section')
  el.className = 'w20-music'
  el.dataset.mode = 'closed'
  el.innerHTML = `
    <div class="w20-music-card" data-role="card">
      <div class="w20-music-backdrop" data-role="backdrop"></div>
      <header class="w20-music-head">
        <span class="w20-music-brand">${ICON.note}<span>Музика</span></span>
        <span class="w20-music-who" data-role="who"></span>
        <button class="w20-music-icon" data-role="wide" title="Разгледай YouTube Music">${ICON.wide}</button>
        <button class="w20-music-icon" data-role="close" title="Скрий — музиката продължава">${ICON.close}</button>
      </header>
      <div class="w20-music-now">
        <div class="w20-music-art"><img data-role="art" alt="" hidden /><span data-role="art-empty">${ICON.note}</span></div>
        <div class="w20-music-meta">
          <b data-role="title">Нищо не свири</b>
          <span data-role="byline">Кажи „пусни музика за кодене“ или избери плейлист</span>
        </div>
      </div>
      <div class="w20-music-progress">
        <span data-role="cur">0:00</span>
        <div class="w20-music-track" data-role="track"><i data-role="fill"></i></div>
        <span data-role="dur">0:00</span>
      </div>
      <div class="w20-music-controls">
        <button class="w20-music-ctl" data-role="prev" title="Предишна">${ICON.prev}</button>
        <button class="w20-music-ctl is-main" data-role="play" title="Пусни / спри">${ICON.play}</button>
        <button class="w20-music-ctl" data-role="next" title="Следваща">${ICON.next}</button>
      </div>
      <label class="w20-music-vol" title="Сила на звука">${ICON.vol}<input type="range" min="0" max="100" value="100" data-role="vol" /></label>
      <form class="w20-music-search" data-role="search">
        <input data-role="q" placeholder="Песен, изпълнител, настроение…" spellcheck="false" />
        <button type="submit">Пусни</button>
      </form>
      <div class="w20-music-chips" data-role="chips"></div>
      <p class="w20-music-status" data-role="status"></p>
    </div>
    <div class="w20-music-browser" data-role="browser"></div>
  `
  document.body.appendChild(el)
  const $ = (role) => el.querySelector(`[data-role="${role}"]`)

  let view = null
  let ready = false
  // Once the page has been attached it takes loadURL; before that, the first
  // address waits for it (setting src again makes Electron log a failed load).
  let attached = false
  let pending = ''
  let info = null
  let pollTimer = 0
  let busy = false
  const listeners = new Set()

  /*
   * Holds: while the microphone listens and while the station answers, the
   * music waits, and comes back when the last hold lets go — but only if it
   * was the one that stopped it. The set changes at once; pausing and playing
   * the page are queued, so a quick let-go never overtakes the pause.
   */
  const holds = new Set()
  let heldPlaying = false
  let queue = Promise.resolve()
  const PAUSE = `(() => { const v = document.querySelector('video'); if (!v || v.paused) return false; v.pause(); return true })()`
  const RESUME = `(() => { const v = document.querySelector('video'); if (v && v.paused) v.play(); return true })()`

  function hold(reason) {
    const first = holds.size === 0
    holds.add(reason)
    el.classList.add('is-held')
    if (first && view) {
      queue = queue.then(async () => {
        if (await run(PAUSE)) heldPlaying = true
      })
    }
  }

  function release(reason) {
    if (!holds.delete(reason) || holds.size) return
    el.classList.remove('is-held')
    queue = queue.then(async () => {
      if (holds.size || !heldPlaying) return
      heldPlaying = false
      await run(RESUME)
      refresh()
    })
  }

  /* ------------------------------------------------------------ the page */

  function ensureView() {
    if (view) return view
    view = document.createElement('webview')
    view.className = 'w20-music-view'
    view.setAttribute('partition', PARTITION)
    view.setAttribute('useragent', UA)
    view.setAttribute('src', HOME)
    view.addEventListener('dom-ready', () => {
      ready = true
      if (!attached) {
        attached = true
        if (pending) {
          const url = pending
          pending = ''
          load(url)
        }
      }
      if (!pollTimer) pollTimer = setInterval(refresh, 1000)
      refresh()
    })
    view.addEventListener('did-start-loading', () => {
      ready = false
    })
    view.addEventListener('did-stop-loading', () => {
      ready = true
    })
    $('browser').appendChild(view)
    return view
  }

  async function run(code) {
    if (!view || !ready) return null
    try {
      return await view.executeJavaScript(code, true)
    } catch {
      return null
    }
  }

  function navigate(url) {
    ensureView()
    if (attached) load(url)
    else pending = url
  }

  /** The promise is not trusted (a redirect to the cookie page, or the next
   * song, aborts it); what the page shows is read by polling. */
  function load(url) {
    try {
      Promise.resolve(view.loadURL(url)).catch(() => {})
    } catch {
      // the page is going away with the window
    }
  }

  async function waitFor(code, timeoutMs) {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const value = await run(code)
      if (value) return value
      await sleep(450)
    }
    return null
  }

  /* -------------------------------------------------------------- the card */

  function setStatus(text) {
    $('status').textContent = text || ''
  }

  function show(mode) {
    el.dataset.mode = mode
    if (mode !== 'closed') ensureView()
    emit()
  }

  function draw() {
    const now = info || {}
    const has = Boolean(now.title)
    const ad = Boolean(now.ad) && !now.paused
    $('title').textContent = ad ? 'Реклама от YouTube' : has ? now.title : view ? 'Нищо не свири' : 'Твоят YouTube Music'
    $('byline').textContent = ad
      ? 'Песента тръгва след нея'
      : has
        ? now.byline
        : now.signedOut
          ? 'Влез в профила си: бутонът горе вдясно → Sign in'
          : 'Кажи „пусни музика за кодене“ или избери плейлист'
    const art = bigArt(now.art)
    const img = $('art')
    if (art && img.getAttribute('src') !== art) img.setAttribute('src', art)
    img.hidden = !art
    $('art-empty').hidden = Boolean(art)
    $('backdrop').style.backgroundImage = art ? `url("${art.replace(/"/g, '%22')}")` : ''
    $('play').innerHTML = (has || ad) && !now.paused ? ICON.pause : ICON.play
    const fraction = now.duration ? Math.min(1, now.time / now.duration) : 0
    $('fill').style.width = `${(fraction * 100).toFixed(2)}%`
    $('cur').textContent = clock(now.time)
    $('dur').textContent = clock(now.duration)
    if (document.activeElement !== $('vol')) $('vol').value = String(Math.round((now.volume ?? 1) * 100))
    const onMusic = now.host === 'music.youtube.com'
    $('who').textContent = !onMusic ? '' : now.signedOut ? 'не си влязъл' : 'твоят профил'
    el.classList.toggle('is-playing', has && !now.paused)
  }

  function emit() {
    for (const fn of listeners) fn(state())
  }

  async function refresh() {
    const next = await run(INFO)
    if (next) info = next
    if (onConsent(info) && el.dataset.mode !== 'full') {
      setStatus(CONSENT_NOTE)
      show('full')
    }
    // A song that started while the station was listening or talking — a
    // "next" or a new search — waits too, and plays when the hold lets go.
    if (holds.size && info && info.title && !info.paused) {
      if (await run(PAUSE)) heldPlaying = true
      info.paused = true
    }
    draw()
    emit()
  }

  /* ------------------------------------------------------------ playlists */

  function savedPlaylists() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE) || '[]')
      return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string') : []
    } catch {
      return []
    }
  }

  function drawChips() {
    const chips = $('chips')
    chips.innerHTML = ''
    const add = (label, run, extra = '') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `w20-music-chip ${extra}`.trim()
      b.textContent = label
      b.addEventListener('click', run)
      chips.appendChild(b)
    }
    add('За кодене', () => vibe(), 'is-lead')
    add('Харесани', () => liked())
    for (const p of savedPlaylists().filter((p) => p.id !== 'LM')) add(p.title, () => playPlaylist(p.id))
    add(savedPlaylists().length ? '↻ Обнови плейлистите' : '↻ Вземи плейлистите ми', () => syncPlaylists(), 'is-quiet')
  }

  async function syncPlaylists() {
    if (busy) return []
    busy = true
    show(el.dataset.mode === 'closed' ? 'card' : el.dataset.mode)
    setStatus('Взимам плейлистите ти от YouTube Music…')
    const probe = document.createElement('webview')
    probe.className = 'w20-music-probe'
    probe.setAttribute('partition', PARTITION)
    probe.setAttribute('useragent', UA)
    probe.setAttribute('src', `${HOME}library/playlists`)
    document.body.appendChild(probe)
    let list = []
    try {
      const loaded = await new Promise((resolve) => {
        probe.addEventListener('dom-ready', () => resolve(true), { once: true })
        setTimeout(() => resolve(false), 25000)
      })
      if (loaded) {
        const until = Date.now() + 14000
        while (Date.now() < until) {
          list = (await probe.executeJavaScript(PLAYLISTS).catch(() => [])) || []
          if (list.length) break
          await sleep(700)
        }
      }
    } finally {
      probe.remove()
      busy = false
    }
    if (list.length) {
      try {
        localStorage.setItem(STORE, JSON.stringify(list))
      } catch {
        // no storage — the chips still show this time
      }
      setStatus(`Взех ${list.length} плейлиста.`)
      toast(`Музика: ${list.length} плейлиста от профила ти`, { timeout: 4000 })
    } else {
      setStatus('Не намерих плейлисти. Ако не си влязъл: бутонът ⤢ горе → Sign in.')
    }
    drawChips()
    emit()
    return list
  }

  /* ------------------------------------------------------------- playing */

  async function play(query) {
    const q = String(query || '').trim()
    if (!q) return vibe()
    show(el.dataset.mode === 'closed' ? 'card' : el.dataset.mode)
    setStatus(`Търся „${q}“…`)
    navigate(`${HOME}search?q=${encodeURIComponent(q)}`)
    await sleep(1600)
    if (await consentFirst()) return false
    const href = await waitFor(FIRST_SONG, 10000)
    if (href === 'CONSENT') return consentShown()
    if (href) {
      navigate(new URL(href, HOME).href)
      setStatus('')
      return true
    }
    if (onConsent(info)) return consentShown()
    setStatus('Не намерих точна песен — избери от резултатите.')
    show('full')
    return false
  }

  async function playPlaylist(id) {
    show(el.dataset.mode === 'closed' ? 'card' : el.dataset.mode)
    setStatus('Пускам плейлиста…')
    navigate(`${HOME}playlist?list=${encodeURIComponent(id)}`)
    await sleep(1600)
    if (await consentFirst()) return false
    const href = await waitFor(PLAYLIST_FIRST, 10000)
    if (href === 'CONSENT') return consentShown()
    if (href) {
      const url = new URL(href, HOME)
      if (!url.searchParams.get('list')) url.searchParams.set('list', id)
      navigate(url.href)
      setStatus('')
      return true
    }
    if (onConsent(info)) return consentShown()
    setStatus('Плейлистът се отвори — натисни Play в него.')
    show('full')
    return false
  }

  /** The cookie question is up: show it and say so, instead of waiting on it. */
  async function consentFirst() {
    const host = await run('location.host')
    if (!/^consent\./.test(host || '')) return false
    consentShown()
    return true
  }

  function consentShown() {
    setStatus(CONSENT_NOTE)
    show('full')
    return false
  }

  const vibe = () => play(VIBE)
  const liked = () => playPlaylist('LM')

  async function toggle() {
    // Said while the music is waiting for the voice: "stop" means it stays
    // stopped afterwards, "play" means it comes back.
    if (holds.size && info && info.title) {
      heldPlaying = !heldPlaying
      return heldPlaying
    }
    if (!info || !info.title) return vibe()
    const playing = await run(`(() => { const v = document.querySelector('video'); if (!v) return null; if (v.paused) v.play(); else v.pause(); return !v.paused })()`)
    refresh()
    return playing
  }

  async function step(which) {
    await run(`(() => { const b = document.querySelector('ytmusic-player-bar .${which}-button'); if (b) b.click(); return Boolean(b) })()`)
    setTimeout(refresh, 600)
  }

  async function setVolume(value) {
    const v = Math.max(0, Math.min(1, value))
    await run(`(() => { const v = document.querySelector('video'); if (v) v.volume = ${v.toFixed(2)} })()`)
    refresh()
  }

  async function seek(fraction) {
    const f = Math.max(0, Math.min(1, fraction))
    await run(`(() => { const v = document.querySelector('video'); if (v && isFinite(v.duration)) v.currentTime = v.duration * ${f.toFixed(4)} })()`)
    refresh()
  }

  /* ------------------------------------------------------------- wiring */

  $('close').addEventListener('click', () => show('closed'))
  $('wide').addEventListener('click', () => show(el.dataset.mode === 'full' ? 'card' : 'full'))
  $('play').addEventListener('click', () => toggle())
  $('prev').addEventListener('click', () => step('previous'))
  $('next').addEventListener('click', () => step('next'))
  $('vol').addEventListener('input', () => setVolume(Number($('vol').value) / 100))
  $('track').addEventListener('click', (e) => {
    const box = $('track').getBoundingClientRect()
    if (box.width) seek((e.clientX - box.left) / box.width)
  })
  $('search').addEventListener('submit', (e) => {
    e.preventDefault()
    const q = $('q').value.trim()
    if (q) play(q)
    $('q').value = ''
  })
  // Keys typed here are for the search box, not the station's shortcuts.
  $('q').addEventListener('keydown', (e) => e.stopPropagation())

  drawChips()
  draw()

  function state() {
    return {
      mode: el.dataset.mode,
      loaded: Boolean(view),
      playing: Boolean(info && info.title && !info.paused),
      title: info && info.title ? info.title : '',
      byline: info && info.byline ? info.byline : ''
    }
  }

  return {
    ICON,
    /** The card: open if closed, closed if open. */
    toggleCard: () => show(el.dataset.mode === 'closed' ? 'card' : 'closed'),
    open: () => show('card'),
    close: () => show('closed'),
    wide: () => show('full'),
    toggle,
    next: () => step('next'),
    prev: () => step('previous'),
    play,
    vibe,
    liked,
    playPlaylist,
    syncPlaylists,
    volume: (delta) => setVolume(((info && info.volume) ?? 1) + delta),
    hold,
    release,
    playlists: savedPlaylists,
    state,
    onChange: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
