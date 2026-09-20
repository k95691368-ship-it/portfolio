import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
  },
  useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
  useEffect(effect, deps) {
    const index = host.index++, previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      host.cells[index] = { deps, effect, cleanup: previous?.cleanup }
      host.effects.push(() => { previous?.cleanup?.(); host.cells[index].cleanup = effect() })
    }
  },
  useCallback(callback, deps) {
    const index = host.index++, previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) host.cells[index] = { value: callback, deps }
    return host.cells[index].value
  },
  useMemo(compute, deps) {
    const index = host.index++, previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) host.cells[index] = { value: compute(), deps }
    return host.cells[index].value
  },
}))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'local-viewer' } }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
import { api } from '../src/api/client.js'
import NotificationBell from '../src/components/NotificationBell.jsx'
import { DmProvider } from '../src/context/DmContext.jsx'

const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let Component, props, tree
function render() {
  for (let i = 0; i < 12; i++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = Component(props)
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('Render loop')
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); render() }
const unmount = () => { for (const cell of host.cells) cell.cleanup?.() }
const restartEffects = () => {
  unmount()
  for (const cell of host.cells) if (cell.effect) cell.cleanup = cell.effect()
  render()
}
const button = name => walk(tree).find(node => node.type === 'button' && (node.props['aria-label'] === name || text(node) === name))
function start(kind) {
  if (kind === 'notification') { Component = NotificationBell; props = {} }
  else { const node = DmProvider({ children: null }); Component = node.type; props = node.props }
  render()
}
const notification = (id, message) => ({ id, message, createdAt: '2026-09-19 07:00:00', isRead: false, link: '/dashboard' })
const thread = (id, lastBody) => ({ partner: { id, displayName: `Local ${id}` }, unread: 1, lastAt: '2026-09-19 07:00:00', lastFromMe: false, lastBody })
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('setInterval', vi.fn(() => 1)); vi.stubGlobal('clearInterval', vi.fn())
})
afterEach(() => { unmount(); vi.unstubAllGlobals() })

it('does not label a failed notification lookup as no notifications and offers GET retry', async () => {
  api.get.mockRejectedValue(new Error('Local read unavailable'))
  start('notification'); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  expect(text(tree)).not.toContain('알림이 없습니다.')
  expect(button('알림 다시 불러오기')).toBeDefined()
  expect(walk(tree).find(node => node.props?.role === 'alert')).toBeDefined()
})

it('does not replace a pending notification lookup on every background tick', async () => {
  const old = deferred()
  api.get.mockReturnValueOnce(old.promise)
  start('notification'); setInterval.mock.calls[0][0](); setInterval.mock.calls[0][0](); await settle()
  expect(api.get).toHaveBeenCalledTimes(1)
  old.resolve({ notifications: [notification(1, 'new notification')], unreadCount: 1 }); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  expect(text(tree)).toContain('new notification')
  expect(button('모두 읽음').props.disabled).toBe(false)
})

it('exposes a failed DM inbox read instead of treating it as a verified empty list', async () => {
  api.get.mockRejectedValue(new Error('Local read unavailable'))
  start('dm'); await settle()
  expect(tree.props.value.inboxError).toBeTruthy()
  expect(tree.props.value.inboxLoading).toBe(false)
})

it('keeps the latest DM inbox and ignores an older late unread snapshot', async () => {
  const old = deferred()
  api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ threads: [thread('new', 'latest message')], unreadTotal: 1 })
  start('dm'); const request = tree.props.value.refresh(); await request; render()
  old.resolve({ threads: [thread('old', 'old message')], unreadTotal: 1 }); await settle()
  expect(tree.props.value.threads.map(entry => entry.partner.id)).toEqual(['new'])
})

it.each(['notification', 'dm'])('does not publish late %s results after unmount', async kind => {
  const pending = deferred()
  api.get.mockReturnValue(pending.promise)
  start(kind); unmount(); host.dirty = false
  pending.resolve(kind === 'notification'
    ? { notifications: [notification(1, 'late')], unreadCount: 1 }
    : { threads: [thread('late', 'late')], unreadTotal: 1 })
  for (let i = 0; i < 16; i++) await Promise.resolve()
  expect(host.dirty).toBe(false)
})

it.each(['notification', 'dm'])('ignores old %s effect work after StrictMode replay', async kind => {
  const old = deferred()
  const fresh = kind === 'notification'
    ? { notifications: [notification(2, 'fresh snapshot')], unreadCount: 1 }
    : { threads: [thread('fresh', 'fresh snapshot')], unreadTotal: 1 }
  api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh)
  start(kind); restartEffects(); await settle()
  old.reject(new Error('Late old effect failure')); await settle()
  if (kind === 'dm') {
    expect(tree.props.value.threads).toEqual(fresh.threads)
    expect(tree.props.value.inboxError).toBe('')
  } else {
    walk(tree).find(node => node.type === 'button').props.onClick(); render()
    expect(text(tree)).toContain('fresh snapshot')
    expect(button('알림 다시 불러오기')).toBeUndefined()
  }
})

it('preserves last notification data after a malformed response and recovers by GET only', async () => {
  api.get.mockResolvedValueOnce({ notifications: [notification(2, 'saved notification')], unreadCount: 1 })
    .mockResolvedValueOnce({ notifications: [null], unreadCount: 0 })
    .mockResolvedValueOnce({ notifications: [], unreadCount: 0 })
  start('notification'); await settle(); setInterval.mock.calls[0][0](); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  expect(text(tree)).toContain('saved notification')
  expect(text(tree)).not.toContain('알림이 없습니다.')
  button('알림 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('알림이 없습니다.')
  expect(button('알림 다시 불러오기')).toBeUndefined()
  expect(api.post).not.toHaveBeenCalled()
})

it('preserves a valid DM inbox and alerts on malformed data then allows GET recovery', async () => {
  const saved = thread('saved', 'saved message')
  api.get.mockResolvedValueOnce({ threads: [saved], unreadTotal: 1 })
    .mockResolvedValueOnce({ threads: [{ partner: null }], unreadTotal: 0 })
    .mockResolvedValueOnce({ threads: [], unreadTotal: 0 })
  start('dm'); await settle()
  await tree.props.value.refresh(); render()
  expect(tree.props.value.threads).toEqual([saved])
  expect(tree.props.value.inboxError).toBeTruthy()
  expect(tree.props.value.alerts).toHaveLength(1)
  await tree.props.value.refresh(); render()
  expect(tree.props.value.threads).toEqual([])
  expect(tree.props.value.inboxError).toBe('')
  expect(tree.props.value.inboxLoaded).toBe(true)
  expect(api.post).not.toHaveBeenCalled()
})

it('keeps a confirmed read update when its follow-up GET fails and does not repeat POST', async () => {
  api.get.mockResolvedValueOnce({ notifications: [notification(1, 'notice')], unreadCount: 1 })
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ notifications: [{ ...notification(1, 'notice'), isRead: true }], unreadCount: 0 })
  api.post.mockResolvedValue({ ok: true })
  start('notification'); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  const submit = button('모두 읽음').props.onClick
  submit(); submit(); await settle()
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(walk(tree).find(node => node.props?.className === 'notif-item unread')).toBeUndefined()
  expect(button('알림 다시 불러오기')).toBeDefined()
  button('알림 다시 불러오기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(button('알림 다시 불러오기')).toBeUndefined()
})

it('does not claim an unconfirmed read update succeeded', async () => {
  api.get.mockResolvedValue({ notifications: [notification(1, 'notice')], unreadCount: 1 })
  api.post.mockResolvedValue({})
  start('notification'); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  button('모두 읽음').props.onClick(); await settle()
  expect(walk(tree).find(node => node.props?.className === 'notif-item unread')).toBeDefined()
  expect(text(tree)).toContain('읽음 처리 결과를 확인하지 못했습니다.')
  expect(button('알림 다시 불러오기')).toBeDefined()
})

it('lets slow DM reads finish instead of starving them with automatic polls', async () => {
  for (let round = 0; round < 4; round++) {
    const pending = deferred()
    api.get.mockReturnValueOnce(pending.promise)
    if (round === 0) start('dm')
    else setInterval.mock.calls[0][0]()
    setInterval.mock.calls[0][0](); setInterval.mock.calls[0][0]()
    expect(api.get).toHaveBeenCalledTimes(round + 1)
    pending.resolve({ threads: [thread(`round-${round}`, 'slow but successful')], unreadTotal: 1 })
    await settle()
    expect(tree.props.value.inboxLoaded).toBe(true)
    expect(tree.props.value.inboxLoading).toBe(false)
    expect(tree.props.value.threads[0].partner.id).toBe(`round-${round}`)
  }
})

it('does not absorb notifications created after a pending mark-read write', async () => {
  const writing = deferred()
  api.get.mockResolvedValueOnce({ notifications: [notification(1, 'old notification')], unreadCount: 1 })
    .mockRejectedValueOnce(new Error('Follow-up GET unavailable'))
    .mockResolvedValueOnce({ notifications: [{ ...notification(1, 'old notification'), isRead: true }, notification(2, 'new unread notification')], unreadCount: 1 })
  api.post.mockReturnValue(writing.promise)
  start('notification'); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  button('모두 읽음').props.onClick()
  setInterval.mock.calls[0][0](); await settle()
  expect(api.get).toHaveBeenCalledTimes(1)
  writing.resolve({ ok: true }); await settle()
  expect(button('알림 다시 불러오기')).toBeDefined()
  button('알림 다시 불러오기').props.onClick(); await settle()
  const unread = walk(tree).filter(node => node.props?.className === 'notif-item unread')
  expect(unread).toHaveLength(1)
  expect(text(unread[0])).toContain('new unread notification')
})

it('ignores a pre-write notification poll after confirmed read and follow-up refresh', async () => {
  const old = deferred()
  api.get.mockResolvedValueOnce({ notifications: [notification(1, 'notice')], unreadCount: 1 })
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ notifications: [{ ...notification(1, 'notice'), isRead: true }], unreadCount: 0 })
  api.post.mockResolvedValue({ ok: true })
  start('notification'); await settle()
  walk(tree).find(node => node.type === 'button').props.onClick(); render()
  setInterval.mock.calls[0][0](); await settle()
  walk(tree).find(node => node.props?.className === 'notif-item unread').props.onClick(); await settle()
  old.resolve({ notifications: [notification(1, 'notice')], unreadCount: 1 }); await settle()
  expect(button('알림 없음')).toBeDefined()
})
