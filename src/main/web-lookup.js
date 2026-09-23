'use strict'

/**
 * The internet, for an agent that has none of its own.
 *
 * Genesis's chat API is a model and nothing else: no browser, no clock. When
 * it asks the station to look something up, the main process does the fetch —
 * the renderer's page is locked down, and the key-free DuckDuckGo HTML page
 * needs no account — and hands back plain text: titles, links and snippets,
 * or a page with its markup stripped. Text only, capped, so a page cannot
 * flood the conversation or carry markup into it.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

function decode(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

async function get(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'bg,en;q=0.8' },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`отговор ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/** DuckDuckGo wraps each link in its own redirect; the real address is `uddg`. */
function unwrap(href) {
  try {
    const url = new URL(decode(href), 'https://duckduckgo.com')
    return url.searchParams.get('uddg') || url.href
  } catch {
    return ''
  }
}

async function lookup(query) {
  const q = String(query || '').trim().slice(0, 300)
  if (!q) return { ok: false, error: 'Няма какво да търся.' }
  try {
    const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`)
    const results = []
    const block = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|(?=<a[^>]+class="result__a"))/g
    let m
    while ((m = block.exec(html)) && results.length < 6) {
      const url = unwrap(m[1])
      // Ads go through DuckDuckGo's own y.js; they are not results.
      if (!url || /duckduckgo\.com\/y\.js/.test(url)) continue
      results.push({ title: decode(m[2]), url, snippet: decode(m[3] || '') })
    }
    if (!results.length) return { ok: false, error: 'Търсенето не върна резултати.' }
    return { ok: true, query: q, results }
  } catch (err) {
    return { ok: false, error: `Търсенето не успя: ${err.name === 'AbortError' ? 'няма отговор' : err.message}` }
  }
}

async function read(address) {
  let url
  try {
    url = new URL(String(address || '').trim())
    if (!/^https?:$/.test(url.protocol)) throw new Error()
  } catch {
    return { ok: false, error: 'Това не е уеб адрес.' }
  }
  try {
    const html = await get(url.href)
    const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')
    const text = decode(
      html
        .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(p|div|li|h\d|tr|br)>/gi, '\n')
    ).slice(0, 6000)
    return { ok: true, url: url.href, title, text }
  } catch (err) {
    return { ok: false, error: `Страницата не се отвори: ${err.name === 'AbortError' ? 'няма отговор' : err.message}` }
  }
}

module.exports = { lookup, read }
