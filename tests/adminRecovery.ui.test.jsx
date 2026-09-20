import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], cleanups: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useCallback(callback, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) host.cells[index] = { deps, callback }
    return host.cells[index].callback
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps }; host.effects.push(effect)
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link' }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, downloadApiFile: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'admin', isAdmin: true, isDeveloper: true } }) }))
vi.mock('../src/context/DmContext.jsx', () => ({ useDm: () => ({ openDm() {} }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))

import { api } from '../src/api/client.js'
import AdminPage from '../src/pages/AdminPage.jsx'

let tree
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const form = () => walk(tree).find(node => node.type === 'form')
function render() {
  for (let count = 0; count < 12; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = AdminPage()
    for (const effect of host.effects) { const cleanup = effect(); if (typeof cleanup === 'function') host.cleanups.push(cleanup) }
    if (!host.dirty) return tree
  }
  throw new Error('render loop')
}
async function settle() { for (let count = 0; count < 20; count++) await Promise.resolve(); render() }
const target = { id: 'target', email: 'target@example.invalid', displayName: 'Synthetic target', role: 'candidate', isRecruiter: false, isSuspended: false }
const room = { id: 'room', title: 'Synthetic room', status: 'open' }
const records = {
  '/admin/users': { users: [target] },
  '/admin/rooms': { rooms: [room] },
  '/admin/audit-log': { entries: [] },
  '/admin/contracts': { contracts: [], pendingCount: 0 },
}
const secret = ['local', 'test', 'fixture'].join('-')
const credentialVisible = () => walk(tree).some(node => node.type === 'code' && text(node) === secret)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.cleanups = []; host.dirty = false
  api.get.mockImplementation(async path => records[path])
  vi.stubGlobal('window', { confirm: vi.fn(() => true), prompt: vi.fn(() => target.email) })
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
  vi.stubGlobal('sessionStorage', { setItem: vi.fn() })
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls allowed') }))
})
afterEach(() => vi.unstubAllGlobals())

it('retains successful lists and retries only the failed admin resource', async () => {
  api.get.mockImplementation(async path => { if (path === '/admin/audit-log') throw new Error('Synthetic outage'); return records[path] })
  render(); await settle()
  expect(text(tree)).toContain(target.email)
  expect(text(tree)).toContain(room.title)
  expect(text(tree)).toContain('감사 로그를 불러오지 못했습니다')
  expect(text(tree)).not.toContain('기록이 없습니다.')
  api.get.mockClear().mockImplementation(async path => records[path])
  await button('감사 로그 다시 불러오기').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/admin/audit-log')
  expect(text(tree)).not.toContain('불러오지 못했습니다')
  expect(text(tree)).toContain('기록이 없습니다.')
})

it('does not turn failed contract loading into a claimed empty contract store', async () => {
  api.get.mockImplementation(async path => { if (path === '/admin/contracts') throw new Error('Synthetic outage'); return records[path] })
  render(); await settle()
  expect(text(tree)).toContain('근로계약서를 불러오지 못했습니다')
  expect(text(tree)).not.toContain('아직 보관된 근로계약서가 없습니다.')
  expect(text(tree)).not.toContain('근로계약서 저장소 (0)')
})

it('shows a successful account creation response independently of failed list refreshes', async () => {
  render(); await settle()
  api.post.mockResolvedValueOnce({ user: { ...target, id: 'created' }, tempPassword: secret })
  api.get.mockRejectedValue(new Error('Synthetic refresh failure'))
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(toast.success).toHaveBeenCalledWith('계정이 생성되었습니다. 임시 비밀번호를 확인하세요.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(credentialVisible()).toBe(true)
  expect(walk(tree).find(node => node.props?.['aria-label'] === '일회성 계정 안내')).toBeDefined()
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('목록을 갱신하지 못했습니다'))
  expect(localStorage.setItem).not.toHaveBeenCalled(); expect(sessionStorage.setItem).not.toHaveBeenCalled()
  expect(JSON.stringify([toast.success.mock.calls, toast.error.mock.calls, toast.info.mock.calls]).includes(secret)).toBe(false)
  api.get.mockImplementation(async path => records[path])
  await button('사용자 다시 불러오기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(credentialVisible()).toBe(true)
})

it('keeps a password reset response outside the server-refreshed user table', async () => {
  render(); await settle()
  api.post.mockResolvedValueOnce({ tempPassword: secret })
  api.get.mockImplementation(async path => path === '/admin/users' ? { users: [] } : records[path])
  await button('비밀번호 재설정').props.onClick(); await settle()
  expect(credentialVisible()).toBe(true)
  expect(walk(tree).find(node => node.props?.['aria-label'] === '일회성 계정 안내')).toBeDefined()
  expect(walk(tree).filter(node => node.type === 'table').some(node => text(node).includes(secret))).toBe(false)
  expect(localStorage.setItem).not.toHaveBeenCalled(); expect(sessionStorage.setItem).not.toHaveBeenCalled()
  button('닫기').props.onClick(); render()
  expect(credentialVisible()).toBe(false)
})

it('reports a completed user deletion and permits GET-only recovery without repeating deletion', async () => {
  render(); await settle()
  api.delete.mockResolvedValueOnce({ ok: true })
  api.get.mockRejectedValue(new Error('Synthetic refresh failure'))
  await button('영구 삭제').props.onClick(); await settle()
  expect(toast.success).toHaveBeenCalledWith('계정이 삭제되었습니다.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(button('영구 삭제').props.disabled).toBe(true)
  api.get.mockImplementation(async path => path === '/admin/users' ? { users: [] } : records[path])
  await button('사용자 다시 불러오기').props.onClick(); await settle()
  expect(api.delete).toHaveBeenCalledExactlyOnceWith(`/admin/users/${target.id}`)
})

it.each(['success', 'failure'])('ignores an older resource %s after a newer retry succeeds', async outcome => {
  api.get.mockImplementation(async path => { if (path === '/admin/users') throw new Error('Synthetic outage'); return records[path] })
  render(); await settle()
  const retry = button('사용자 다시 불러오기').props.onClick
  const older = deferred(), newer = deferred()
  api.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  const first = retry(), second = retry()
  newer.resolve({ users: [{ ...target, email: 'newest@example.invalid' }], truncated: true, limit: 500 })
  await second; await settle()
  if (outcome === 'success') older.resolve({ users: [] })
  else older.reject(new Error('Stale read failure'))
  await first; await settle()
  expect(text(tree)).toContain('newest@example.invalid')
  expect(text(tree)).toContain('최근 500건')
  expect(text(tree)).not.toContain('불러오지 못했습니다')
})

it('does not write component state after cleanup while initial reads are pending', async () => {
  const requests = Object.fromEntries(Object.keys(records).map(path => [path, deferred()]))
  api.get.mockImplementation(path => requests[path].promise)
  render(); host.cleanups[0](); host.dirty = false
  for (const path of Object.keys(records)) requests[path].resolve(records[path])
  for (let count = 0; count < 20; count++) await Promise.resolve()
  expect(host.dirty).toBe(false)
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
})

it('discards an account creation response after cleanup without retaining or notifying credentials', async () => {
  render(); await settle()
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const submitted = form().props.onSubmit({ preventDefault() {} }); render()
  host.cleanups[0](); host.dirty = false
  request.resolve({ user: { ...target, id: 'created' }, tempPassword: secret })
  await submitted
  expect(host.dirty).toBe(false)
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.info).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(4)
  expect(localStorage.setItem).not.toHaveBeenCalled(); expect(sessionStorage.setItem).not.toHaveBeenCalled()
})

it('serializes same-tick account creation and other mutations using a synchronous guard', async () => {
  render(); await settle()
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const submit = form().props.onSubmit
  const reset = button('비밀번호 재설정').props.onClick
  const first = submit({ preventDefault() {} }), duplicate = submit({ preventDefault() {} }), competing = reset()
  expect(api.post).toHaveBeenCalledOnce()
  request.resolve({ user: { ...target, id: 'created' }, tempPassword: secret })
  await Promise.all([first, duplicate, competing]); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(credentialVisible()).toBe(true)
})

it.each([
  ['정지', '계정을 정지했습니다.'],
  ['채용자 지정', '채용자 등급 지정 처리되었습니다.'],
])('keeps successful %s distinct from failed subsequent reads', async (label, message) => {
  render(); await settle()
  api.patch.mockResolvedValueOnce({ ok: true })
  api.get.mockRejectedValue(new Error('Synthetic refresh failure'))
  const change = button(label).props.onClick
  await change(); await settle()
  expect(toast.success).toHaveBeenCalledWith(message)
  expect(toast.error).not.toHaveBeenCalled()
  expect(button(label).props.disabled).toBe(true)
  await change()
  expect(api.patch).toHaveBeenCalledOnce()
})

it('blocks uncertain mutations until a read-only check succeeds without leaking server diagnostics', async () => {
  render(); await settle()
  const remove = button('영구 삭제').props.onClick
  api.delete.mockRejectedValueOnce(Object.assign(new Error(secret), { status: 503 }))
  await remove(); await settle()
  expect(text(tree)).toContain('변경 결과를 확인하지 못했습니다')
  expect(button('영구 삭제').props.disabled).toBe(true)
  await remove()
  expect(api.delete).toHaveBeenCalledOnce()
  expect(JSON.stringify(toast.error.mock.calls).includes(secret)).toBe(false)
  expect(text(tree).includes(secret)).toBe(false)
  api.get.mockImplementation(async path => records[path])
  await button('사용자 다시 불러오기').props.onClick(); await settle()
  expect(button('영구 삭제').props.disabled).toBe(false)
  expect(api.delete).toHaveBeenCalledOnce()
})

it('keeps an acknowledged room deletion successful and does not replay it on GET retry', async () => {
  render(); await settle()
  api.delete.mockRejectedValueOnce(Object.assign(new Error('보존 확인 필요'), { status: 409 })).mockResolvedValueOnce({ ok: true })
  api.get.mockRejectedValue(new Error('Synthetic refresh failure'))
  await button('삭제').props.onClick(); await settle()
  expect(api.delete).toHaveBeenCalledTimes(2)
  expect(api.delete).toHaveBeenLastCalledWith('/admin/rooms/room', { acknowledgeRetention: true })
  expect(toast.success).toHaveBeenCalledWith('보존 의무 확인 후 면접방이 삭제되었습니다.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(button('삭제').props.disabled).toBe(true)
  api.get.mockResolvedValueOnce({ rooms: [] })
  await button('면접방 다시 불러오기').props.onClick(); await settle()
  expect(api.delete).toHaveBeenCalledTimes(2)
})

it('separates contract archival success from refresh failure and locks a stale archive count', async () => {
  api.get.mockImplementation(async path => path === '/admin/contracts' ? { contracts: [], pendingCount: 1 } : records[path])
  render(); await settle()
  api.post.mockResolvedValueOnce({ stored: 1, failed: [] })
  api.get.mockRejectedValue(new Error('Synthetic refresh failure'))
  await button('지금 보관하기').props.onClick(); await settle()
  expect(toast.success).toHaveBeenCalledWith('1건을 보관했습니다.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(button('지금 보관하기').props.disabled).toBe(true)
  api.get.mockResolvedValueOnce({ contracts: [], pendingCount: 0 })
  await button('근로계약서 다시 불러오기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(button('지금 보관하기')).toBeUndefined()
})

it('keeps input after a rejected creation and permits corrected resubmission without a list request', async () => {
  render(); await settle()
  const input = walk(form()).find(node => node.type === 'input' && node.props.type === 'email')
  input.props.onChange({ target: { value: 'new@example.invalid' } }); render()
  api.post.mockRejectedValueOnce(Object.assign(new Error('Synthetic validation failure'), { status: 400 }))
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(walk(form()).find(node => node.type === 'input' && node.props.type === 'email').props.value).toBe('new@example.invalid')
  expect(button('계정 만들기').props.disabled).toBe(false)
  expect(api.get).toHaveBeenCalledTimes(4)
  expect(toast.success).not.toHaveBeenCalled()
})

it('retries chat reads without mutating and ignores replies after closing the chat', async () => {
  render(); await settle()
  api.get.mockRejectedValueOnce(new Error('Synthetic chat outage'))
  await button('채팅 보기').props.onClick(); await settle()
  expect(text(tree)).toContain('채팅 내역을 불러오지 못했습니다')
  const request = deferred()
  api.get.mockReturnValueOnce(request.promise)
  const retry = button('채팅 다시 불러오기').props.onClick(); render()
  button('닫기').props.onClick(); render(); host.dirty = false
  request.resolve({ messages: [{ id: 'message', body: 'Hidden obsolete reply' }] })
  await retry
  expect(host.dirty).toBe(false)
  expect(api.post).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled()
})

it('treats malformed chat responses as retryable read failures rather than crashing the admin page', async () => {
  render(); await settle()
  api.get.mockResolvedValueOnce({})
  await button('채팅 보기').props.onClick(); await settle()
  expect(text(tree)).toContain('채팅 내역을 불러오지 못했습니다')
  expect(text(tree)).not.toContain('대화 내역이 없습니다.')
  api.get.mockClear().mockResolvedValueOnce({ messages: [] })
  await button('채팅 다시 불러오기').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/admin/rooms/room/messages')
  expect(text(tree)).toContain('대화 내역이 없습니다.')
  expect(api.post).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled()
})

it.each([
  ['/admin/users', '사용자'], ['/admin/rooms', '면접방'],
  ['/admin/audit-log', '감사 로그'], ['/admin/contracts', '근로계약서'],
])('treats malformed 200 from %s as only that resource failure and preserves prior data', async (path, label) => {
  const data = {
    ...records,
    '/admin/audit-log': { entries: [{ id: 'audit', actorEmail: 'audit@example.invalid', action: 'create_user' }] },
    '/admin/contracts': { contracts: [{ id: 'contract', employeeName: 'Synthetic retained contract', signatureCount: 2 }], pendingCount: 0 },
  }
  api.get.mockImplementation(async key => data[key])
  render(); await settle()
  api.patch.mockResolvedValueOnce({ ok: true })
  api.get.mockImplementation(async key => key === path ? {} : data[key])
  await button('정지').props.onClick(); await settle()
  expect(button(`${label} 다시 불러오기`)).toBeDefined()
  expect(text(tree)).toContain('이전에 확인한 자료')
  expect(text(tree)).toContain(target.email)
  expect(text(tree)).toContain(room.title)
  expect(text(tree)).toContain('audit@example.invalid')
  expect(text(tree)).toContain('Synthetic retained contract')
  api.get.mockClear().mockImplementation(async key => data[key])
  await button(`${label} 다시 불러오기`).props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledExactlyOnceWith(path)
  expect(text(tree)).not.toContain('불러오지 못했습니다')
  expect(api.patch).toHaveBeenCalledOnce()
})
