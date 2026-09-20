import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const host = vi.hoisted(() => ({ effects: [], blocker: null, predicate: null }))
vi.mock('react', async original => ({ ...await original(), useCallback: callback => callback, useEffect: effect => host.effects.push(effect) }))
vi.mock('react-router-dom', () => ({ useBlocker: predicate => { host.predicate = predicate; return host.blocker } }))
import UnsavedChangesGuard from '../src/components/UnsavedChangesGuard.jsx'

const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
beforeEach(() => {
  host.effects = []; host.predicate = null
  host.blocker = { state: 'unblocked', reset: vi.fn(), proceed: vi.fn() }
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

it('registers and removes document-exit protection only while there is unsaved input', () => {
  expect(UnsavedChangesGuard({ when: false })).toBeNull()
  host.effects.forEach(effect => effect())
  expect(window.addEventListener).not.toHaveBeenCalled()
  host.effects = []
  expect(UnsavedChangesGuard({ when: true })).toBeNull()
  const cleanups = host.effects.map(effect => effect())
  const listener = window.addEventListener.mock.calls.find(([name]) => name === 'beforeunload')[1]
  const event = { preventDefault: vi.fn(), returnValue: undefined }
  listener(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(event.returnValue).toBe('')
  cleanups.forEach(cleanup => cleanup?.())
  expect(window.removeEventListener).toHaveBeenCalledWith('beforeunload', listener)
})

it('offers the safe stay action first and changes route only through the discard action', () => {
  host.blocker.state = 'blocked'
  const tree = UnsavedChangesGuard({ when: true, message: '선택한 첨부파일도 사라집니다.' })
  expect(tree.props.title).toBe('작성 중인 내용이 있습니다')
  const buttons = walk(tree).filter(node => node.type === 'button')
  expect(buttons.map(button => button.props.children)).toEqual(['계속 작성', '저장하지 않고 나가기'])
  buttons[0].props.onClick()
  expect(host.blocker.reset).toHaveBeenCalledOnce()
  expect(host.blocker.proceed).not.toHaveBeenCalled()
  buttons[1].props.onClick()
  expect(host.blocker.proceed).toHaveBeenCalledOnce()
  tree.props.onClose()
  expect(host.blocker.reset).toHaveBeenCalledTimes(2)
})

it('dismisses a pending prompt after save, without surprising the user with navigation', () => {
  host.blocker.state = 'blocked'
  expect(UnsavedChangesGuard({ when: false })).toBeNull()
  host.effects.forEach(effect => effect())
  expect(host.blocker.reset).toHaveBeenCalledOnce()
  expect(host.blocker.proceed).not.toHaveBeenCalled()
})

it('passes the current dirty state to the real navigation predicate', () => {
  UnsavedChangesGuard({ when: true })
  expect(host.predicate({ currentLocation: { pathname: '/recruit', search: '' }, nextLocation: { pathname: '/jobs', search: '' } })).toBe(true)
  UnsavedChangesGuard({ when: false })
  expect(host.predicate({ currentLocation: { pathname: '/recruit', search: '' }, nextLocation: { pathname: '/jobs', search: '' } })).toBe(false)
})
