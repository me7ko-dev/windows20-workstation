'use strict'

const dns = require('dns')

/**
 * The network, on a laptop whose DNS is slow.
 *
 * On this machine a name the Windows cache has forgotten can take 11–12
 * seconds to look up, and Node's fetch gives up connecting after 10 — so the
 * first voice command after a few quiet minutes failed with a bare
 * "fetch failed", and the same command a moment later worked. Two things
 * answer that: the names are looked up as soon as the microphone opens, while
 * the user is still talking, and a request that never reached the service is
 * sent once more.
 */

const pending = new Map() // host -> Promise

/** Look the hosts up now, so the request after this finds them cached. */
function warm(urls) {
  for (const url of urls || []) {
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      continue
    }
    if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || pending.has(host)) continue
    const done = new Promise((resolve) => dns.lookup(host, { all: true }, () => resolve()))
    pending.set(host, done)
    done.then(() => pending.delete(host))
  }
}

/** Did the request fail before the service answered — the network, not the service? */
function isNetworkError(err) {
  return Boolean(err) && err.name !== 'AbortError' && (err.name === 'TypeError' || Boolean(err.cause && err.cause.code))
}

/** fetch, sent once more if it never got through. */
async function fetchRetry(url, init = {}) {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (!isNetworkError(err) || (init.signal && init.signal.aborted)) throw err
    // The lookup that timed out is usually done a moment later.
    await new Promise((resolve) => setTimeout(resolve, 700))
    if (init.signal && init.signal.aborted) throw err
    return fetch(url, init)
  }
}

/** Why it never got through, in words — "fetch failed" says nothing. */
function whyOffline(err) {
  const code = (err && err.cause && err.cause.code) || (err && err.code) || ''
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'връзката се бави над 10 секунди (бавен интернет или DNS) — опитай пак'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'адресът не се намира — има ли интернет?'
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'ECONNREFUSED') return 'връзката прекъсна — опитай пак'
  if (err && err.name === 'AbortError') return 'не отговори навреме'
  const message = (err && err.message) || ''
  return message === 'fetch failed' ? 'няма интернет връзка' : message || 'няма интернет връзка'
}

module.exports = { warm, fetchRetry, whyOffline, isNetworkError }
