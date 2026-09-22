/**
 * The four fields of a station.
 *
 * A station is at most four fields, and a field holds at most four windows.
 * Only the fields in use take space: one field fills the screen, two split it,
 * four make a two-by-two. Inside a field it is the same again. Nothing overlaps
 * and nothing is scaled, which is what keeps text sharp: every window is laid
 * out at exactly one CSS pixel per pixel.
 *
 * These are pure functions over the model, so the overview draws each station
 * with the same arithmetic the station itself uses — only smaller.
 */

export const FIELDS = 4
export const SLOTS = 4
export const CAPACITY = FIELDS * SLOTS

/** Split a rectangle into `count` parts: 1, 2 side by side, 3 as one + two, 4 as 2×2. */
export function split(rect, count, gap) {
  const { x, y, width: w, height: h } = rect
  if (count <= 1) return [rect]
  const wide = w >= h
  if (count === 2) {
    if (wide) {
      const half = (w - gap) / 2
      return [
        { x, y, width: half, height: h },
        { x: x + half + gap, y, width: w - half - gap, height: h }
      ]
    }
    const half = (h - gap) / 2
    return [
      { x, y, width: w, height: half },
      { x, y: y + half + gap, width: w, height: h - half - gap }
    ]
  }
  if (count === 3) {
    if (wide) {
      const half = (w - gap) / 2
      const halfH = (h - gap) / 2
      return [
        { x, y, width: half, height: h },
        { x: x + half + gap, y, width: w - half - gap, height: halfH },
        { x: x + half + gap, y: y + halfH + gap, width: w - half - gap, height: h - halfH - gap }
      ]
    }
    const halfH = (h - gap) / 2
    const half = (w - gap) / 2
    return [
      { x, y, width: w, height: halfH },
      { x, y: y + halfH + gap, width: half, height: h - halfH - gap },
      { x: x + half + gap, y: y + halfH + gap, width: w - half - gap, height: h - halfH - gap }
    ]
  }
  const half = (w - gap) / 2
  const halfH = (h - gap) / 2
  return [
    { x, y, width: half, height: halfH },
    { x: x + half + gap, y, width: w - half - gap, height: halfH },
    { x, y: y + halfH + gap, width: half, height: h - halfH - gap },
    { x: x + half + gap, y: y + halfH + gap, width: w - half - gap, height: h - halfH - gap }
  ]
}

/** The fields in use, in their own order. */
export function usedFields(ws) {
  const used = new Set()
  for (const node of ws.nodes) if (Number.isInteger(node.field)) used.add(node.field)
  return [...used].sort((a, b) => a - b)
}

/** The windows of one field, in slot order. */
export function inField(ws, field) {
  return ws.nodes.filter((n) => n.field === field).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
}

/**
 * Where every window of a station goes inside `area`.
 * Returns { fields: [{ field, rect, count }], windows: Map(nodeId → rect) }.
 * A soloed window takes the whole area; the others keep their places, hidden.
 */
export function layout(ws, area, { gap = 12, inner = 8 } = {}) {
  const windows = new Map()
  const fields = []
  const round = (r) => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height)
  })

  const used = usedFields(ws)
  const rects = split(area, used.length, gap)
  used.forEach((field, i) => {
    const rect = rects[i]
    const members = inField(ws, field)
    fields.push({ field, rect: round(rect), count: members.length })
    const slots = split(rect, members.length, inner)
    members.forEach((node, k) => windows.set(node.id, round(slots[k])))
  })

  const solo = ws.solo && windows.has(ws.solo) ? ws.solo : null
  if (solo) windows.set(solo, round(area))
  return { fields, windows, solo }
}

/**
 * Where a new window should go. A free field first — four windows open as four
 * big fields, not crammed into one — then the field the user is working in,
 * then any field with room. Null when all sixteen places are taken.
 */
export function placeFor(ws, { preferField = null, sameField = false } = {}) {
  const used = usedFields(ws)
  const room = (f) => inField(ws, f).length < SLOTS
  const nextSlot = (f) => {
    const members = inField(ws, f)
    return members.length ? Math.max(...members.map((n) => n.slot ?? 0)) + 1 : 0
  }

  if (sameField && Number.isInteger(preferField) && room(preferField)) {
    return { field: preferField, slot: nextSlot(preferField) }
  }
  if (used.length < FIELDS) {
    let f = 0
    while (used.includes(f)) f += 1
    return { field: f, slot: 0 }
  }
  if (Number.isInteger(preferField) && room(preferField)) return { field: preferField, slot: nextSlot(preferField) }
  const free = used.find(room)
  return free === undefined ? null : { field: free, slot: nextSlot(free) }
}

/** Make slot numbers contiguous again after a window leaves a field. */
export function compact(ws) {
  for (const field of usedFields(ws)) {
    inField(ws, field).forEach((node, i) => {
      node.slot = i
    })
  }
}

/**
 * The window nearest in a direction, by centres. `dir` is 'left', 'right',
 * 'up' or 'down'. Works for any set of rectangles, tiled or free.
 */
export function neighbourIn(rects, fromId, dir) {
  const from = rects.get(fromId)
  if (!from) return null
  const cx = from.x + from.width / 2
  const cy = from.y + from.height / 2
  let best = null
  let bestScore = Infinity
  for (const [id, r] of rects) {
    if (id === fromId) continue
    const dx = r.x + r.width / 2 - cx
    const dy = r.y + r.height / 2 - cy
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) continue
    const score = along + across * 2
    if (score < bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}
