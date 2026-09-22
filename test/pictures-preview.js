'use strict'
// Paints every picture style once and writes them out as PNGs, to look at.
// Usage: xvfb-run -a electron --no-sandbox test/pictures-preview.js <outdir> [width]
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow } = require('electron')
const out = process.argv[process.argv.length - 2]
const width = Number(process.argv[process.argv.length - 1]) || 1920
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: false } })
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).catch(() => {})
  const url = 'file://' + path.join(__dirname, '..', 'src', 'renderer', 'pictures.js')
  const results = await win.webContents.executeJavaScript(`(async () => {
    const m = await import(${JSON.stringify(url)})
    const out = []
    for (const s of m.STYLES) {
      for (const seed of [11, 202]) {
        const c = document.createElement('canvas')
        c.width = ${width}; c.height = Math.round(${width} * 9 / 16)
        const t0 = performance.now()
        const accent = m.paint(c.getContext('2d'), c.width, c.height, s.id, seed)
        out.push({ name: s.id + '-' + seed, ms: Math.round(performance.now() - t0), accent, data: c.toDataURL('image/jpeg', 0.9) })
      }
    }
    return out
  })()`)
  for (const r of results) {
    fs.writeFileSync(path.join(out, r.name + '.jpg'), Buffer.from(r.data.split(',')[1], 'base64'))
    console.log(r.name, r.ms + 'ms', r.accent)
  }
  app.exit(0)
})
