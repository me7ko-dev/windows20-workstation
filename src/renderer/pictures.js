/**
 * Pictures for the stations, painted rather than shipped.
 *
 * Every station gets its own picture: a style and a seed. The same pair always
 * paints the same picture, so nothing but two small numbers is saved, and a
 * new station never looks like the one before it. Painted at 3840×2160 — a 4K
 * screen gets a pixel for every pixel, and nothing in the repo weighs a
 * megabyte.
 *
 * Everything here is plain 2D canvas and runs the same in a worker (where the
 * real pictures are painted, so the desktop never stutters) and on the page.
 */

export const STYLES = [
  { id: 'peaks', label: 'Върхове' },
  { id: 'aurora', label: 'Сияние' },
  { id: 'nebula', label: 'Мъглявина' },
  { id: 'dunes', label: 'Дюни' },
  { id: 'ocean', label: 'Океан' },
  { id: 'synth', label: 'Синтуейв' },
  { id: 'orbs', label: 'Стъкло' },
  { id: 'city', label: 'Нощен град' },
  { id: 'forest', label: 'Гора в мъгла' },
  { id: 'lake', label: 'Езеро' }
]

export const FULL = { width: 3840, height: 2160 }
export const THUMB = { width: 640, height: 360 }

/* ------------------------------------------------------------- helpers */

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (r, list) => list[Math.floor(r() * list.length)]

function hex(c) {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a, b, t) {
  const x = hex(a)
  const y = hex(b)
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t))
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function rgba(c, alpha) {
  const [r, g, b] = hex(c)
  return `rgba(${r},${g},${b},${alpha})`
}

function vertical(ctx, h, stops, y0 = 0, y1 = h) {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  stops.forEach(([at, color]) => g.addColorStop(at, color))
  return g
}

function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(color, alpha))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** A mountain line by midpoint displacement: jagged near, soft far. */
function ridgeLine(r, count, rough) {
  const n = 2 ** count + 1
  const pts = new Float32Array(n)
  pts[0] = r() - 0.5
  pts[n - 1] = r() - 0.5
  let step = n - 1
  let amp = 1
  while (step > 1) {
    const half = step / 2
    for (let i = half; i < n; i += step) {
      pts[i] = (pts[i - half] + pts[i + half]) / 2 + (r() - 0.5) * amp
    }
    amp *= rough
    step = half
  }
  return pts
}

function fillRidge(ctx, w, h, pts, base, amp, color) {
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let i = 0; i < pts.length; i += 1) ctx.lineTo((i / (pts.length - 1)) * w, base - pts[i] * amp)
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function stars(ctx, r, w, h, count, maxY, s, tint = '#ffffff') {
  for (let i = 0; i < count; i += 1) {
    const x = r() * w
    const y = r() ** 1.4 * maxY
    const big = r() > 0.985
    const size = (big ? 1.6 + r() * 1.6 : 0.5 + r() * 1.1) * s * 2
    ctx.fillStyle = rgba(tint, (big ? 0.9 : 0.25 + r() * 0.55) * (1 - y / maxY / 1.4))
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
    if (big) glow(ctx, x, y, size * 8, tint, 0.18)
  }
}

/** Film grain from a small tile, so a 4K picture costs a 256² loop. */
function grain(ctx, w, h, r, strength) {
  const size = 256
  const tile = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas')
  tile.width = size
  tile.height = size
  const t = tile.getContext('2d')
  const img = t.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(r() * 255)
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = Math.floor(strength * 255)
  }
  t.putImageData(img, 0, 0)
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

function vignette(ctx, w, h, alpha) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(0,0,0,${alpha})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function layer(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/* -------------------------------------------------------------- styles */

const PAINTERS = {
  peaks(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#0f1033', '#4b2a6b', '#f08a5d'], sun: '#ffd29a', far: '#8d6aa0', near: '#120c22', accent: '#ffb37a' },
      { sky: ['#06182c', '#1d4e7a', '#9cc9e6'], sun: '#ffffff', far: '#6f9cc0', near: '#07121f', accent: '#7cc7ff' },
      { sky: ['#1a0f24', '#8a3f62', '#ffc3a0'], sun: '#fff0d6', far: '#b27a91', near: '#1b0d1c', accent: '#ff9fb2' },
      { sky: ['#041612', '#1b5b4d', '#a8e0c2'], sun: '#f4fff4', far: '#5b9c86', near: '#04120e', accent: '#6ee7b7' }
    ])
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [0.42, p.sky[1]], [0.64, p.sky[2]]])
    ctx.fillRect(0, 0, w, h)
    stars(ctx, r, w, h, 900, h * 0.4, s)
    const sx = w * (0.25 + r() * 0.5)
    const sy = h * (0.4 + r() * 0.1)
    glow(ctx, sx, sy, 900 * s, p.sun, 0.45)
    glow(ctx, sx, sy, 260 * s, p.sun, 0.9)
    ctx.fillStyle = p.sun
    ctx.beginPath()
    ctx.arc(sx, sy, 70 * s, 0, Math.PI * 2)
    ctx.fill()
    const layers = 6
    for (let i = 0; i < layers; i += 1) {
      const t = i / (layers - 1)
      const pts = ridgeLine(r, 10, 0.52 + t * 0.06)
      const hazed = mix(mix(p.sky[2], p.far, 0.35 + t * 0.65), p.near, t ** 0.9)
      fillRidge(ctx, w, h, pts, h * (0.64 + t * 0.24), h * (0.2 - t * 0.06), hazed)
      // Haze between ranges: what makes distance read as distance.
      ctx.fillStyle = vertical(ctx, h, [[0, rgba(p.sky[2], 0)], [1, rgba(p.sky[2], 0.16 * (1 - t))]], h * (0.5 + t * 0.2), h)
      ctx.fillRect(0, h * (0.5 + t * 0.2), w, h)
    }
    vignette(ctx, w, h, 0.35)
    return p.accent
  },

  aurora(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#01040c', '#06182a', '#0c2f3a'], a: '#46ffb0', b: '#8a5cff', accent: '#46ffb0' },
      { sky: ['#03020c', '#140a2a', '#2a1440'], a: '#ff5fd2', b: '#46c8ff', accent: '#ff7ad9' },
      { sky: ['#010608', '#062224', '#0b3a36'], a: '#b6ff5c', b: '#34e0ff', accent: '#9dff6e' }
    ])
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [0.6, p.sky[1]], [1, p.sky[2]]])
    ctx.fillRect(0, 0, w, h)
    stars(ctx, r, w, h, 1400, h * 0.7, s)

    const curtain = layer(w, h)
    const c = curtain.getContext('2d')
    c.globalCompositeOperation = 'lighter'
    for (let band = 0; band < 4; band += 1) {
      const base = h * (0.28 + band * 0.07 + r() * 0.05)
      const f1 = 0.0006 + r() * 0.0008
      const f2 = 0.002 + r() * 0.002
      const ph = r() * 10
      const tall = h * (0.18 + r() * 0.16)
      for (let x = 0; x < w; x += 3 * s) {
        const y = base + Math.sin(x * f1 / s + ph) * h * 0.08 + Math.sin(x * f2 / s + ph * 2) * h * 0.02
        const len = tall * (0.5 + 0.5 * Math.sin(x * f2 * 1.7 / s + ph) ** 2)
        // Rays: the curtain is brighter in thin vertical streaks.
        const ray = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.031 / s + ph) * Math.sin(x * 0.0113 / s + band))
        const fade = 0.55 + 0.45 * Math.sin(x * f1 * 2.1 / s + ph * 3)
        const k = ray * fade
        const g = c.createLinearGradient(0, y - len, 0, y)
        g.addColorStop(0, rgba(p.b, 0))
        g.addColorStop(0.55, rgba(p.b, 0.07 * k))
        g.addColorStop(0.9, rgba(p.a, 0.24 * k))
        g.addColorStop(1, rgba(p.a, 0))
        c.fillStyle = g
        c.fillRect(x, y - len, 3 * s + 1, len)
      }
    }
    ctx.save()
    ctx.filter = `blur(${Math.round(10 * s)}px)`
    ctx.drawImage(curtain, 0, 0)
    ctx.restore()
    ctx.drawImage(curtain, 0, 0)

    const horizon = h * 0.72
    fillRidge(ctx, w, h, ridgeLine(r, 10, 0.55), horizon - h * 0.04, h * 0.22, '#050d14')
    fillRidge(ctx, w, h, ridgeLine(r, 10, 0.5), horizon, h * 0.1, '#02060a')
    // The lake: the sky again, upside down and darker.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, horizon + h * 0.03, w, h)
    ctx.clip()
    ctx.translate(0, (horizon + h * 0.03) * 2)
    ctx.scale(1, -1)
    ctx.globalAlpha = 0.28
    ctx.drawImage(curtain, 0, 0)
    ctx.restore()
    ctx.fillStyle = vertical(ctx, h, [[0, 'rgba(1,4,8,0.35)'], [1, 'rgba(1,4,8,0.9)']], horizon, h)
    ctx.fillRect(0, horizon + h * 0.03, w, h)
    vignette(ctx, w, h, 0.4)
    return p.accent
  },

  nebula(ctx, w, h, r, s) {
    const p = pick(r, [
      { cols: ['#ff4d8d', '#7b5cff', '#2ad4ff'], accent: '#b28cff' },
      { cols: ['#ff8a3d', '#ff3d6e', '#5a2dff'], accent: '#ff8a5c' },
      { cols: ['#2affc6', '#2a8cff', '#9d4dff'], accent: '#4de8ff' }
    ])
    ctx.fillStyle = '#020309'
    ctx.fillRect(0, 0, w, h)
    const cloud = layer(Math.round(w / 4), Math.round(h / 4))
    const c = cloud.getContext('2d')
    c.globalCompositeOperation = 'lighter'
    const cx = w / 4 * (0.3 + r() * 0.4)
    const cy = h / 4 * (0.35 + r() * 0.3)
    for (let i = 0; i < 70; i += 1) {
      const a = r() * Math.PI * 2
      const d = r() ** 0.7 * w / 4 * 0.45
      const x = cx + Math.cos(a) * d * 1.4
      const y = cy + Math.sin(a) * d * 0.6
      const rad = (40 + r() * 170) * s
      const g = c.createRadialGradient(x, y, 0, x, y, rad)
      const col = pick(r, p.cols)
      g.addColorStop(0, rgba(col, 0.1 + r() * 0.12))
      g.addColorStop(1, rgba(col, 0))
      c.fillStyle = g
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    ctx.save()
    ctx.imageSmoothingQuality = 'high'
    ctx.filter = `blur(${Math.round(18 * s)}px)`
    ctx.drawImage(cloud, 0, 0, w, h)
    ctx.restore()
    // Dark dust lanes through the glow.
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    for (let i = 0; i < 14; i += 1) glow(ctx, r() * w, r() * h, (200 + r() * 500) * s, '#000000', 0.35)
    ctx.restore()
    stars(ctx, r, w, h, 3500, h, s)
    // A planet in the corner, lit from the nebula's side.
    if (r() > 0.35) {
      const pr = (260 + r() * 260) * s
      const px = r() > 0.5 ? w * 0.82 : w * 0.16
      const py = h * (0.72 + r() * 0.1)
      const body = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr)
      body.addColorStop(0, mix(p.cols[1], '#ffffff', 0.25))
      body.addColorStop(0.55, mix(p.cols[1], '#05060c', 0.6))
      body.addColorStop(1, '#030409')
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(px, py, pr, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgba(p.cols[2], 0.35)
      ctx.lineWidth = 6 * s
      ctx.beginPath()
      ctx.arc(px, py, pr + 3 * s, Math.PI * 0.9, Math.PI * 1.65)
      ctx.stroke()
    }
    vignette(ctx, w, h, 0.5)
    return p.accent
  },

  dunes(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#1d2a52', '#e58a5c', '#ffd1a1'], sand: ['#e0935a', '#9b4a2e', '#3a1a14'], accent: '#ffb46e' },
      { sky: ['#0d1330', '#5a3b7a', '#f2a3b3'], sand: ['#c88aa0', '#6d3a5c', '#1e1024'], accent: '#ff9fc4' },
      { sky: ['#5fa0d6', '#a9d1ec', '#f4e6cf'], sand: ['#f1c68c', '#c7874c', '#6b3c20'], accent: '#ffc46b' }
    ])
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [0.45, p.sky[1]], [0.62, p.sky[2]]])
    ctx.fillRect(0, 0, w, h)
    const sx = w * (0.2 + r() * 0.6)
    glow(ctx, sx, h * 0.55, 800 * s, p.sky[2], 0.6)
    ctx.fillStyle = mix(p.sky[2], '#ffffff', 0.6)
    ctx.beginPath()
    ctx.arc(sx, h * 0.55, 90 * s, 0, Math.PI * 2)
    ctx.fill()
    const n = 6
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1)
      const base = h * (0.58 + t * 0.34)
      const amp = h * (0.05 + t * 0.06)
      const f = (0.0008 + r() * 0.0012) / s
      const ph = r() * 10
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 8 * s) {
        const y = base - Math.abs(Math.sin(x * f + ph)) ** 1.6 * amp - Math.sin(x * f * 2.3 + ph) * amp * 0.25
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const top = mix(p.sand[0], p.sky[2], 0.4 * (1 - t))
      ctx.fillStyle = vertical(ctx, h, [[0, mix(top, p.sand[1], t * 0.5)], [1, mix(p.sand[1], p.sand[2], t)]], base - amp, base + h * 0.2)
      ctx.fill()
    }
    grain(ctx, w, h, r, 0.05)
    vignette(ctx, w, h, 0.3)
    return p.accent
  },

  ocean(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#0b1d3a', '#3f5e96', '#f7b47a'], sea: ['#1d3a63', '#081527'], sun: '#ffe2b3', accent: '#ffc78a' },
      { sky: ['#02030a', '#0b1030', '#1d2a55'], sea: ['#0c1a38', '#02050c'], sun: '#f4f6ff', accent: '#9ab8ff' },
      { sky: ['#2a0f2f', '#b24d6b', '#ffb07a'], sea: ['#4a1d3a', '#120814'], sun: '#fff0cf', accent: '#ff9b8a' }
    ])
    const horizon = h * (0.56 + r() * 0.06)
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [0.7, p.sky[1]], [1, p.sky[2]]], 0, horizon)
    ctx.fillRect(0, 0, w, horizon)
    stars(ctx, r, w, h, 600, horizon * 0.6, s)
    const sx = w * (0.3 + r() * 0.4)
    const sy = horizon - h * (0.04 + r() * 0.1)
    glow(ctx, sx, sy, 900 * s, p.sun, 0.35)
    ctx.fillStyle = p.sun
    ctx.beginPath()
    ctx.arc(sx, sy, 80 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = vertical(ctx, h, [[0, p.sea[0]], [1, p.sea[1]]], horizon, h)
    ctx.fillRect(0, horizon, w, h - horizon)
    // The path of light on the water, in broken strokes.
    for (let i = 0; i < 900; i += 1) {
      const t = r()
      const y = horizon + t ** 1.8 * (h - horizon)
      const spread = (40 + t * 700) * s
      const x = sx + (r() - 0.5) * spread * 2
      const len = (10 + r() * 60) * s * (0.4 + t)
      ctx.fillStyle = rgba(p.sun, 0.12 + (1 - t) * 0.35)
      ctx.fillRect(x - len / 2, y, len, Math.max(1, 2 * s * (0.4 + t)))
    }
    for (let i = 0; i < 160; i += 1) {
      const t = r()
      const y = horizon + t ** 1.5 * (h - horizon)
      ctx.strokeStyle = rgba('#ffffff', 0.03 + t * 0.05)
      ctx.lineWidth = s * (1 + t * 2)
      ctx.beginPath()
      const x = r() * w
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + 120 * s, y - 6 * s * t, x + 260 * s * (0.5 + t), y)
      ctx.stroke()
    }
    vignette(ctx, w, h, 0.35)
    return p.accent
  },

  synth(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#0b0221', '#2d0b4e', '#ff3c8e'], sun: ['#ffe45e', '#ff3c8e'], grid: '#ff3cf2', accent: '#ff5ad7' },
      { sky: ['#01061a', '#0a2b55', '#28d7ff'], sun: ['#fff27a', '#ff4fa3'], grid: '#28d7ff', accent: '#4de2ff' }
    ])
    const horizon = h * 0.62
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [0.75, p.sky[1]], [1, p.sky[2]]], 0, horizon)
    ctx.fillRect(0, 0, w, horizon)
    stars(ctx, r, w, h, 700, horizon * 0.7, s)
    const sx = w / 2
    const sy = horizon - h * 0.12
    const sr = h * 0.2
    glow(ctx, sx, sy, sr * 2.2, p.sun[1], 0.5)
    ctx.save()
    ctx.beginPath()
    ctx.arc(sx, sy, sr, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = vertical(ctx, h, [[0, p.sun[0]], [1, p.sun[1]]], sy - sr, sy + sr)
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2)
    ctx.fillStyle = p.sky[1]
    for (let i = 0; i < 9; i += 1) {
      const y = sy + sr * (0.05 + i * 0.11)
      ctx.fillRect(sx - sr, y, sr * 2, sr * 0.012 * (i + 2))
    }
    ctx.restore()
    fillRidge(ctx, w, h, ridgeLine(r, 9, 0.5), horizon, h * 0.1, '#12022a')
    ctx.fillStyle = '#07010f'
    ctx.fillRect(0, horizon, w, h - horizon)
    ctx.strokeStyle = rgba(p.grid, 0.75)
    ctx.shadowColor = p.grid
    ctx.shadowBlur = 18 * s
    ctx.lineWidth = 3 * s
    for (let i = -24; i <= 24; i += 1) {
      ctx.beginPath()
      ctx.moveTo(sx + i * 40 * s, horizon)
      ctx.lineTo(sx + i * 520 * s, h)
      ctx.stroke()
    }
    for (let i = 1; i < 16; i += 1) {
      const y = horizon + (h - horizon) * (i / 16) ** 2.2
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
    ctx.fillStyle = vertical(ctx, h, [[0, rgba(p.sky[2], 0.35)], [1, rgba(p.sky[2], 0)]], horizon, horizon + h * 0.12)
    ctx.fillRect(0, horizon, w, h * 0.12)
    vignette(ctx, w, h, 0.4)
    return p.accent
  },

  orbs(ctx, w, h, r, s) {
    const p = pick(r, [
      { bg: ['#0a0c1a', '#141a33'], cols: ['#5b6cff', '#ff5fa2', '#39d5ff', '#8a4dff'], accent: '#8c9bff' },
      { bg: ['#07110f', '#0d1f1c'], cols: ['#27e0a3', '#2aa7ff', '#b4ff5c', '#00c2a8'], accent: '#3cf0b4' },
      { bg: ['#140a07', '#22110b'], cols: ['#ff7a3d', '#ffcc4d', '#ff3d6e', '#ff9f5a'], accent: '#ffa35c' }
    ])
    ctx.fillStyle = vertical(ctx, h, [[0, p.bg[0]], [1, p.bg[1]]])
    ctx.fillRect(0, 0, w, h)
    const soft = layer(Math.round(w / 4), Math.round(h / 4))
    const c = soft.getContext('2d')
    for (let i = 0; i < 7; i += 1) {
      const x = r() * soft.width
      const y = r() * soft.height
      const rad = (120 + r() * 260) * s
      const g = c.createRadialGradient(x, y, 0, x, y, rad)
      const col = p.cols[i % p.cols.length]
      g.addColorStop(0, rgba(col, 0.85))
      g.addColorStop(1, rgba(col, 0))
      c.fillStyle = g
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    ctx.save()
    ctx.filter = `blur(${Math.round(60 * s)}px)`
    ctx.globalAlpha = 0.9
    ctx.drawImage(soft, 0, 0, w, h)
    ctx.restore()
    // A few glass ribbons over the colour.
    for (let i = 0; i < 3; i += 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = (120 + r() * 200) * s
      ctx.beginPath()
      const y = h * r()
      ctx.moveTo(-100, y)
      ctx.bezierCurveTo(w * 0.3, y - h * 0.4 * r(), w * 0.6, y + h * 0.4 * r(), w + 100, y - h * 0.2)
      ctx.stroke()
    }
    grain(ctx, w, h, r, 0.08)
    return p.accent
  },

  city(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#030512', '#0c1638', '#2c3f7a'], lit: '#ffd28a', glow: '#ff7eb6', accent: '#ffc56e' },
      { sky: ['#05030e', '#1d0b33', '#57206b'], lit: '#7af0ff', glow: '#ff4fd8', accent: '#7af0ff' }
    ])
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [0.65, p.sky[1]], [1, p.sky[2]]])
    ctx.fillRect(0, 0, w, h)
    stars(ctx, r, w, h, 500, h * 0.45, s)
    const mx = w * (0.1 + r() * 0.8)
    glow(ctx, mx, h * 0.18, 380 * s, '#dfe8ff', 0.25)
    ctx.fillStyle = '#eef2ff'
    ctx.beginPath()
    ctx.arc(mx, h * 0.18, 70 * s, 0, Math.PI * 2)
    ctx.fill()
    glow(ctx, w / 2, h, w * 0.6, p.glow, 0.25)
    const rows = 3
    for (let row = 0; row < rows; row += 1) {
      const t = row / (rows - 1)
      const ground = h * (0.8 + t * 0.2)
      let x = -20 * s
      const body = mix('#1a2140', '#05060c', t)
      while (x < w) {
        const bw = (70 + r() * 160) * s * (1 + t * 0.6)
        const bh = h * (0.12 + r() * (0.35 - t * 0.12))
        const top = ground - bh
        ctx.fillStyle = body
        ctx.fillRect(x, top, bw, bh + 2)
        if (r() > 0.7) ctx.fillRect(x + bw * 0.4, top - bh * 0.08, 4 * s, bh * 0.08)
        const cw = 10 * s * (1 + t * 0.5)
        for (let wy = top + cw; wy < ground - cw; wy += cw * 2) {
          for (let wx = x + cw * 0.6; wx < x + bw - cw; wx += cw * 1.7) {
            if (r() > 0.72) {
              ctx.fillStyle = rgba(p.lit, 0.35 + r() * 0.6 * (0.4 + t))
              ctx.fillRect(wx, wy, cw * 0.8, cw)
            }
          }
        }
        x += bw + r() * 12 * s
      }
      ctx.fillStyle = vertical(ctx, h, [[0, rgba(p.sky[2], 0)], [1, rgba(p.glow, 0.08 * (1 - t))]], h * 0.5, ground)
      ctx.fillRect(0, h * 0.5, w, ground - h * 0.5)
    }
    vignette(ctx, w, h, 0.4)
    return p.accent
  },

  forest(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#c9d6d2', '#8fa7a4'], tree: ['#7f9894', '#0d1a18'], light: '#fff6dc', accent: '#9fe0c8' },
      { sky: ['#1a2030', '#3d4a5c'], tree: ['#3e4b5b', '#06090e'], light: '#cfe0ff', accent: '#9ab8ff' },
      { sky: ['#e8c9a6', '#b88f78'], tree: ['#a07d6d', '#1c100c'], light: '#fff0d2', accent: '#ffc09a' }
    ])
    ctx.fillStyle = vertical(ctx, h, [[0, p.sky[0]], [1, p.sky[1]]])
    ctx.fillRect(0, 0, w, h)
    const lx = w * (0.2 + r() * 0.6)
    glow(ctx, lx, h * 0.1, 900 * s, p.light, 0.5)
    const layers = 6
    for (let i = 0; i < layers; i += 1) {
      const t = i / (layers - 1)
      const color = mix(p.tree[0], p.tree[1], t ** 0.9)
      const ground = h * (0.6 + t * 0.35)
      ctx.fillStyle = color
      ctx.fillRect(0, ground, w, h - ground)
      let x = -50 * s
      while (x < w + 50 * s) {
        const th = h * (0.18 + r() * 0.22) * (0.7 + t * 0.6)
        const tw = th * (0.22 + r() * 0.08)
        const top = ground - th
        ctx.beginPath()
        const tiers = 7
        for (let k = 0; k < tiers; k += 1) {
          const ty = top + (th * k) / tiers
          const half = (tw / 2) * ((k + 1) / tiers)
          ctx.moveTo(x, ty)
          ctx.lineTo(x - half, ty + th / tiers * 1.6)
          ctx.lineTo(x + half, ty + th / tiers * 1.6)
          ctx.closePath()
        }
        ctx.fill()
        ctx.fillRect(x - tw * 0.03, ground - th * 0.1, tw * 0.06, th * 0.12)
        x += tw * (0.35 + r() * 0.6)
      }
      ctx.fillStyle = vertical(ctx, h, [[0, rgba(p.sky[1], 0)], [1, rgba(p.sky[0], 0.3 * (1 - t))]], ground - h * 0.3, ground)
      ctx.fillRect(0, ground - h * 0.3, w, h * 0.3)
    }
    // Light through the canopy.
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 6; i += 1) {
      const x0 = lx + (r() - 0.5) * 300 * s
      const spread = (200 + r() * 400) * s
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, rgba(p.light, 0.12))
      g.addColorStop(1, rgba(p.light, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(x0, 0)
      ctx.lineTo(x0 + spread * (r() - 0.3) * 3, h)
      ctx.lineTo(x0 + spread * (r() - 0.3) * 3 + spread, h)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    grain(ctx, w, h, r, 0.04)
    return p.accent
  },

  lake(ctx, w, h, r, s) {
    const p = pick(r, [
      { sky: ['#162447', '#e4a5a0', '#fde2c4'], far: '#6c6c93', near: '#141526', accent: '#ffb8a8' },
      { sky: ['#0a1a2f', '#3a6f9a', '#bfe3f2'], far: '#4b6f8a', near: '#08121c', accent: '#8fd4ff' },
      { sky: ['#1b1330', '#6a4c93', '#f2b5d4'], far: '#7a5b8f', near: '#140c1e', accent: '#e6a8ff' }
    ])
    const horizon = h * (0.58 + r() * 0.06)
    const sky = layer(w, Math.ceil(horizon))
    const c = sky.getContext('2d')
    c.fillStyle = vertical(c, horizon, [[0, p.sky[0]], [0.7, p.sky[1]], [1, p.sky[2]]])
    c.fillRect(0, 0, w, horizon)
    stars(c, r, w, horizon, 500, horizon * 0.5, s)
    glow(c, w * (0.3 + r() * 0.4), horizon * 0.95, 700 * s, p.sky[2], 0.5)
    fillRidge(c, w, horizon, ridgeLine(r, 10, 0.55), horizon * 0.86, horizon * 0.3, p.far)
    fillRidge(c, w, horizon, ridgeLine(r, 10, 0.5), horizon * 0.97, horizon * 0.14, mix(p.far, p.near, 0.6))
    ctx.drawImage(sky, 0, 0)
    // Still water: the whole picture above, mirrored and cooled.
    ctx.save()
    ctx.translate(0, horizon * 2)
    ctx.scale(1, -1)
    ctx.globalAlpha = 0.7
    ctx.drawImage(sky, 0, 0)
    ctx.restore()
    ctx.fillStyle = vertical(ctx, h, [[0, rgba(p.near, 0.25)], [1, rgba(p.near, 0.85)]], horizon, h)
    ctx.fillRect(0, horizon, w, h - horizon)
    for (let i = 0; i < 220; i += 1) {
      const t = r()
      const y = horizon + t ** 1.6 * (h - horizon)
      ctx.fillStyle = rgba('#ffffff', 0.02 + t * 0.05)
      ctx.fillRect(r() * w, y, (60 + r() * 300) * s, Math.max(1, s * 2))
    }
    vignette(ctx, w, h, 0.35)
    return p.accent
  }
}

/**
 * Paint one picture into a 2D context that is already `width`×`height`.
 * Returns the accent the rest of the station should take from it.
 */
export function paint(ctx, width, height, style, seed) {
  const painter = PAINTERS[style] || PAINTERS.peaks
  const r = rng(seed)
  const s = width / FULL.width
  ctx.save()
  const accent = painter(ctx, width, height, r, s)
  ctx.restore()
  return accent
}

/** The accent alone, without painting — the same draw of the dice. */
export function accentOf(style, seed) {
  const probe = layer(8, 8).getContext('2d')
  return paint(probe, 8, 8, style, seed)
}

export function randomPicture(except) {
  let style
  do style = STYLES[Math.floor(Math.random() * STYLES.length)].id
  while (except && style === except && STYLES.length > 1)
  return { style, seed: Math.floor(Math.random() * 2 ** 31) }
}
