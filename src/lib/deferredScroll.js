// React Router restores immediately. Pages that fetch in an effect can still be
// shorter than the saved position, so wait for actual layout growth, not a timer.
export function restoreDeferredScroll(targetY, { win = window, doc = document, Observer = globalThis.ResizeObserver } = {}) {
  const noop = () => {}
  if (!Number.isFinite(targetY) || targetY <= 0 || typeof Observer !== 'function') return noop
  const maximumY = () => Math.max(0, Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0) - win.innerHeight)
  // A page already tall enough belongs entirely to the official restorer.
  if (maximumY() >= targetY - 1) return noop

  const initialY = win.scrollY
  const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown']
  const inputOptions = { capture: true, passive: true }
  let stopped = false
  let observer
  const stop = () => {
    if (stopped) return
    stopped = true
    observer?.disconnect()
    for (const type of inputEvents) win.removeEventListener(type, stop, inputOptions)
    win.removeEventListener('scroll', onScroll)
    win.removeEventListener('resize', attempt)
  }
  const onScroll = () => {
    // Ignore the already-clamped router scroll event, but respect any subsequent
    // movement, including scrollbar/assistive-technology scrolling.
    if (Math.abs(win.scrollY - initialY) > 1) stop()
  }
  const attempt = () => {
    if (stopped || maximumY() < targetY - 1) return
    stop()
    win.scrollTo({ top: targetY, left: 0, behavior: 'instant' })
  }

  observer = new Observer(attempt)
  for (const type of inputEvents) win.addEventListener(type, stop, inputOptions)
  win.addEventListener('scroll', onScroll, { passive: true })
  win.addEventListener('resize', attempt, { passive: true })
  for (const element of new Set([doc.documentElement, doc.body, doc.getElementById('main')].filter(Boolean))) observer.observe(element)
  return stop
}
