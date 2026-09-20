import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Execute each real component with a deterministic hook host. Prop transitions
// model the same mounted form while the parent room view becomes uncertain.
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
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  roomDoorFor: () => 'account',
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
async function settle() { for (let index = 0; index < 16; index++) await Promise.resolve(); render() }
function lock(value) { props = { ...props, writeLocked: value }; render() }
const session = role => ({
  id: 'session-a', title: '면접 일정', status: 'scheduled', myRole: role,
  bookingSlotId: role === 'candidate' ? 'slot-a' : null,
  scheduledAt: '2026-10-01T03:00:00Z', recordingRequired: true,
  members: [{ userId: 'interviewer-a', displayName: '면접관', role: 'interviewer' }],
})
const slot = { id: 'slot-a', startsAt: '2026-10-02T03:00:00Z', available: true, durationMinutes: 30, recordingRequired: true }

beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  component = InterviewSessionPanel
  props = { roomId: 'room-a', roomTitle: '채용', myRole: 'company', disabled: false, writeLocked: false }
  vi.stubGlobal('window', { confirm: vi.fn(() => true), location: { origin: 'http://localhost' } })
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden') }))
})
afterEach(() => { for (const cell of host.cells) cell?.cleanup?.(); vi.unstubAllGlobals() })

it('keeps schedule fields and SlotPicker mounted while temporary locking, then restores editing', async () => {
  api.get.mockResolvedValueOnce({ sessions: [] })
  render(); await settle()
  field(node => node.props.maxLength === 120).props.onChange({ target: { value: '입력 중인 면접 제목' } })
  field(node => node.props.type === 'datetime-local').props.onChange({ target: { value: '2026-10-01T12:00' } })
  field(node => node.type === 'select').props.onChange({ target: { value: '45' } })
  field(node => node.props.type === 'checkbox').props.onChange({ target: { checked: false } })
  render()
  const submit = form('interview-session-form').props.onSubmit
  const originalPicker = walk(tree).find(node => node.type === InterviewSlotPicker)
  lock(true)
  expect(form('interview-session-form')).toBeDefined()
  expect(field(node => node.props.maxLength === 120).props.value).toBe('입력 중인 면접 제목')
  expect(field(node => node.props.type === 'datetime-local').props.value).toBe('2026-10-01T12:00')
  expect(field(node => node.type === 'select').props.value).toBe(45)
  expect(field(node => node.props.type === 'checkbox').props.checked).toBe(false)
  expect(walk(form('interview-session-form')).filter(node => ['input', 'select', 'button'].includes(node.type)).every(node => node.props.disabled)).toBe(true)
  const lockedPicker = walk(tree).find(node => node.type === InterviewSlotPicker)
  expect(lockedPicker.type).toBe(originalPicker.type)
  expect(lockedPicker.key).toBe(originalPicker.key)
  expect(lockedPicker.props).toMatchObject({ disabled: false, writeLocked: true })
  expect(text(tree)).toContain('작성 중인 내용은 유지됩니다')
  expect(text(tree)).not.toContain('보관되거나 종료된')
  await submit(event()); await settle()
  expect(api.post).not.toHaveBeenCalled()
  lock(false)
  expect(field(node => node.props.maxLength === 120).props.value).toBe('입력 중인 면접 제목')
  expect(button('일정 만들기').props.disabled).toBe(false)
  expect(api.get).toHaveBeenCalledOnce()
})

it('retains the member form but removes entry links and rejects captured write/link handlers during temporary lock', async () => {
  const loaded = session('host')
  api.get.mockResolvedValueOnce({ sessions: [loaded] }).mockResolvedValueOnce(loaded)
  render(); await settle()
  field(node => node.props.id === 'interview-member-email').props.onChange({ target: { value: 'member@example.com' } }); render()
  const submit = form('interview-member-form').props.onSubmit
  const remove = button('제외').props.onClick
  const cancel = button('일정 취소').props.onClick
  const copy = button('참석 링크 복사').props.onClick
  const link = walk(tree).find(node => node.type === 'a' && node.props.className === 'interview-enter-link')
  lock(true)
  expect(form('interview-member-form')).toBeDefined()
  expect(field(node => node.props.id === 'interview-member-email').props).toMatchObject({ value: 'member@example.com', disabled: true })
  expect(button('면접관 추가').props.disabled).toBe(true)
  expect(button('제외').props.disabled).toBe(true)
  expect(button('일정 취소').props.disabled).toBe(true)
  expect(walk(tree).some(node => node.type === 'a' && node.props.className === 'interview-enter-link')).toBe(false)
  expect(text(tree)).toContain('면접방 상태 확인 후 입장할 수 있습니다')
  expect(text(tree)).not.toContain('참가자 입장이 시작되었거나')
  const clicking = event()
  link.props.onClick(clicking)
  expect(clicking.preventDefault).toHaveBeenCalledOnce()
  await submit(event()); await remove(); await cancel(); await copy(); await settle()
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled()
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  lock(false)
  expect(field(node => node.props.id === 'interview-member-email').props.value).toBe('member@example.com')
  expect(walk(tree).some(node => node.type === 'a' && node.props.className === 'interview-enter-link')).toBe(true)
})

it('also prevents candidate entry while temporarily locked without calling it an archived room', async () => {
  const loaded = session('candidate')
  props.myRole = 'candidate'
  api.get.mockResolvedValueOnce({ sessions: [loaded] }).mockResolvedValueOnce(loaded)
  render(); await settle(); lock(true)
  expect(walk(tree).some(node => node.type === 'a')).toBe(false)
  expect(text(tree)).toContain('면접방 상태 확인 후 입장할 수 있습니다')
  expect(text(tree)).not.toContain('보관되거나 종료된')
  expect(walk(tree).find(node => node.type === InterviewSlotPicker).props).toMatchObject({ disabled: false, writeLocked: true })
})

it('keeps the real archived/closed restriction separate from temporary lock', async () => {
  props.disabled = true
  api.get.mockResolvedValueOnce({ sessions: [] })
  render(); await settle()
  expect(form('interview-session-form')).toBeUndefined()
  expect(text(tree)).toContain('보관되거나 종료된 면접방에서는')
  expect(text(tree)).not.toContain('작성 중인 내용은 유지됩니다')
  expect(walk(tree).find(node => node.type === InterviewSlotPicker).props.disabled).toBe(true)
})

it('preserves available-time registration input and blocks captured registration/withdrawal handlers', async () => {
  component = InterviewSlotPicker
  props = { roomId: 'room-a', isCompany: true, disabled: false, writeLocked: false, onChanged: vi.fn() }
  api.get.mockResolvedValueOnce({ slots: [slot] })
  render(); await settle()
  field(node => node.props.type === 'datetime-local').props.onChange({ target: { value: '2026-10-02T12:00' } })
  field(node => node.type === 'select').props.onChange({ target: { value: '60' } })
  field(node => node.props.type === 'checkbox').props.onChange({ target: { checked: false } }); render()
  const submit = form('interview-session-form').props.onSubmit, withdraw = button('철회').props.onClick
  lock(true)
  expect(form('interview-session-form')).toBeDefined()
  expect(field(node => node.props.type === 'datetime-local').props).toMatchObject({ value: '2026-10-02T12:00', disabled: true })
  expect(field(node => node.type === 'select').props).toMatchObject({ value: 60, disabled: true })
  expect(field(node => node.props.type === 'checkbox').props).toMatchObject({ checked: false, disabled: true })
  expect(button('시간 등록').props.disabled).toBe(true)
  expect(button('철회').props.disabled).toBe(true)
  submit(event()); withdraw(); await settle()
  expect(api.post).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
  lock(false)
  expect(field(node => node.props.type === 'datetime-local').props.value).toBe('2026-10-02T12:00')
  expect(button('시간 등록').props.disabled).toBe(false)
  expect(api.get).toHaveBeenCalledOnce()
})

it.each([false, true])('preserves candidate time selection while temporarily locked (rescheduling=%s)', async rescheduling => {
  component = InterviewSlotPicker
  props = { roomId: 'room-a', isCompany: false, disabled: false, writeLocked: false, session: rescheduling ? session('candidate') : null, onChanged: vi.fn() }
  api.get.mockResolvedValueOnce({ slots: [slot] })
  render(); await settle()
  field(node => node.type === 'select').props.onChange({ target: { value: 'slot-a' } }); render()
  const submit = form('interview-session-form').props.onSubmit
  lock(true)
  expect(form('interview-session-form')).toBeDefined()
  expect(field(node => node.type === 'select').props).toMatchObject({ value: 'slot-a', disabled: true })
  expect(button(rescheduling ? '선택한 시간으로 변경' : '선택한 시간으로 예약').props.disabled).toBe(true)
  submit(event()); await settle()
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
  lock(false)
  expect(field(node => node.type === 'select').props).toMatchObject({ value: 'slot-a', disabled: false })
  expect(api.get).toHaveBeenCalledOnce()
})
