import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [] }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: initial }
    return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next }]
  },
  useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
  useCallback(callback) { return callback },
  useMemo(compute) { return compute() },
  useEffect(effect) {
    const index = host.index++
    if (!host.cells[index]) {
      const cell = host.cells[index] = { effect }
      host.effects.push(() => { cell.cleanup = effect() })
    }
  },
}))
import { ToastProvider } from '../src/context/ToastProvider.jsx'

let tree
const render = () => {
  host.index = 0; host.effects = []
  tree = ToastProvider({ children: null })
  for (const effect of host.effects) effect()
  return tree.props.value
}
const unmount = () => { for (const cell of host.cells) cell.cleanup?.() }
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
beforeEach(() => { vi.useFakeTimers(); host.cells = []; host.index = 0; host.effects = [] })
afterEach(() => { unmount(); vi.useRealTimers() })

it('expires notices and retains separate error and information announcements', () => {
  const toast = render()
  toast.info('information', 100); toast.error('error', 200)
  render()
  expect(walk(tree).filter(node => node.type === 'button')).toHaveLength(2)
  expect(walk(tree).find(node => node.props.role === 'alert').props['aria-live']).toBe('assertive')
  vi.advanceTimersByTime(100); render()
  expect(walk(tree).filter(node => node.type === 'button')).toHaveLength(1)
  vi.advanceTimersByTime(100); render()
  expect(walk(tree).filter(node => node.type === 'button')).toHaveLength(0)
})

it('cancels every pending timer on provider unmount', () => {
  const toast = render()
  toast.info('first'); toast.success('second'); toast.error('third')
  expect(vi.getTimerCount()).toBe(3)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not schedule notices through a stale callback after unmount', () => {
  const toast = render()
  unmount()
  expect(toast.error('late request failure')).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves notice lifetimes and accepts new notices after Strict Mode effect replay', () => {
  let toast = render()
  toast.info('old', 100)
  vi.advanceTimersByTime(40)
  unmount()
  for (const cell of host.cells) if (cell.effect) cell.cleanup = cell.effect()
  toast = render()
  toast.success('new', 200)
  expect(vi.getTimerCount()).toBe(2)
  vi.advanceTimersByTime(60); render()
  expect(vi.getTimerCount()).toBe(1)
  expect(walk(tree).filter(node => node.type === 'button')).toHaveLength(1)
  vi.advanceTimersByTime(140); render()
  expect(vi.getTimerCount()).toBe(0)
  expect(walk(tree).filter(node => node.type === 'button')).toHaveLength(0)
})
