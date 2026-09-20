import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], cleanups: [], dirty: false }))
const auth = vi.hoisted(() => ({ user: { id: 'owner', role: 'company', isAdmin: false }, logout: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => {
      cell.value = typeof value === 'function' ? value(cell.value) : value
      host.dirty = true
    }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useCallback(callback, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps, callback }
    }
    return host.cells[index].callback
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps }
      host.effects.push(effect)
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link' }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() }, markRoomDoor: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/components/DocumentManager.jsx', () => ({ default: 'test-documents' }))
vi.mock('../src/components/NotificationBell.jsx', () => ({ default: 'test-notifications' }))

import { api } from '../src/api/client.js'
import DashboardPage from '../src/pages/DashboardPage.jsx'
import MyApplications from '../src/components/MyApplications.jsx'

let tree
const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const applications = () => walk(tree).find(node => node.type === MyApplications)
const form = () => walk(tree).find(node => node.type === 'form')
function render() {
  for (let count = 0; count < 10; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = DashboardPage()
    for (const effect of host.effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') host.cleanups.push(cleanup)
    }
    if (!host.dirty) return tree
  }
  throw new Error('render loop')
}
async function settle() { for (let count = 0; count < 12; count++) await Promise.resolve(); render() }
const room = { id: 'room', title: 'Retained interview room', status: 'open', inviteCode: 'TEST01' }
const application = { id: 'application', postingTitle: 'Retained application' }
const dashboard = { rooms: [room], applications: [application] }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.cleanups = []; host.dirty = false
  auth.user = { id: 'owner', role: 'company', isAdmin: false }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls allowed in this test') }))
})
afterEach(() => vi.unstubAllGlobals())

it('shows separate failed room/application states and can retry the combined request', async () => {
  api.get.mockRejectedValueOnce(new Error('Network unavailable'))
  render(); await settle()
  expect(text(tree)).toContain('지원 현황을 불러오지 못했습니다')
  expect(applications()).toBeUndefined()
  expect(text(tree)).not.toContain('참여 중인 면접방이 없습니다.')
  api.get.mockResolvedValueOnce(dashboard)
  await button('목록 다시 불러오기').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(text(tree)).toContain(room.title)
  expect(applications().props.applications).toEqual([application])
  expect(text(tree)).not.toContain('불러오지 못했습니다')
})

it.each(['rooms', 'applications'])('keeps the successful admin response when %s fails', async failed => {
  auth.user.isAdmin = true
  api.get.mockImplementation(async path => {
    if (path === (failed === 'rooms' ? '/admin/rooms' : '/my-applications')) throw new Error('Section unavailable')
    return path === '/admin/rooms' ? { rooms: [room], truncated: true, limit: 50 }
      : { applications: [application], truncated: true, limit: 30 }
  })
  render(); await settle()
  if (failed === 'rooms') {
    expect(applications().props.applications).toEqual([application])
    expect(text(tree)).toContain('최근 30건')
    expect(text(tree)).not.toContain('등록된 면접방이 없습니다.')
  } else {
    expect(text(tree)).toContain(room.title)
    expect(text(tree)).toContain('최근 50개')
    expect(text(tree)).toContain('지원 현황을 불러오지 못했습니다')
    expect(applications()).toBeUndefined()
  }
})

it.each(['company', 'candidate'])('does not report a completed %s mutation as failed when refresh fails', async role => {
  auth.user.role = role
  api.get.mockResolvedValueOnce(dashboard)
  render(); await settle()
  walk(form()).find(node => node.type === 'input').props.onChange({ target: { value: 'Synthetic input' } }); render()
  api.post.mockResolvedValueOnce({ id: 'created', inviteCode: 'NEW001' })
  api.get.mockRejectedValueOnce(new Error('Refresh unavailable'))
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(toast.success).toHaveBeenCalledWith(role === 'company' ? '면접방이 생성되었습니다.' : '면접방에 참여했습니다.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('목록을 갱신하지 못했습니다'))
  expect(text(tree)).toContain(room.title)
  expect(text(tree)).toContain('지원 현황을 불러오지 못했습니다')
  expect(applications().props.applications).toEqual([application])
  if (role === 'company') expect(text(tree)).toContain('NEW001')
  api.get.mockResolvedValueOnce(dashboard)
  await button('목록 다시 불러오기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(text(tree)).not.toContain('불러오지 못했습니다')
})

it('does not show empty data while the first request is still pending', async () => {
  const request = deferred()
  api.get.mockReturnValueOnce(request.promise)
  render()
  expect(text(tree)).toContain('지원 현황을 불러오는 중')
  expect(text(tree)).not.toContain('참여 중인 면접방이 없습니다.')
  expect(applications()).toBeUndefined()
  expect(button('면접방 만들기').props.disabled).toBe(true)
  request.resolve(dashboard); await settle()
  expect(applications().props.applications).toEqual([application])
  expect(button('면접방 만들기').props.disabled).toBe(false)
})

it('only shows the empty room state after a successful empty response', async () => {
  api.get.mockResolvedValueOnce({ rooms: [], applications: [] })
  render(); await settle()
  expect(text(tree)).toContain('참여 중인 면접방이 없습니다.')
  expect(text(tree)).not.toContain('불러오지 못했습니다')
  expect(button('목록 다시 불러오기')).toBeUndefined()
})

it('retries failed admin reads without dropping the other list or its truncation metadata', async () => {
  auth.user.isAdmin = true
  api.get.mockImplementation(async path => path === '/admin/rooms'
    ? { rooms: [room], truncated: true, limit: 50 }
    : { applications: [application], truncated: true, limit: 30 })
  render(); await settle()
  api.post.mockResolvedValueOnce({ id: 'created', inviteCode: 'NEW001' })
  api.get.mockImplementation(async path => {
    if (path === '/my-applications') throw new Error('Applications unavailable')
    return { rooms: [{ ...room, title: 'Updated room' }] }
  })
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(text(tree)).toContain('Updated room')
  expect(text(tree)).not.toContain('최근 50개')
  expect(applications().props.applications).toEqual([application])
  expect(text(tree)).toContain('최근 30건')
  expect(text(tree)).toContain('이전에 불러온 지원 현황')
  expect(toast.success).toHaveBeenCalledWith('면접방이 생성되었습니다.')
  expect(toast.error).not.toHaveBeenCalled()

  api.get.mockImplementation(async path => path === '/admin/rooms'
    ? { rooms: [room] } : { applications: [] })
  await button('목록 다시 불러오기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(api.get.mock.calls.map(([path]) => path)).toEqual([
    '/admin/rooms', '/my-applications', '/admin/rooms', '/my-applications', '/admin/rooms', '/my-applications',
  ])
  expect(applications().props.applications).toEqual([])
  expect(text(tree)).not.toContain('최근 30건')
  expect(text(tree)).not.toContain('불러오지 못했습니다')
})

it.each(['company', 'candidate'])('keeps %s input and reports actual mutation rejection without refreshing', async role => {
  auth.user.role = role
  api.get.mockResolvedValueOnce(dashboard)
  render(); await settle()
  walk(form()).find(node => node.type === 'input').props.onChange({ target: { value: 'Retain this input' } }); render()
  api.post.mockRejectedValueOnce(new Error('Mutation rejected'))
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(api.post).toHaveBeenCalledWith(role === 'company' ? '/rooms/create' : '/rooms/join',
    role === 'company' ? { title: 'Retain this input', operationId: expect.any(String) } : { inviteCode: 'Retain this input' })
  expect(api.get).toHaveBeenCalledOnce()
  expect(walk(form()).find(node => node.type === 'input').props.value).toBe('Retain this input')
  expect(toast.error).toHaveBeenCalledWith('Mutation rejected')
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.info).not.toHaveBeenCalled()
  expect(text(tree)).toContain(room.title)
})

it('locks an unconfirmed room title and retries the same request without making a second operation', async () => {
  api.get.mockResolvedValue(dashboard)
  render(); await settle()
  walk(form()).find(node => node.type === 'input').props.onChange({ target: { value: 'One room' } }); render()
  api.post.mockRejectedValueOnce(new Error('Response lost after commit'))
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(walk(form()).find(node => node.type === 'input').props.disabled).toBe(true)
  expect(button('면접방 만들기').props.disabled).toBe(true)
  expect(text(tree)).toContain('면접방 생성 결과를 확인하지 못했습니다')
  const original = api.post.mock.calls[0][1]
  api.post.mockResolvedValueOnce({ id: 'created', inviteCode: 'NEW001', recovered: true })
  await button('같은 요청으로 생성 다시 시도').props.onClick({ preventDefault() {} }); await settle()
  expect(api.post.mock.calls[1][1]).toEqual(original)
  expect(walk(form()).find(node => node.type === 'input').props.value).toBe('')
  expect(walk(form()).find(node => node.type === 'input').props.disabled).toBe(false)
  expect(text(tree)).not.toContain('면접방 생성 결과를 확인하지 못했습니다')
  expect(toast.success).toHaveBeenCalledTimes(1)
})

it.each(['success', 'failure'])('ignores an older retry %s after the latest retry has finished', async outcome => {
  api.get.mockRejectedValueOnce(new Error('Initial failure'))
  render(); await settle()
  const retry = button('목록 다시 불러오기').props.onClick
  const older = deferred(), newer = deferred()
  api.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  // The same callback can fire twice before React commits disabled/loading state.
  const first = retry(), second = retry()
  newer.resolve({ rooms: [{ ...room, title: 'Newest room' }], applications: [application] })
  await second; await settle()
  if (outcome === 'success') older.resolve({ rooms: [{ ...room, title: 'Stale room' }], applications: [] })
  else older.reject(new Error('Stale failure'))
  await first; await settle()
  expect(text(tree)).toContain('Newest room')
  expect(text(tree)).not.toContain('Stale room')
  expect(applications().props.applications).toEqual([application])
  expect(text(tree)).not.toContain('불러오지 못했습니다')
})

it('ignores both stale admin results after a newer pair has completed', async () => {
  auth.user.isAdmin = true
  api.get.mockRejectedValue(new Error('Initial failure'))
  render(); await settle()
  const retry = button('목록 다시 불러오기').props.onClick
  const olderRooms = deferred(), olderApplications = deferred()
  api.get.mockReturnValueOnce(olderRooms.promise).mockReturnValueOnce(olderApplications.promise)
    .mockResolvedValueOnce({ rooms: [room] }).mockResolvedValueOnce({ applications: [application] })
  const first = retry(), second = retry()
  await second; await settle()
  olderRooms.resolve({ rooms: [] })
  olderApplications.reject(new Error('Stale application failure'))
  await first; await settle()
  expect(text(tree)).toContain(room.title)
  expect(applications().props.applications).toEqual([application])
  expect(text(tree)).not.toContain('불러오지 못했습니다')
})

it('invalidates an in-flight list request on effect cleanup', async () => {
  const request = deferred()
  api.get.mockReturnValueOnce(request.promise)
  render()
  expect(host.cleanups).toHaveLength(2)
  for (const cleanup of host.cleanups) cleanup()
  host.dirty = false
  request.resolve(dashboard)
  for (let count = 0; count < 12; count++) await Promise.resolve()
  expect(host.dirty).toBe(false)
})
