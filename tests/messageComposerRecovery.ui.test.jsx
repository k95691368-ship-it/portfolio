import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const dm = vi.hoisted(() => ({ refresh: vi.fn(), threads: [], unreadTotal: 0, open: { id: 'partner-a', displayName: 'Local partner A' }, listOpen: false, alerts: [] }))
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
      host.cells[index] = { deps, cleanup: previous?.cleanup }
      host.effects.push(() => { previous?.cleanup?.(); host.cells[index].cleanup = effect() })
    }
  },
}))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }))
vi.mock('../src/context/DmContext.jsx', () => ({ useDm: () => dm }))
import { api } from '../src/api/client.js'
import ChatComposer from '../src/components/ChatComposer.jsx'
import DmDock from '../src/components/DmDock.jsx'
import { isDirectMessage, mergeDirectMessages } from '../src/lib/directMessages.js'

const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let component, props, tree
function render() {
  for (let i = 0; i < 12; i++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = component(props)
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('Render loop')
}
const input = () => walk(tree).find(node => ['input', 'textarea'].includes(node.type))
const form = () => walk(tree).find(node => node.type === 'form')
const type = value => { input().props.onChange({ target: { value } }); render() }
const submit = () => form().props.onSubmit({ preventDefault() {} })
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); render() }
const unmount = () => { for (const cell of host.cells) cell.cleanup?.() }
function start(kind, onSend) {
  if (kind === 'chat') { component = ChatComposer; props = { onSend } }
  else {
    const node = walk(DmDock()).find(entry => typeof entry.type === 'function' && entry.type.name === 'DmWindow')
    component = node.type; props = node.props; host.cells = []
  }
  render()
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  dm.open = { id: 'partner-a', displayName: 'Local partner A' }
  vi.stubGlobal('document', { visibilityState: 'visible' }); vi.stubGlobal('setInterval', vi.fn(() => 1)); vi.stubGlobal('clearInterval', vi.fn())
  api.get.mockResolvedValue({ messages: [] })
})
afterEach(() => { unmount(); vi.unstubAllGlobals() })

it.each(['chat', 'dm'])('%s keeps a later draft when an earlier message finishes sending', async kind => {
  const sent = deferred(), onSend = vi.fn(() => sent.promise)
  api.post.mockReturnValue(sent.promise); start(kind, onSend); await settle()
  type('first message'); const pending = submit(); render(); type('next draft')
  sent.resolve({ message: { id: 1, body: 'first message', fromMe: true } }); await pending; render()
  expect(input().props.value).toBe('next draft')
})

it.each(['chat', 'dm'])('%s prevents same-tick double submit before disabled UI commits', async kind => {
  const sent = deferred(), onSend = vi.fn(() => sent.promise)
  api.post.mockReturnValue(sent.promise); start(kind, onSend); await settle(); type('one message')
  const originalSubmit = form().props.onSubmit
  const first = originalSubmit({ preventDefault() {} }), second = originalSubmit({ preventDefault() {} })
  expect(kind === 'chat' ? onSend : api.post).toHaveBeenCalledOnce()
  sent.resolve({ message: { id: 1, body: 'one message', fromMe: true } }); await Promise.all([first, second])
})

it('keeps a confirmed DM visible when an older poll resolves after its POST', async () => {
  const oldRead = deferred(); api.get.mockReturnValueOnce(oldRead.promise)
  api.post.mockResolvedValueOnce({ message: { id: 2, body: 'confirmed local message', fromMe: true } })
  start('dm'); type('confirmed local message'); await submit(); render()
  oldRead.resolve({ messages: [] }); await settle()
  expect(text(tree)).toContain('confirmed local message')
})

it('separates recipient window state when opening another partner', () => {
  const first = walk(DmDock()).find(node => typeof node.type === 'function' && node.type.name === 'DmWindow')
  host.index = 0; dm.open = { id: 'partner-b', displayName: 'Local partner B' }
  const second = walk(DmDock()).find(node => typeof node.type === 'function' && node.type.name === 'DmWindow')
  expect(second.key).not.toBe(first.key)
})

it.each(['chat', 'dm'])('%s clears only the unchanged submitted draft', async kind => {
  const onSend = vi.fn().mockResolvedValue(undefined)
  api.post.mockResolvedValue({ message: { id: 1, body: 'submitted', fromMe: true } })
  start(kind, onSend); await settle(); type('  submitted  ')
  await submit(); render()
  expect(input().props.value).toBe('')
  if (kind === 'chat') expect(onSend).toHaveBeenCalledWith('submitted')
  else expect(api.post).toHaveBeenCalledWith('/dm/partner-a', { body: 'submitted' })
})

it.each(['chat', 'dm'])('%s preserves an edited draft even if it matches the original text again', async kind => {
  const sent = deferred(); api.post.mockReturnValue(sent.promise)
  start(kind, () => sent.promise); await settle(); type('original')
  const pending = submit(); render(); type('different'); type('original')
  sent.resolve({ message: { id: 1, body: 'original', fromMe: true } }); await pending; render()
  expect(input().props.value).toBe('original')
})

it.each(['chat', 'dm'])('%s preserves the current draft on rejection and does not automatically resend', async kind => {
  const sent = deferred(), onSend = vi.fn(() => sent.promise); api.post.mockReturnValue(sent.promise)
  start(kind, onSend); await settle(); type('original')
  const pending = submit(); render(); type('later draft')
  sent.reject(new Error('Local send unavailable')); await pending; render()
  expect(input().props.value).toBe('later draft')
  expect(text(tree)).toContain('Local send unavailable')
  expect(kind === 'chat' ? onSend : api.post).toHaveBeenCalledOnce()
})

it.each(['chat', 'dm'])('%s ignores a send response after its window unmounts', async kind => {
  const sent = deferred(); api.post.mockReturnValue(sent.promise)
  start(kind, () => sent.promise); await settle(); type('original')
  const pending = submit(); render(); unmount(); host.dirty = false
  sent.resolve({ message: { id: 1, body: 'original', fromMe: true } }); await pending
  expect(host.dirty).toBe(false)
})

it('does not erase a send error when a later DM poll succeeds', async () => {
  api.post.mockRejectedValue(new Error('Local send failed'))
  start('dm'); await settle(); type('keep me'); await submit(); render()
  const poll = setInterval.mock.calls[0][0]
  poll(); await settle()
  expect(text(tree)).toContain('Local send failed')
  expect(input().props.value).toBe('keep me')
})

it('serializes DM polls and keeps the acknowledged read receipt', async () => {
  const read = deferred(); api.get.mockReturnValueOnce(read.promise)
  start('dm'); const poll = setInterval.mock.calls[0][0]
  poll(); poll(); expect(api.get).toHaveBeenCalledOnce()
  read.resolve({ messages: [{ id: 1, body: 'message', fromMe: true, readAt: '2026-09-19 06:00:00' }] }); await settle()
  api.get.mockResolvedValueOnce({ messages: [{ id: 1, body: 'message', fromMe: true, readAt: null }] })
  poll(); await settle()
  expect(text(tree)).toContain('읽음')
  expect(api.get).toHaveBeenCalledTimes(2)
})

it('reports a malformed DM list without presenting it as an empty conversation', async () => {
  api.get.mockResolvedValue({ messages: null }); start('dm'); await settle()
  expect(text(tree)).toContain('쪽지 목록을 확인하지 못했습니다.')
  expect(text(tree)).not.toContain('아직 주고받은 쪽지가 없습니다.')
})

it('keeps the submitted DM draft when a success response is malformed', async () => {
  api.post.mockResolvedValue({ message: null }); start('dm'); await settle(); type('uncertain')
  await submit(); render()
  expect(input().props.value).toBe('uncertain')
  expect(text(tree)).toContain('쪽지 전송 결과를 확인하지 못했습니다.')
})

it('merges direct messages without duplication and keeps only the latest 200', () => {
  const previous = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, body: 'local', fromMe: true }))
  const merged = mergeDirectMessages(previous, [{ id: 200, body: 'local', fromMe: true, readAt: 'read' }, { id: 201, body: 'new', fromMe: false }])
  expect(merged).toHaveLength(200)
  expect(merged[0].id).toBe(2)
  expect(merged.at(-1).id).toBe(201)
  expect(merged.find(message => message.id === 200).readAt).toBe('read')
  expect(previous[199].readAt).toBeUndefined()
  expect(isDirectMessage({ id: 1, body: 'message', fromMe: true })).toBe(true)
  expect(isDirectMessage({ id: 'wrong', body: 'message', fromMe: true })).toBe(false)
})

it('accepts PostgreSQL bigint string IDs without losing ordering or duplicating number IDs', () => {
  const message = id => ({ id, body: 'message', fromMe: true })
  expect(isDirectMessage(message('9223372036854775807'))).toBe(true)
  const merged = mergeDirectMessages([message(1), message('9007199254740993')], [message('1'), message('9007199254740992')])
  expect(merged.map(entry => entry.id)).toEqual(['1', '9007199254740992', '9007199254740993'])
})
