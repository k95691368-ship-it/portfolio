import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
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
vi.mock('../src/api/client.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, roomDoorFor: () => 'account',
}))
import { api } from '../src/api/client.js'
import InterviewSessionPanel from '../src/features/interview/InterviewSessionPanel.jsx'
import InterviewSlotPicker from '../src/features/interview/InterviewSlotPicker.jsx'

let component, props, tree
const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const form = className => walk(tree).find(node => node.type === 'form' && node.props.className === className)
const field = predicate => walk(tree).find(node => ['input', 'select'].includes(node.type) && predicate(node))
const event = () => ({ preventDefault: vi.fn() })
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
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve() }
async function settle() { await flush(); render() }
function unmount() { for (const cell of host.cells) cell?.cleanup?.(); host.dirty = false }
const session = (id = 'session-a', title = '원래 일정') => ({
  id, title, status: 'scheduled', myRole: 'host', scheduledAt: '2026-10-01T03:00:00Z',
  recordingRequired: false, members: [],
})
const slot = id => ({ id, startsAt: '2026-10-02T03:00:00Z', available: true, durationMinutes: 30, recordingRequired: true })
async function panelWithSession() {
  const loaded = session()
  api.get.mockResolvedValueOnce({ sessions: [loaded] }).mockResolvedValueOnce(loaded)
  render(); await settle()
}
async function companySlots() {
  component = InterviewSlotPicker
  props = { roomId: 'room-a', isCompany: true, disabled: false, writeLocked: false, onChanged: vi.fn().mockResolvedValue(null) }
  api.get.mockResolvedValue({ slots: [] })
  render(); await settle()
  field(node => node.props.type === 'datetime-local').props.onChange({ target: { value: '2026-10-02T12:00' } }); render()
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  component = InterviewSessionPanel
  props = { roomId: 'room-a', roomTitle: '채용', myRole: 'company', disabled: false, writeLocked: false }
  vi.stubGlobal('window', { confirm: vi.fn(() => true), location: { origin: 'http://localhost' } })
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden') }))
})
afterEach(() => { unmount(); vi.unstubAllGlobals() })

it('control: creates a schedule and loads its detail normally', async () => {
  api.get.mockResolvedValueOnce({ sessions: [] })
  render(); await settle()
  api.post.mockResolvedValueOnce(session('created', '생성 확인'))
  api.get.mockResolvedValueOnce(session('created', '생성 확인'))
  await form('interview-session-form').props.onSubmit(event()); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(text(tree)).toContain('생성 확인')
  expect(form('interview-session-form')).toBeUndefined()
})

it('keeps confirmed schedule creation separate from a failed detail GET and offers GET-only recovery', async () => {
  api.get.mockResolvedValueOnce({ sessions: [] })
  render(); await settle()
  api.post.mockResolvedValueOnce(session('created', '생성된 일정'))
  api.get.mockRejectedValueOnce(new Error('상세 조회 실패'))
  await form('interview-session-form').props.onSubmit(event()); await settle()
  expect(text(tree)).toContain('일정은 생성되었습니다')
  expect(button('일정 다시 불러오기')).toBeDefined()
  expect(api.post).toHaveBeenCalledOnce()
  api.get.mockResolvedValueOnce({ sessions: [session('created', '생성된 일정')] }).mockResolvedValueOnce(session('created', '생성된 일정'))
  button('일정 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('생성된 일정')
  expect(button('일정 다시 불러오기')).toBeUndefined()
  expect(api.post).toHaveBeenCalledOnce()
})

it('retains the next interviewer email typed while the previous add is pending', async () => {
  await panelWithSession()
  const input = () => field(node => node.props.id === 'interview-member-email')
  input().props.onChange({ target: { value: 'first@example.com' } }); render()
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form('interview-member-form').props.onSubmit(event()); render()
  input().props.onChange({ target: { value: 'next@example.com' } }); render()
  pending.resolve({ members: [] }); await writing; await settle()
  expect(input().props.value).toBe('next@example.com')
})

it('retains a newly entered available time while the previous registration is pending', async () => {
  await companySlots()
  const input = () => field(node => node.props.type === 'datetime-local')
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  form('interview-session-form').props.onSubmit(event()); render()
  input().props.onChange({ target: { value: '2026-10-03T14:00' } }); render()
  pending.resolve({ id: 'slot-created' }); await settle()
  expect(input().props.value).toBe('2026-10-03T14:00')
})

it('does not hide a next schedule draft typed while the previous creation is pending', async () => {
  api.get.mockResolvedValueOnce({ sessions: [] })
  render(); await settle()
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form('interview-session-form').props.onSubmit(event()); render()
  field(node => node.props.maxLength === 120).props.onChange({ target: { value: '다음 일정 초안' } }); render()
  api.get.mockResolvedValueOnce(session('created'))
  pending.resolve(session('created')); await writing; await settle()
  expect(form('interview-session-form')).toBeDefined()
  expect(field(node => node.props.maxLength === 120).props.value).toBe('다음 일정 초안')
})

it.each(['create', 'member', 'slot'])('%s ignores a second submit in the same tick before rerender', async action => {
  if (action === 'slot') await companySlots()
  else if (action === 'member') {
    await panelWithSession()
    field(node => node.props.id === 'interview-member-email').props.onChange({ target: { value: 'member@example.com' } }); render()
  } else { api.get.mockResolvedValueOnce({ sessions: [] }); render(); await settle() }
  const pending = deferred()
  api.post.mockReturnValue(pending.promise)
  const submit = form(action === 'member' ? 'interview-member-form' : 'interview-session-form').props.onSubmit
  const first = submit(event()), second = submit(event())
  api.get.mockResolvedValue(action === 'slot' ? { slots: [] } : session('created'))
  pending.resolve(action === 'member' ? { members: [] } : action === 'slot' ? { id: 'slot-created' } : session('created'))
  await first; await second; await settle()
  expect(api.post).toHaveBeenCalledOnce()
})

it('keeps the newer session read when an older refresh completes later', async () => {
  await panelWithSession()
  const reload = walk(tree).find(node => node.type === InterviewSlotPicker).props.onChanged
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    .mockImplementation(path => Promise.resolve(path.endsWith('/new') ? session('new', '최신 일정') : session('old', '이전 일정')))
  const first = reload(), second = reload()
  latest.resolve({ sessions: [session('new', '최신 일정')] }); await second; await settle()
  old.resolve({ sessions: [session('old', '이전 일정')] }); await first; await settle()
  expect(text(tree)).toContain('최신 일정')
  expect(text(tree)).not.toContain('이전 일정')
})

it('keeps the newer available-time read when an older refresh completes later', async () => {
  await companySlots()
  const reload = button('새로고침').props.onClick
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  reload(); reload()
  latest.resolve({ slots: [slot('new')] }); await settle()
  old.resolve({ slots: [slot('old')] }); await settle()
  expect(walk(tree).some(node => node.type === 'li' && node.key === 'new')).toBe(true)
  expect(walk(tree).some(node => node.type === 'li' && node.key === 'old')).toBe(false)
})

it.each(['panel', 'slots'])('%s ignores a pending initial GET after unmount', async target => {
  if (target === 'slots') { component = InterviewSlotPicker; props = { roomId: 'room-a', isCompany: true } }
  const pending = deferred()
  api.get.mockReturnValueOnce(pending.promise)
  render(); unmount()
  pending.resolve(target === 'slots' ? { slots: [] } : { sessions: [] }); await flush()
  expect(host.dirty).toBe(false)
})

it('offers GET-only recovery after the initial session list fails', async () => {
  api.get.mockRejectedValueOnce(new Error('일정 조회 실패'))
  render(); await settle()
  expect(button('일정 다시 불러오기')).toBeDefined()
  api.get.mockResolvedValueOnce({ sessions: [] })
  button('일정 다시 불러오기').props.onClick(); await settle()
  expect(form('interview-session-form')).toBeDefined()
  expect(button('일정 만들기').props.disabled).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it.each([null, {}, { sessions: null }, { sessions: [{}] }])('handles a malformed schedule-list response with GET recovery: %j', async response => {
  api.get.mockResolvedValueOnce(response)
  render(); await settle()
  expect(text(tree)).toContain('일정 목록 응답을 확인하지 못했습니다')
  expect(button('일정 다시 불러오기')).toBeDefined()
  expect(form('interview-session-form')).toBeUndefined()
})

it('keeps the current schedule and mounted SlotPicker when refreshing its detail fails', async () => {
  await panelWithSession()
  const initialPicker = walk(tree).find(node => node.type === InterviewSlotPicker)
  api.get.mockResolvedValueOnce({ sessions: [session()] }).mockResolvedValueOnce(null)
  await initialPicker.props.onChanged().catch(() => {}); await settle()
  expect(text(tree)).toContain('원래 일정')
  expect(text(tree)).toContain('일정 상세 응답을 확인하지 못했습니다')
  const retained = walk(tree).find(node => node.type === InterviewSlotPicker)
  expect(retained.type).toBe(initialPicker.type)
  expect(retained.key).toBe(initialPicker.key)
  expect(retained.props.writeLocked).toBe(true)
  expect(walk(tree).some(node => node.type === 'a' && node.props.className === 'interview-enter-link')).toBe(false)
})

it.each([null, {}, { slots: null }, { slots: [null] }])('keeps slot errors recoverable without replacing the last usable list: %j', async response => {
  await companySlots()
  api.get.mockResolvedValueOnce(response)
  button('새로고침').props.onClick(); await settle()
  expect(text(tree)).toContain('가능한 시간 응답을 확인하지 못했습니다')
  expect(button('시간 등록').props.disabled).toBe(true)
  api.get.mockResolvedValueOnce({ slots: [slot('recovered')] })
  button('새로고침').props.onClick(); await settle()
  expect(walk(tree).some(node => node.type === 'li' && node.key === 'recovered')).toBe(true)
  expect(button('시간 등록').props.disabled).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('keeps a confirmed time registration successful when the parent refresh fails and retries only GET work', async () => {
  await companySlots()
  props.onChanged.mockRejectedValueOnce(new Error('일정 조회 실패'))
  api.post.mockResolvedValueOnce({ id: 'slot-new' })
  const submit = form('interview-session-form').props.onSubmit
  submit(event()); await settle()
  expect(text(tree)).toContain('시간은 등록되었습니다')
  expect(text(tree)).toContain('일정 조회 실패')
  expect(button('시간 등록').props.disabled).toBe(true)
  submit(event()); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  button('새로고침').props.onClick(); await settle()
  expect(button('시간 등록').props.disabled).toBe(false)
  expect(api.post).toHaveBeenCalledOnce()
  expect(props.onChanged).toHaveBeenCalledTimes(2)
})

it.each(['create', 'member', 'cancel', 'slot'])('%s blocks resending an unknown write outcome and offers read-only recovery', async action => {
  if (action === 'slot') await companySlots()
  else if (action === 'create') { api.get.mockResolvedValueOnce({ sessions: [] }); render(); await settle() }
  else {
    await panelWithSession()
    field(node => node.props.id === 'interview-member-email').props.onChange({ target: { value: 'member@example.com' } }); render()
  }
  const method = action === 'cancel' ? api.patch : api.post
  method.mockRejectedValueOnce(Object.assign(new Error('응답을 받지 못함'), { status: 503 }))
  const submit = action === 'cancel' ? button('일정 취소').props.onClick : form(action === 'member' ? 'interview-member-form' : 'interview-session-form').props.onSubmit
  await submit(event()); await settle()
  expect(text(tree)).toContain('처리 결과를 확인하지 못했습니다')
  await submit(event()); await settle()
  expect(method).toHaveBeenCalledOnce()
  if (action === 'slot') button('새로고침').props.onClick()
  else {
    api.get.mockResolvedValueOnce({ sessions: [session('confirmed', '서버에서 확인한 일정')] }).mockResolvedValueOnce(session('confirmed', '서버에서 확인한 일정'))
    button('일정 다시 불러오기').props.onClick()
  }
  await settle()
  expect(text(tree)).not.toContain('처리 결과를 확인하지 못했습니다')
  if (action === 'create') expect(text(tree)).toContain('서버에서 확인한 일정')
  expect(method).toHaveBeenCalledOnce()
})

it.each(['create', 'member', 'slot'])('%s suppresses write completion and follow-up reads after unmount', async action => {
  if (action === 'slot') await companySlots()
  else if (action === 'create') { api.get.mockResolvedValueOnce({ sessions: [] }); render(); await settle() }
  else {
    await panelWithSession()
    field(node => node.props.id === 'interview-member-email').props.onChange({ target: { value: 'member@example.com' } }); render()
  }
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form(action === 'member' ? 'interview-member-form' : 'interview-session-form').props.onSubmit(event())
  const previousReads = api.get.mock.calls.length
  unmount(); pending.resolve(action === 'member' ? { members: [] } : action === 'slot' ? { id: 'slot-created' } : session('created'))
  await writing; await flush()
  expect(host.dirty).toBe(false)
  expect(api.get).toHaveBeenCalledTimes(previousReads)
  if (action === 'slot') expect(props.onChanged).not.toHaveBeenCalled()
})

it('keeps a different schedule draft when GET recovery finds the previously unconfirmed creation', async () => {
  api.get.mockResolvedValueOnce({ sessions: [] })
  render(); await settle()
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form('interview-session-form').props.onSubmit(event()); render()
  field(node => node.props.maxLength === 120).props.onChange({ target: { value: '다음 면접 초안' } }); render()
  pending.reject(Object.assign(new Error('응답 유실'), { status: 503 }))
  await writing; await settle()
  api.get.mockResolvedValueOnce({ sessions: [session('saved', '이미 생성된 일정')] }).mockResolvedValueOnce(session('saved', '이미 생성된 일정'))
  button('일정 다시 불러오기').props.onClick(); await settle()
  expect(form('interview-session-form')).toBeDefined()
  expect(field(node => node.props.maxLength === 120).props.value).toBe('다음 면접 초안')
  expect(api.post).toHaveBeenCalledOnce()
})

it.each(['panel', 'slots'])('%s ignores a previous read failure after the newest successful read', async target => {
  let reload
  if (target === 'slots') { await companySlots(); reload = button('새로고침').props.onClick }
  else { await panelWithSession(); reload = walk(tree).find(node => node.type === InterviewSlotPicker).props.onChanged }
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const first = reload(), second = reload()
  if (target === 'panel') api.get.mockResolvedValueOnce(session('new', '정상 최신 일정'))
  latest.resolve(target === 'slots' ? { slots: [slot('new')] } : { sessions: [session('new', '정상 최신 일정')] })
  await second; await settle()
  old.reject(new Error('과거 오류')); await first; await settle()
  expect(text(tree)).not.toContain('과거 오류')
  if (target === 'panel') expect(text(tree)).toContain('정상 최신 일정')
  else expect(button('시간 등록').props.disabled).toBe(false)
})

it.each(['panel', 'slots'])('%s survives StrictMode effect replay with only the latest live read', async target => {
  if (target === 'slots') { component = InterviewSlotPicker; props = { roomId: 'room-a', isCompany: true } }
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  render()
  for (const cell of host.cells) if (cell?.effect) { cell.cleanup?.(); cell.cleanup = cell.effect() }
  latest.resolve(target === 'slots' ? { slots: [] } : { sessions: [] }); await settle()
  old.reject(new Error('이전 effect 오류')); await settle()
  expect(text(tree)).not.toContain('이전 effect 오류')
  expect(button(target === 'slots' ? '시간 등록' : '일정 만들기').props.disabled).toBe(false)
})

// The live handlers return POST slot { id }, DELETE slot { withdrawn: true },
// and POST/PATCH interview { session: serializeSession(...) }; HTTP 2xx alone
// must not confirm a write with an unusable or unrelated response body.
const selectedSlot = slot('selected-slot')
const bookingResponse = (id = 'booked-session', overrides = {}) => ({ session: {
  ...session(id), roomId: 'room-a', bookingSlotId: selectedSlot.id,
  scheduledAt: selectedSlot.startsAt, durationMinutes: selectedSlot.durationMinutes,
  recordingRequired: selectedSlot.recordingRequired, ...overrides,
} })
async function slotMutation(action) {
  component = InterviewSlotPicker
  props = {
    roomId: 'room-a', isCompany: ['add', 'withdraw'].includes(action),
    disabled: false, writeLocked: false, onChanged: vi.fn().mockResolvedValue(null),
    session: action === 'reschedule' ? bookingResponse('existing-session').session : null,
  }
  api.get.mockResolvedValue({ slots: [selectedSlot] })
  render(); await settle()
  if (action === 'add') field(node => node.props.type === 'datetime-local').props.onChange({ target: { value: '2026-10-03T12:00' } })
  else if (action !== 'withdraw') field(node => node.type === 'select').props.onChange({ target: { value: selectedSlot.id } })
  render()
  return {
    method: action === 'withdraw' ? api.delete : action === 'reschedule' ? api.patch : api.post,
    invoke: action === 'withdraw' ? button('철회').props.onClick : () => form('interview-session-form').props.onSubmit(event()),
    success: action === 'add' ? { id: 'new-slot' } : action === 'withdraw' ? { withdrawn: true }
      : bookingResponse(action === 'reschedule' ? 'existing-session' : 'new-session'),
  }
}

it.each(['add', 'book', 'reschedule', 'withdraw'])('%s accepts the actual server success response and then refreshes', async action => {
  const mutation = await slotMutation(action)
  mutation.method.mockResolvedValueOnce(mutation.success)
  mutation.invoke(); await settle()
  expect(text(tree)).toContain(action === 'add' ? '시간은 등록되었습니다' : '변경은 저장되었습니다')
  expect(props.onChanged).toHaveBeenCalledOnce()
  if (action === 'add') expect(field(node => node.props.type === 'datetime-local').props.value).toBe('')
  else if (action !== 'withdraw') expect(field(node => node.type === 'select').props.value).toBe('')
})

const malformedWrites = ['add', 'book', 'reschedule', 'withdraw'].flatMap(action => [
  [action, 'null', null], [action, 'empty body', {}],
  [action, 'invalid proof', action === 'withdraw' ? { withdrawn: false } : action === 'add' ? { id: '  ' } : bookingResponse(42)],
])
malformedWrites.push(
  ['book', 'different selected slot', bookingResponse('new-session', { bookingSlotId: 'other-slot' })],
  ['book', 'different room', bookingResponse('new-session', { roomId: 'other-room' })],
  ['reschedule', 'different session id', bookingResponse('other-session')],
  ['reschedule', 'different selected slot', bookingResponse('existing-session', { bookingSlotId: 'other-slot' })],
  ['book', 'missing duration', bookingResponse('new-session', { durationMinutes: undefined })],
  ['book', 'different scheduled time', bookingResponse('new-session', { scheduledAt: '2026-10-03T03:00:00Z' })],
  ['reschedule', 'missing recording condition', bookingResponse('existing-session', { recordingRequired: undefined })],
  ['reschedule', 'different duration', bookingResponse('existing-session', { durationMinutes: 60 })],
)
it.each(malformedWrites)('%s retains input and pauses unconfirmed writes for a 2xx %s', async (action, _description, response) => {
  const mutation = await slotMutation(action)
  mutation.method.mockResolvedValueOnce(response)
  mutation.invoke(); await settle()
  expect(text(tree)).toContain('처리 결과를 확인하지 못했습니다')
  expect(text(tree)).not.toContain('시간은 등록되었습니다')
  expect(text(tree)).not.toContain('변경은 저장되었습니다')
  expect(props.onChanged).not.toHaveBeenCalled()
  if (action === 'add') expect(field(node => node.props.type === 'datetime-local').props.value).toBe('2026-10-03T12:00')
  else if (action !== 'withdraw') expect(field(node => node.type === 'select').props.value).toBe(selectedSlot.id)
  mutation.invoke(); await settle()
  expect(mutation.method).toHaveBeenCalledOnce()
  button('새로고침').props.onClick(); await settle()
  expect(props.onChanged).toHaveBeenCalledOnce()
  expect(mutation.method).toHaveBeenCalledOnce()
  expect(text(tree)).not.toContain('처리 결과를 확인하지 못했습니다')
})

it.each([
  ['empty id', { id: '' }], ['blank id', { id: ' ' }], ['unusable date', { startsAt: 'not-a-date' }],
  ['missing availability', { available: undefined }], ['string availability', { available: 'false' }],
  ['missing recording condition', { recordingRequired: undefined }], ['numeric recording condition', { recordingRequired: 0 }],
  ['missing duration', { durationMinutes: undefined }], ['string duration', { durationMinutes: '30' }],
  ['unsupported duration', { durationMinutes: 17 }],
])('retains the last valid slot list and locks actions for %s in GET', async (_description, invalid) => {
  const mutation = await slotMutation('withdraw')
  api.get.mockResolvedValueOnce({ slots: [{ ...slot('invalid-slot'), ...invalid }] })
  button('새로고침').props.onClick(); await settle()
  expect(text(tree)).toContain('가능한 시간 응답을 확인하지 못했습니다')
  expect(walk(tree).some(node => node.type === 'li' && node.key === selectedSlot.id)).toBe(true)
  expect(walk(tree).some(node => node.type === 'li' && node.key === 'invalid-slot')).toBe(false)
  expect(button('철회').props.disabled).toBe(true)
  mutation.invoke(); await settle()
  expect(api.delete).not.toHaveBeenCalled()
  button('새로고침').props.onClick(); await settle()
  expect(button('철회').props.disabled).toBe(false)
})

it('keeps valid false booleans and every supported duration in slot GET responses', async () => {
  await companySlots()
  const slots = [15, 30, 45, 60, 90, 120].map(durationMinutes => ({
    ...slot(`duration-${durationMinutes}`), durationMinutes, available: false, recordingRequired: false,
  }))
  api.get.mockResolvedValueOnce({ slots })
  button('새로고침').props.onClick(); await settle()
  expect(text(tree)).not.toContain('가능한 시간 응답을 확인하지 못했습니다')
  expect(walk(tree).filter(node => node.type === 'li')).toHaveLength(6)
  expect(button('시간 등록').props.disabled).toBe(false)
})
