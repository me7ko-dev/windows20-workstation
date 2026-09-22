/**
 * Where painted pictures are kept.
 *
 * A picture is painted once and then read back: from memory while this window
 * is open, from IndexedDB after a restart. Thumbnails for the overview are
 * painted small on purpose — ten decoded 4K pictures would be a third of a
 * gigabyte for tiles the size of a postcard.
 */

import { FULL, THUMB } from './pictures.js'

const DB_NAME = 'w20-pictures'
const STORE = 'blobs'

let dbPromise = null
function db() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function readBlob(key) {
  const store = await db()
  if (!store) return null
  return new Promise((resolve) => {
    try {
      const request = store.transaction(STORE).objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function writeBlob(key, value) {
  const store = await db()
  if (!store) return
  try {
    store.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
  } catch {
    // a full disk costs a repaint next time, nothing more
  }
}

let worker = null
let seq = 0
const waiting = new Map()

function paintInWorker(picture, size) {
  if (!worker) {
    worker = new Worker(new URL('./pictures-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const done = waiting.get(e.data.id)
      if (!done) return
      waiting.delete(e.data.id)
      done(e.data)
    }
  }
  seq += 1
  const id = seq
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker.postMessage({ id, style: picture.style, seed: picture.seed, width: size.width, height: size.height })
  })
}

const urls = new Map() // key -> Promise<{ url, accent }>
const FULL_KEPT = 2
const fullOrder = []

function keyOf(picture, size) {
  return `${picture.style}:${picture.seed}:${size.width}`
}

function load(picture, size) {
  const key = keyOf(picture, size)
  if (urls.has(key)) return urls.get(key)
  const promise = (async () => {
    const cached = await readBlob(key)
    if (cached && cached.blob) return { url: URL.createObjectURL(cached.blob), accent: cached.accent }
    const result = await paintInWorker(picture, size)
    if (!result.ok) return null
    writeBlob(key, { blob: result.blob, accent: result.accent })
    return { url: URL.createObjectURL(result.blob), accent: result.accent }
  })()
  urls.set(key, promise)

  // Full pictures are big once decoded: only the last couple stay in memory.
  if (size === FULL) {
    fullOrder.push(key)
    while (fullOrder.length > FULL_KEPT) {
      const old = fullOrder.shift()
      const entry = urls.get(old)
      urls.delete(old)
      if (entry) entry.then((r) => r && setTimeout(() => URL.revokeObjectURL(r.url), 2000))
    }
  }
  return promise
}

export const pictures = {
  full: (picture) => load(picture, FULL),
  thumb: (picture) => load(picture, THUMB)
}
