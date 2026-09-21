/**
 * The card shown for a GUI program. Windows gives no supported way to reparent
 * another process's window into ours, so an external program gets an honest
 * launch card rather than an empty frame pretending to embed it.
 */
export function mountLauncher(win, { program }) {
  const card = document.createElement('div')
  card.className = 'w20-launch'
  card.innerHTML = `
    <div class="w20-launch-icon"></div>
    <p class="w20-launch-desc"></p>
    <button class="w20-launch-btn" data-role="run"></button>
    <p class="w20-launch-note" data-role="note"></p>
  `

  card.querySelector('.w20-launch-icon').textContent = program.icon
  card.querySelector('.w20-launch-desc').textContent = program.description
  const btn = card.querySelector('[data-role="run"]')
  const note = card.querySelector('[data-role="note"]')

  btn.textContent = program.installed ? `Пусни ${program.title}` : `${program.title} не е намерена`
  btn.disabled = !program.installed
  note.textContent = program.path || 'Не е открита на този компютър.'

  btn.addEventListener('click', async () => {
    note.textContent = 'Стартира…'
    const result = await window.w20.launch(program.id, [])
    note.textContent = result.ok ? 'Пуснато — виж лентата на задачите.' : result.error
  })

  win.body.appendChild(card)
  return { focus: () => btn.focus(), destroy: () => card.remove() }
}
