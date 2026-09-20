import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Controlled workflow regressions: execute the real components while keeping
// network completion and effect cleanup deterministic. No live API calls.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  return {
    ...await original(),
    useState(initial) {
      const index = host.index++
      const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, value => {
        const next = typeof value === 'function' ? value(cell.value) : value
        if (!Object.is(cell.value, next)) { cell.value = next; host.dirty = true }
      }]
    },
    useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
    useCallback(callback, deps) {
      const index = host.index++
      if (!host.cells[index] || changed(host.cells[index].deps, deps)) host.cells[index] = { deps, callback }
      return host.cells[index].callback
    },
    useEffect(effect, deps) {
      const index = host.index++, previous = host.cells[index]
      if (!previous || changed(previous.deps, deps)) {
        host.cells[index] = { deps, effect, cleanup: previous?.cleanup }
        host.effects.push(index)
      }
    },
  }
})
vi.mock('react-router-dom', () => ({ useParams: () => ({ roomId: 'room-a' }), Link: 'test-link' }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/hooks/useChatPolling.js', () => ({ useChatPolling: () => ({ messages: [], error: '', sendMessage: vi.fn() }) }))
vi.mock('../src/lib/desktopAlert.js', () => ({ alertsOn: () => false, alertNewMessages: vi.fn() }))
vi.mock('../src/components/ChatMessageList.jsx', () => ({ default: 'test-chat-list' }))
vi.mock('../src/components/ChatComposer.jsx', () => ({ default: 'test-chat-composer' }))
vi.mock('../src/components/MessageAlertToggle.jsx', () => ({ default: 'test-alert-toggle' }))
vi.mock('../src/components/RoomDocuments.jsx', () => ({ default: 'test-documents' }))
vi.mock('../src/components/ContractFieldsForm.jsx', () => ({ default: 'test-contract-fields' }))
vi.mock('../src/components/FinalOfferEmailForm.jsx', () => ({ default: 'test-offer-email' }))
vi.mock('../src/components/RoomInviteEmailForm.jsx', () => ({ default: 'test-invite-email' }))
vi.mock('../src/components/NegotiationLog.jsx', () => ({ default: 'test-negotiation' }))
vi.mock('../src/components/PreContractReview.jsx', () => ({ default: 'test-contract-review' }))
vi.mock('../src/components/OfferWithdrawalModal.jsx', () => ({ default: 'test-withdrawal-modal' }))
vi.mock('../src/features/interview/InterviewSessionPanel.jsx', () => ({ default: 'test-interview-panel' }))

import { api } from '../src/api/client.js'
import RoomPage from '../src/pages/RoomPage.jsx'
import InterviewSummary from '../src/components/InterviewSummary.jsx'
import OfferWatch from '../src/components/OfferWatch.jsx'

let component, props, tree
const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function render() {
  for (let attempt = 0; attempt < 20; attempt++) {
    host.index = 0; host.dirty = false; host.effects = []
    tree = component(props)
    for (const index of host.effects) host.cells[index].cleanup?.()
    for (const index of host.effects) host.cells[index].cleanup = host.cells[index].effect()
    if (!host.dirty) return tree
  }
  throw new Error('Unsettled component')
}
async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve() }
async function settle() { await flush(); render() }
function unmount() { for (const cell of host.cells) cell?.cleanup?.(); host.dirty = false }
const boundary = () => walk(tree).find(node => node.type === 'fieldset' && node.props.className === 'room-write-boundary')
const view = (title = '현재 면접방', status = 'open') => ({
  room: { id: 'room-a', title, status, myRole: 'company', participants: [], viewer: { id: 'owner' } },
  messages: [], documents: [], offer: { established: false }, contract: null,
})
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  component = RoomPage; props = {}
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden in baseline') }))
})
afterEach(() => {
  for (const cell of host.cells) cell?.cleanup?.()
  vi.unstubAllGlobals()
})

it('control: loads the actual RoomPage and completes a normal close plus refresh', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  expect(text(tree)).toContain('현재 면접방')
  expect(button('전형 종료하기')).toBeDefined()
  api.post.mockResolvedValueOnce({ ok: true })
  api.get.mockResolvedValueOnce(view('종료된 면접방', 'closed'))
  await button('전형 종료하기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledWith('/rooms/room-a/close', expect.objectContaining({ reason: 'other_candidate' }))
  expect(button('전형 다시 진행하기')).toBeDefined()
  expect(text(tree)).toContain('종료된 면접방')
  expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
})

it('keeps the newest same-room refresh when an earlier refresh finishes later', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  const reload = walk(tree).find(node => node.type === OfferWatch).props.onChanged
  const earlier = deferred(), later = deferred()
  api.get.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)
  const firstRequest = reload(), secondRequest = reload()
  later.resolve(view('최신 조회', 'closed')); await secondRequest; await settle()
  expect(text(tree)).toContain('최신 조회')
  earlier.resolve(view('오래된 조회', 'open')); await firstRequest; await settle()
  expect(text(tree)).toContain('최신 조회')
  expect(text(tree)).not.toContain('오래된 조회')
})

it('ignores the first StrictMode setup failure after the second setup already loaded the room', async () => {
  const earlier = deferred(), later = deferred()
  api.get.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)
  render()
  // React development StrictMode replays effect cleanup/setup without changing
  // the pathname; the App's pathname key does not prevent this same-room case.
  for (const cell of host.cells) if (cell?.effect) { cell.cleanup?.(); cell.cleanup = cell.effect() }
  later.resolve(view('정상 복구')); await settle()
  expect(text(tree)).toContain('정상 복구')
  earlier.reject(new Error('이전 조회 실패')); await settle()
  expect(text(tree)).toContain('정상 복구')
  expect(text(tree)).not.toContain('이전 조회 실패')
})

it.each(['close', 'reopen'])('reports a completed %s separately from a failed follow-up view read', async action => {
  api.get.mockResolvedValueOnce(view('현재 면접방', action === 'close' ? 'open' : 'closed'))
  render(); await settle()
  const mutation = action === 'close' ? api.post : api.delete
  mutation.mockResolvedValueOnce({ ok: true })
  api.get.mockRejectedValueOnce(new Error('조회만 실패'))
  await button(action === 'close' ? '전형 종료하기' : '전형 다시 진행하기').props.onClick()
  await settle()
  expect(mutation).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.success).toHaveBeenCalledOnce()
})

it.each(['summary', 'hire'])('reports completed %s writing separately from failed onChanged refresh', async action => {
  const refresh = vi.fn().mockRejectedValue(new Error('조회만 실패'))
  if (action === 'summary') {
    component = InterviewSummary
    props = { roomId: 'room-a', canWrite: true, messageCount: 1, record: null, onChanged: refresh }
  } else {
    component = OfferWatch
    props = { roomId: 'room-a', offer: { established: true, basis: 'phrase' }, onChanged: refresh }
  }
  render()
  api.post.mockResolvedValueOnce({ ok: true })
  await button(action === 'summary' ? 'AI로 면접 정리하기' : '채용 확정으로 기록').props.onClick()
  await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.info).toHaveBeenCalledOnce()
})

it('recovers an initial read failure through GET-only retry and keeps a dashboard return link', async () => {
  api.get.mockRejectedValueOnce(new Error('연결 실패'))
  render(); await settle()
  expect(text(tree)).toContain('면접방을 불러오지 못했습니다')
  expect(walk(tree).some(node => node.type === 'test-link' && node.props.to === '/dashboard')).toBe(true)
  const retry = deferred()
  api.get.mockReturnValueOnce(retry.promise)
  button('면접방 다시 불러오기').props.onClick(); render()
  expect(button('불러오는 중...').props.disabled).toBe(true)
  retry.resolve(view('조회 복구')); await settle()
  expect(text(tree)).toContain('조회 복구')
  expect(text(tree)).not.toContain('연결 실패')
  expect(boundary().props.disabled).toBe(false)
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.post).not.toHaveBeenCalled()
  expect(api.delete).not.toHaveBeenCalled()
})

it('keeps loaded content and close-note input during a failed refresh, then unlocks after GET recovery', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  const noteInput = () => walk(tree).find(node => node.type === 'input' && node.props.maxLength === 200)
  noteInput().props.onChange({ target: { value: '작성 중인 종료 설명' } }); render()
  api.get.mockRejectedValueOnce(new Error('후속 조회 실패'))
  await walk(tree).find(node => node.type === OfferWatch).props.onChanged(); await settle()
  expect(text(tree)).toContain('현재 면접방')
  expect(text(tree)).toContain('이전에 확인한 내용을 표시합니다')
  expect(noteInput().props.value).toBe('작성 중인 종료 설명')
  expect(boundary().props.disabled).toBe(true)
  expect(walk(boundary()).some(node => text(node) === '면접방 다시 불러오기')).toBe(false)
  expect(walk(tree).find(node => node.type === 'test-interview-panel').props).toMatchObject({ disabled: false, writeLocked: true })
  api.get.mockResolvedValueOnce(view('최신 조회 완료'))
  button('면접방 다시 불러오기').props.onClick(); await settle()
  expect(boundary().props.disabled).toBe(false)
  expect(walk(tree).find(node => node.type === 'test-interview-panel').props).toMatchObject({ disabled: false, writeLocked: false })
  expect(noteInput().props.value).toBe('작성 중인 종료 설명')
  expect(text(tree)).not.toContain('이전에 확인한 내용을 표시합니다')
})

const lifecycleActions = [
  { name: 'close', label: '전형 종료하기', status: 'open', method: 'post' },
  { name: 'reopen', label: '전형 다시 진행하기', status: 'closed', method: 'delete' },
  { name: 'archive', label: '이 면접방 보관하기', status: 'open', method: 'post' },
  { name: 'unarchive', label: '보관 해제하기', status: 'open', method: 'delete', archivedAt: '2026-09-19' },
  { name: 'analyze', label: 'AI로 조건 정리하기', status: 'open', method: 'post' },
]
it.each(lifecycleActions)('$name keeps a confirmed mutation successful and locks stale controls until GET-only recovery', async action => {
  const initial = view('유지할 면접방', action.status)
  initial.room.archivedAt = action.archivedAt
  api.get.mockResolvedValueOnce(initial)
  render(); await settle()
  const write = button(action.label).props.onClick
  api[action.method].mockResolvedValueOnce({ terms: {} })
  api.get.mockRejectedValueOnce(new Error('조회 실패'))
  await write(); await settle()
  expect(api[action.method]).toHaveBeenCalledOnce()
  expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledOnce()
  expect(text(tree)).toContain('유지할 면접방')
  expect(boundary().props.disabled).toBe(true)
  // Even an already captured old handler cannot write through the stale state.
  await write(); await settle()
  expect(api[action.method]).toHaveBeenCalledOnce()
  api.get.mockResolvedValueOnce(view('재조회 성공'))
  button('면접방 다시 불러오기').props.onClick(); await settle()
  expect(boundary().props.disabled).toBe(false)
  expect(text(tree)).toContain('재조회 성공')
  expect(api[action.method]).toHaveBeenCalledOnce()
})

it('ignores an older same-room refresh failure after a newer refresh succeeds', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  const reload = walk(tree).find(node => node.type === OfferWatch).props.onChanged
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const oldWork = reload(), currentWork = reload()
  latest.resolve(view('최신 상태')); await currentWork; await settle()
  old.reject(new Error('이전 오류')); await oldWork; await settle()
  expect(text(tree)).toContain('최신 상태')
  expect(text(tree)).not.toContain('이전에 확인한 내용을 표시합니다')
  expect(boundary().props.disabled).toBe(false)
  expect(toast.info).not.toHaveBeenCalled()
})

it('keeps a newer refresh when an earlier post-close refresh completes late', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  const old = deferred()
  api.get.mockReturnValueOnce(old.promise)
  // Two post-write reads may overlap even though their writes are complete.
  api.post.mockResolvedValueOnce({ ok: true })
  const closing = button('전형 종료하기').props.onClick()
  await flush()
  const latest = deferred()
  api.get.mockReturnValueOnce(latest.promise)
  const refresh = walk(tree).find(node => node.type === OfferWatch).props.onChanged()
  latest.resolve(view('종료 확인', 'closed')); await refresh; await settle()
  old.resolve(view('늦은 열린 상태', 'open')); await closing; await settle()
  expect(text(tree)).toContain('종료 확인')
  expect(text(tree)).not.toContain('늦은 열린 상태')
})

it('does not treat an actual rejected close as success or start a follow-up read', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  api.post.mockRejectedValueOnce(Object.assign(new Error('종료 거절'), { status: 400 }))
  await button('전형 종료하기').props.onClick(); await settle()
  expect(toast.error).toHaveBeenCalledWith('종료 거절')
  expect(toast.success).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledOnce()
  expect(boundary().props.disabled).toBe(false)
})

it.each(lifecycleActions)('$name prevents duplicate calls before a React rerender and ignores its result after unmount', async action => {
  const initial = view('현재 방', action.status)
  initial.room.archivedAt = action.archivedAt
  api.get.mockResolvedValueOnce(initial)
  render(); await settle()
  const pending = deferred()
  api[action.method].mockReturnValueOnce(pending.promise)
  const write = button(action.label).props.onClick
  const first = write(), second = write()
  expect(api[action.method]).toHaveBeenCalledOnce()
  unmount()
  pending.resolve({ terms: {} }); await first; await second; await flush()
  expect(api.get).toHaveBeenCalledOnce()
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(host.dirty).toBe(false)
})

it.each(['success', 'error'])('ignores a pending initial view %s after unmount', async result => {
  const pending = deferred()
  api.get.mockReturnValueOnce(pending.promise)
  render(); unmount()
  if (result === 'success') pending.resolve(view())
  else pending.reject(new Error('늦은 실패'))
  await flush()
  expect(host.dirty).toBe(false)
  expect(toast.error).not.toHaveBeenCalled()
})

it.each(['summary', 'hire'])('%s guards duplicate submissions and suppresses late result/refresh after unmount', async action => {
  const refresh = vi.fn().mockResolvedValue({})
  component = action === 'summary' ? InterviewSummary : OfferWatch
  props = action === 'summary'
    ? { roomId: 'room-a', canWrite: true, messageCount: 1, record: null, onChanged: refresh }
    : { roomId: 'room-a', offer: { established: true, basis: 'phrase' }, onChanged: refresh }
  render()
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const write = button(action === 'summary' ? 'AI로 면접 정리하기' : '채용 확정으로 기록').props.onClick
  const first = write(), second = write()
  expect(api.post).toHaveBeenCalledOnce()
  unmount(); pending.resolve({ ok: true }); await first; await second; await flush()
  expect(refresh).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(host.dirty).toBe(false)
})

const malformedViews = [
  null,
  {},
  { ...view(), room: null },
  { ...view(), room: { ...view().room, id: 'another-room' } },
  { ...view(), room: { ...view().room, participants: null } },
  { ...view(), room: { ...view().room, participants: [null] } },
  { ...view(), messages: null },
  { ...view(), messages: [null] },
  { ...view(), documents: {} },
]
it.each(malformedViews.map((data, index) => ({ data, index })))('malformed initial view $index stays recoverable instead of crashing or loading forever', async ({ data }) => {
  api.get.mockResolvedValueOnce(data)
  render(); await settle()
  expect(text(tree)).toContain('면접방 응답을 확인하지 못했습니다')
  expect(button('면접방 다시 불러오기')).toBeDefined()
  api.get.mockResolvedValueOnce(view('정상 재조회'))
  button('면접방 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('정상 재조회')
  expect(boundary().props.disabled).toBe(false)
})

it('keeps the last usable view when a post-write refresh has malformed data', async () => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  api.post.mockResolvedValueOnce({ ok: true })
  api.get.mockResolvedValueOnce({ room: null, messages: [] })
  button('전형 종료하기').props.onClick(); await settle()
  expect(text(tree)).toContain('현재 면접방')
  expect(text(tree)).toContain('이전에 확인한 내용을 표시합니다')
  expect(boundary().props.disabled).toBe(true)
  expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
})

it.each(lifecycleActions.flatMap(action => [undefined, 408, 500, 503].map(status => ({ ...action, httpStatus: status }))))('$name with unclear write response $httpStatus locks stale controls without claiming failure or resending', async action => {
  const initial = view('기존 조회', action.status)
  initial.room.archivedAt = action.archivedAt
  api.get.mockResolvedValueOnce(initial)
  render(); await settle()
  const write = button(action.label).props.onClick
  api[action.method].mockRejectedValueOnce(Object.assign(new Error('응답 없음'), { status: action.httpStatus }))
  await write(); await settle()
  expect(boundary().props.disabled).toBe(true)
  expect(text(tree)).toContain('요청의 처리 결과를 확인하지 못했습니다')
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledOnce()
  await write(); await settle()
  expect(api[action.method]).toHaveBeenCalledOnce()
  api.get.mockResolvedValueOnce(view('처리 결과 재확인'))
  button('면접방 다시 불러오기').props.onClick(); await settle()
  expect(boundary().props.disabled).toBe(false)
  expect(text(tree)).not.toContain('요청의 처리 결과를 확인하지 못했습니다')
  expect(api[action.method]).toHaveBeenCalledOnce()
})

it.each(['summary', 'hire'])('%s forwards its actual write error to the room uncertainty boundary without refreshing', async action => {
  const refresh = vi.fn(), onWriteError = vi.fn()
  component = action === 'summary' ? InterviewSummary : OfferWatch
  props = action === 'summary'
    ? { roomId: 'room-a', canWrite: true, messageCount: 1, record: null, onChanged: refresh, onWriteError }
    : { roomId: 'room-a', offer: { established: true, basis: 'phrase' }, onChanged: refresh, onWriteError }
  render()
  const error = Object.assign(new Error('불명확한 결과'), { status: 503 })
  api.post.mockRejectedValueOnce(error)
  await button(action === 'summary' ? 'AI로 면접 정리하기' : '채용 확정으로 기록').props.onClick(); await settle()
  expect(onWriteError).toHaveBeenCalledWith(error)
  expect(refresh).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
})

it.each([InterviewSummary, OfferWatch])('room uncertainty boundary invalidates older reads when a child write result is unknown', async child => {
  api.get.mockResolvedValueOnce(view())
  render(); await settle()
  const controls = walk(tree).find(node => node.type === child).props
  const earlier = deferred()
  api.get.mockReturnValueOnce(earlier.promise)
  const reading = controls.onChanged()
  controls.onWriteError(Object.assign(new Error('결과 불명확'), { status: 500 })); render()
  earlier.resolve(view('쓰기 이전 스냅샷')); await reading; await settle()
  expect(text(tree)).not.toContain('쓰기 이전 스냅샷')
  expect(text(tree)).toContain('요청의 처리 결과를 확인하지 못했습니다')
  expect(boundary().props.disabled).toBe(true)
  expect(button('면접방 다시 불러오기')).toBeDefined()
})

it('closes the acknowledgement overlay after an unclear write so GET recovery is reachable', async () => {
  const initial = view()
  initial.offer = { established: true, risk: { remedies: [], lawfulGrounds: [] } }
  api.get.mockResolvedValueOnce(initial)
  render(); await settle()
  button('채용내정 취소 진행').props.onClick(); render()
  const modal = walk(tree).find(node => node.type === 'test-withdrawal-modal')
  expect(modal).toBeDefined()
  api.post.mockRejectedValueOnce(new Error('응답 유실'))
  await modal.props.onConfirm(); await settle()
  expect(walk(tree).some(node => node.type === 'test-withdrawal-modal')).toBe(false)
  expect(button('면접방 다시 불러오기')).toBeDefined()
  expect(boundary().props.disabled).toBe(true)
})
