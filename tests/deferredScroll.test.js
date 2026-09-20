import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { restoreDeferredScroll } from '../src/lib/deferredScroll.js'

let win, doc, observers, cleanups
class Observer {
  constructor(callback) {
    this.callback = callback
    this.observe = vi.fn()
    this.disconnect = vi.fn()
    observers.push(this)
  }
}
function start(target = 4046) {
  const cleanup = restoreDeferredScroll(target, { win, doc, Observer })
  cleanups.push(cleanup)
  return cleanup
}
beforeEach(() => {
  observers = []; cleanups = []
  win = Object.assign(new EventTarget(), { innerHeight: 900, scrollY: 0, scrollTo: vi.fn() })
  doc = { documentElement: { scrollHeight: 900 }, body: { scrollHeight: 900 }, getElementById: () => ({}) }
})
afterEach(() => { for (const cleanup of cleanups) cleanup() })

it('recovers a saved POP position once after late API content creates enough document height', () => {
  start()
  expect(observers).toHaveLength(1)
  observers[0].callback()
  expect(win.scrollTo).not.toHaveBeenCalled()
  doc.documentElement.scrollHeight = 2000
  observers[0].callback()
  expect(win.scrollTo).not.toHaveBeenCalled()
  doc.documentElement.scrollHeight = 4946
  observers[0].callback()
  expect(win.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 4046, left: 0, behavior: 'instant' })
  expect(observers[0].disconnect).toHaveBeenCalledOnce()
  observers[0].callback() // A queued observer callback cannot restore twice.
  expect(win.scrollTo).toHaveBeenCalledOnce()
})

it.each([undefined, null, false, NaN, Infinity, -1, 0, '640'])('ignores an invalid or top-only target %j', target => {
  // Call directly because start() has a default argument.
  restoreDeferredScroll(target, { win, doc, Observer })()
  expect(observers).toHaveLength(0)
  expect(win.scrollTo).not.toHaveBeenCalled()
})

it('leaves already-rendered pages to the official scroll restorer', () => {
  doc.documentElement.scrollHeight = 4946
  start()
  expect(observers).toHaveLength(0)
  expect(win.scrollTo).not.toHaveBeenCalled()
})

it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('cancels on %s before delayed content arrives', type => {
  start()
  win.dispatchEvent(new Event(type))
  expect(observers[0].disconnect).toHaveBeenCalledOnce()
  doc.documentElement.scrollHeight = 4946
  observers[0].callback()
  expect(win.scrollTo).not.toHaveBeenCalled()
})

it('does not override a subsequent scrollbar or assistive-technology scroll', () => {
  start()
  win.scrollY = 42
  win.dispatchEvent(new Event('scroll'))
  doc.documentElement.scrollHeight = 4946
  observers[0].callback()
  expect(observers[0].disconnect).toHaveBeenCalledOnce()
  expect(win.scrollTo).not.toHaveBeenCalled()
})

it('does not mistake the original clamped scroll event for new user movement', () => {
  start()
  win.dispatchEvent(new Event('scroll'))
  expect(observers[0].disconnect).not.toHaveBeenCalled()
  doc.documentElement.scrollHeight = 4946
  observers[0].callback()
  expect(win.scrollTo).toHaveBeenCalledOnce()
})

it('cleans up every observer and listener when the page never grows or navigation leaves it', () => {
  const added = vi.spyOn(win, 'addEventListener')
  const removed = vi.spyOn(win, 'removeEventListener')
  const cleanup = start()
  for (let i = 0; i < 4; i++) observers[0].callback()
  expect(win.scrollTo).not.toHaveBeenCalled()
  cleanup(); cleanup()
  expect(observers[0].disconnect).toHaveBeenCalledOnce()
  for (const [type, callback] of added.mock.calls) {
    expect(removed.mock.calls.some(([removedType, removedCallback]) => removedType === type && removedCallback === callback)).toBe(true)
  }
  doc.documentElement.scrollHeight = 4946
  observers[0].callback()
  win.dispatchEvent(new Event('resize'))
  expect(win.scrollTo).not.toHaveBeenCalled()
})

it('can finish after a viewport resize without polling', () => {
  doc.documentElement.scrollHeight = 4700
  start()
  win.innerHeight = 654
  win.dispatchEvent(new Event('resize'))
  expect(win.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 4046, left: 0, behavior: 'instant' })
})

it('gracefully retains official restoration if ResizeObserver is unavailable', () => {
  const cleanup = restoreDeferredScroll(4046, { win, doc, Observer: null })
  expect(cleanup).toEqual(expect.any(Function))
  cleanup()
  expect(win.scrollTo).not.toHaveBeenCalled()
})
