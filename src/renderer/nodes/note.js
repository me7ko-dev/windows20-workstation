/** A sticky note — the canvas doubles as a scratch pad, so plans live beside the agents. */
export function mountNote(win, { text = '', onChange }) {
  const area = document.createElement('textarea')
  area.className = 'w20-note'
  area.placeholder = 'План, списък, каквото…'
  area.value = text
  area.addEventListener('input', () => onChange(area.value))
  win.body.appendChild(area)

  return {
    focus: () => area.focus(),
    destroy: () => area.remove()
  }
}
