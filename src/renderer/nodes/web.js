/**
 * A web window on the canvas — the browser, and the editor VS Code serves from
 * its own web mode.
 *
 * It is a `<webview>`: a whole separate process with no preload, no node and
 * its own session, so a page here cannot reach the desktop around it. That
 * isolation is also what it costs — a web window is a process, not a div, and
 * the load readout counts it like any other window.
 */

/** Typed without a scheme, a word with a dot is an address; anything else is a search. */
function asUrl(text) {
  const value = text.trim()
  if (!value) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  if (/^localhost(:\d+)?(\/|$)/i.test(value)) return `http://${value}`
  if (/^[^\s/]+\.[^\s/]{2,}(\/|$)/.test(value)) return `https://${value}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

export function mountWeb(win, { url = '', partition = 'persist:w20', chrome = true, onChange } = {}) {
  const host = document.createElement('div')
  host.className = 'w20-web'
  host.innerHTML = `
    <div class="w20-web-bar" data-role="bar">
      <button class="w20-web-btn" data-role="back" title="Назад">‹</button>
      <button class="w20-web-btn" data-role="forward" title="Напред">›</button>
      <button class="w20-web-btn" data-role="reload" title="Презареди">⟳</button>
      <input class="w20-web-url" data-role="url" placeholder="адрес или търсене" spellcheck="false" />
      <button class="w20-web-btn" data-role="external" title="Отвори в браузъра на Windows">↗</button>
    </div>
    <div class="w20-web-view" data-role="view"></div>
    <div class="w20-web-fail" data-role="fail" hidden></div>
  `

  const bar = host.querySelector('[data-role="bar"]')
  const box = host.querySelector('[data-role="url"]')
  const view = host.querySelector('[data-role="view"]')
  const fail = host.querySelector('[data-role="fail"]')
  if (!chrome) bar.hidden = true

  const frame = document.createElement('webview')
  frame.setAttribute('partition', partition)
  frame.setAttribute('allowpopups', 'false')
  // Starts blank rather than empty, so the guest is attached and ready before
  // any address is asked for — see `navigate`.
  frame.setAttribute('src', 'about:blank')
  frame.className = 'w20-web-frame'
  view.appendChild(frame)

  let current = url
  let ready = false
  let queued = null

  function showFail(text) {
    win.setBadge('грешка', 'error')
    fail.hidden = false
    fail.textContent = `Страницата не се отвори: ${text}`
  }

  /**
   * What to put in front of the user. A refusal comes back wrapped in the IPC
   * call that carried it — "Error invoking remote method 'GUEST_VIEW_…'" — and
   * the only part of that anyone can act on is the code at the end.
   */
  function readable(err) {
    const text = String((err && err.message) || err)
    const code = /\b(ERR_[A-Z_0-9]+)\b/.exec(text)
    return code ? code[1] : text
  }

  /**
   * Addresses go through `loadURL`, not through `src`.
   *
   * Some are refused before a load even begins — a blocked port, a scheme the
   * guest will not touch — and `src` has nowhere to report that: the refusal
   * surfaces as an unhandled rejection in the console and the window sits
   * there looking fine. `loadURL` hands back a promise that can be caught and
   * shown.
   */
  function navigate(target) {
    if (!ready) {
      queued = target
      return
    }
    frame.loadURL(target).catch((err) => showFail(readable(err)))
  }

  frame.addEventListener('dom-ready', () => {
    ready = true
    if (queued === null) return
    const target = queued
    queued = null
    navigate(target)
  })

  function go(next) {
    const target = asUrl(next)
    if (!target) return
    current = target
    box.value = target
    fail.hidden = true
    navigate(target)
    if (onChange) onChange(target)
  }

  box.value = url
  // An empty window waits with the caret in the address bar rather than
  // deciding on a home page for the user.
  if (url) go(url)

  box.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') go(box.value)
    if (e.key === 'Escape') box.blur()
  })

  host.querySelector('[data-role="back"]').addEventListener('click', () => {
    if (frame.canGoBack && frame.canGoBack()) frame.goBack()
  })
  host.querySelector('[data-role="forward"]').addEventListener('click', () => {
    if (frame.canGoForward && frame.canGoForward()) frame.goForward()
  })
  host.querySelector('[data-role="reload"]').addEventListener('click', () => {
    if (current && ready) frame.reload()
  })
  host.querySelector('[data-role="external"]').addEventListener('click', () => {
    if (current) window.w20.openPath(current)
  })

  frame.addEventListener('did-start-loading', () => win.setBadge('зарежда', ''))
  frame.addEventListener('did-stop-loading', () => {
    if (fail.hidden) win.setBadge('')
    try {
      const at = frame.getURL()
      if (at && at !== 'about:blank') {
        current = at
        if (document.activeElement !== box) box.value = at
        if (onChange) onChange(at)
      }
    } catch {
      // the guest is gone — nothing worth reporting
    }
  })
  frame.addEventListener('page-title-updated', (e) => {
    if (e.title) win.setTitle(e.title)
  })
  frame.addEventListener('did-fail-load', (e) => {
    // -3 is an aborted load, which every redirect produces.
    if (e.errorCode === -3 || !e.isMainFrame) return
    showFail(e.errorDescription || `код ${e.errorCode}`)
  })

  win.body.appendChild(host)

  return {
    focus: () => (current ? frame.focus() : box.focus()),
    /** Used by the editor window, which only learns its address once the server is up. */
    load: go,
    setNotice: (text) => {
      fail.hidden = !text
      fail.textContent = text || ''
    },
    destroy: () => host.remove()
  }
}
