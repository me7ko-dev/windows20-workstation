/**
 * Messages that must survive being read. The command bar's placeholder is fine
 * for a short confirmation, but it truncates — anything the user has to act on
 * (a missing native module, a failed launch) gets a real toast instead.
 */
export function createToasts(root) {
  const stack = document.createElement('div')
  stack.className = 'w20-toasts'
  root.appendChild(stack)

  return function toast(message, { tone = 'info', timeout = 9000 } = {}) {
    const el = document.createElement('div')
    el.className = `w20-toast w20-toast--${tone}`
    el.innerHTML = `<span class="w20-toast-text"></span><button class="w20-toast-close">✕</button>`
    el.querySelector('.w20-toast-text').textContent = message

    function dismiss() {
      el.classList.add('is-leaving')
      setTimeout(() => el.remove(), 220)
    }

    el.querySelector('.w20-toast-close').addEventListener('click', dismiss)
    stack.appendChild(el)
    if (timeout) setTimeout(dismiss, timeout)
    return dismiss
  }
}
