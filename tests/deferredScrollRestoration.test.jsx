import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], location: {}, epoch: 0, action: 'POP', router: {} }))
vi.mock('react', () => ({
  useContext: () => host.router,
  useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
  useEffect(effect, deps) {
    const index = host.index++
    const previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      host.cells[index] = { deps, effect, cleanup: previous?.cleanup }
      host.effects.push(index)
    }
  },
}))
vi.mock('react-router-dom', () => ({
  UNSAFE_DataRouterStateContext: {},
  useLocation: () => host.location,
  useNavigationType: () => host.action,
}))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ sessionEpoch: host.epoch }) }))
vi.mock('../src/lib/deferredScroll.js', () => ({ restoreDeferredScroll: vi.fn() }))
import { restoreDeferredScroll } from '../src/lib/deferredScroll.js'
import DeferredScrollRestoration from '../src/components/DeferredScrollRestoration.jsx'

function render() {
  host.index = 0; host.effects = []
  expect(DeferredScrollRestoration()).toBeNull()
  for (const i of host.effects) {
    host.cells[i].cleanup?.()
    host.cells[i].cleanup = host.cells[i].effect()
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  host.cells = []; host.location = { key: 'first', hash: '' }; host.epoch = 0; host.action = 'POP'
  host.router = { restoreScrollPosition: 4046 }
  restoreDeferredScroll.mockImplementation(() => vi.fn())
})
afterEach(() => { for (const cell of host.cells) cell.cleanup?.() })

it('uses only the numeric router target on a POP, without rendering any URL', () => {
  render()
  expect(restoreDeferredScroll).toHaveBeenCalledExactlyOnceWith(4046)
})

it.each(['PUSH', 'REPLACE'])('does not interfere with %s navigation resetting to the top', action => {
  host.action = action
  render()
  expect(restoreDeferredScroll).not.toHaveBeenCalled()
})

it('leaves hash navigation including the main skip link to the browser and router', () => {
  host.location.hash = '#main'
  render()
  expect(restoreDeferredScroll).not.toHaveBeenCalled()
})

it('keeps pending restoration through unrelated renders and initial authentication recovery', () => {
  render()
  const cleanup = restoreDeferredScroll.mock.results[0].value
  render()
  expect(restoreDeferredScroll).toHaveBeenCalledOnce()
  expect(cleanup).not.toHaveBeenCalled()
})

it('cleans up on another navigation and starts only that POP target', () => {
  render()
  const cleanup = restoreDeferredScroll.mock.results[0].value
  host.location = { key: 'second', hash: '' }
  host.router = { restoreScrollPosition: 123 }
  render()
  expect(cleanup).toHaveBeenCalledOnce()
  expect(restoreDeferredScroll).toHaveBeenLastCalledWith(123)
})

it('cancels on account change without restarting the previous account position', () => {
  render()
  const cleanup = restoreDeferredScroll.mock.results[0].value
  host.epoch = 1
  render()
  expect(cleanup).toHaveBeenCalledOnce()
  expect(restoreDeferredScroll).toHaveBeenCalledOnce()
  host.router = { restoreScrollPosition: 4047 }
  render()
  expect(restoreDeferredScroll).toHaveBeenCalledOnce()
  host.location = { key: 'next-account-location', hash: '' }
  render()
  expect(restoreDeferredScroll).toHaveBeenCalledTimes(2)
})

it('cleans up the first StrictMode effect before its replay and the replay on unmount', () => {
  render()
  const firstCleanup = restoreDeferredScroll.mock.results[0].value
  const effect = host.cells.find(cell => cell.effect)
  effect.cleanup()
  effect.cleanup = effect.effect()
  expect(firstCleanup).toHaveBeenCalledOnce()
  expect(restoreDeferredScroll).toHaveBeenCalledTimes(2)
  const secondCleanup = restoreDeferredScroll.mock.results[1].value
  effect.cleanup(); effect.cleanup = undefined
  expect(secondCleanup).toHaveBeenCalledOnce()
})
