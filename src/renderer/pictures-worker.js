/**
 * Paints station pictures off the main thread. A 4K picture takes long
 * enough that painting it on the page would stall the canvas for a moment
 * every time a new station is made.
 */
import { paint } from './pictures.js'

self.onmessage = async (e) => {
  const { id, style, seed, width, height, quality } = e.data
  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    const accent = paint(ctx, width, height, style, seed)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality || 0.93 })
    self.postMessage({ id, ok: true, blob, accent })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) })
  }
}
