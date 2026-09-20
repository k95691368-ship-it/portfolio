import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Small deterministic hook host: effects, dependency cleanup and state updates
// execute, while requests/timers stay under test control (no production API).
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', () => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]))
  return {
    useRef(value) { const i = host.index++; return host.cells[i] ||= { current: value } },
    useState(initial) {
      const i = host.index++
      const cell = host.cells[i] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, (value) => {
        const next = typeof value === 'function' ? value(cell.value) : value
        if (!Object.is(cell.value, next)) { cell.value = next; host.dirty = true }
      }]
    },
    useCallback(callback, deps) {
      const i = host.index++; const previous = host.cells[i]
      if (!previous || changed(previous.deps, deps)) host.cells[i] = { deps, callback }
      return host.cells[i].callback
    },
    useEffect(effect, deps) {
      const i = host.index++; const previous = host.cells[i]
      if (!previous || changed(previous.deps, deps)) {
        host.cells[i] = { deps, cleanup: previous?.cleanup }
        host.effects.push({ i, effect })
      }
    },
  }
})
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
import { api } from '../src/api/client.js'
import { useChatPolling } from '../src/hooks/useChatPolling.js'

let props, output
function Harness() {
  return useChatPolling(props.room, 100, props.initial, props.options)
}
function render() {
  for (let count = 0; count < 20; count++) {
    host.index = 0; host.dirty = false; host.effects = []
    output = Harness()
    const effects = host.effects
    for (const { i } of effects) host.cells[i].cleanup?.()
    for (const { i, effect } of effects) host.cells[i].cleanup = effect()
    if (!host.dirty) return output
  }
  throw new Error('Hook did not settle')
}
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const incoming = () => props.options.onIncoming
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  host.cells = []; host.index = 0
  props = { room: 'a', initial: [], options: { onIncoming: vi.fn() } }
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  for (const cell of host.cells) cell?.cleanup?.()
  vi.useRealTimers(); vi.unstubAllGlobals()
})

it.each(['room', 'session'])('drops a delayed poll after changing the %s, including cursor and alerts', async (change) => {
  const old = defer(); api.get.mockReturnValueOnce(old.promise)
  render(); await vi.advanceTimersByTimeAsync(100)
  if (change === 'room') props.room = 'b'
  else props.options = { ...props.options, interviewSessionId: 'new-session' }
  props.initial = [{ id: 2, body: 'current' }]
  render()
  old.resolve({ messages: [{ id: 99, body: 'previous room' }] })
  await vi.advanceTimersByTimeAsync(0); render()
  expect(output.messages).toEqual(props.initial)
  expect(incoming()).not.toHaveBeenCalled()
  api.get.mockResolvedValue({ messages: [] })
  await vi.advanceTimersByTimeAsync(100)
  expect(api.get.mock.lastCall[0]).toContain('after=2')
})

it('does not let an old pending request block the newly selected room', async () => {
  api.get.mockReturnValueOnce(defer().promise).mockResolvedValue({ messages: [] })
  render(); await vi.advanceTimersByTimeAsync(100)
  props.room = 'b'; props.initial = []; render()
  await vi.advanceTimersByTimeAsync(100)
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.get.mock.lastCall[0]).toContain('/rooms/b/')
})

it('does not insert an old send response into the new room', async () => {
  const sent = defer(); api.post.mockReturnValueOnce(sent.promise)
  render(); const sending = output.sendMessage('old message')
  const rejected = expect(sending).rejects.toMatchObject({ code: 'STALE_CHAT_RESPONSE' })
  props.room = 'b'; props.initial = []; render()
  sent.resolve({ id: 90, body: 'old message' }); await rejected
  render(); expect(output.messages).toEqual([])
})

it('does not notify after unmount', async () => {
  const old = defer(); api.get.mockReturnValueOnce(old.promise)
  render(); await vi.advanceTimersByTimeAsync(100)
  for (const cell of host.cells) { cell?.cleanup?.(); if (cell) cell.cleanup = undefined }
  old.resolve({ messages: [{ id: 99 }] }); await vi.advanceTimersByTimeAsync(0)
  expect(incoming()).not.toHaveBeenCalled()
})

it('backs off repeated network failures instead of polling at full speed', async () => {
  api.get.mockRejectedValue(new Error('offline'))
  render(); await vi.advanceTimersByTimeAsync(1000); render()
  expect(api.get.mock.calls.length).toBeLessThan(10)
  expect(output.error).toBe('offline')
})

it('keeps an acknowledged send once when a string-ID poll fills earlier peer messages without skipping them', async () => {
  props.initial = [{ id: 8, body: 'seed' }]
  render()
  api.post.mockResolvedValueOnce({ id: 10, body: 'mine', senderId: 'me' })
  await output.sendMessage('mine'); render()
  api.get.mockResolvedValueOnce({ messages: [{ id: '9', body: 'peer' }, { id: '10', body: 'mine' }] })
  await vi.advanceTimersByTimeAsync(100); render()
  expect(api.get.mock.calls[0][0]).toContain('after=8')
  expect(output.messages.map(message => String(message.id))).toEqual(['8', '9', '10'])
  api.get.mockResolvedValueOnce({ messages: [] })
  await vi.advanceTimersByTimeAsync(100)
  expect(api.get.mock.lastCall[0]).toContain('after=10')
})

it('seeds a sorted, unique snapshot and advances a large decimal cursor to the maximum received ID only', async () => {
  props.initial = [{ id: '9007199254740993', body: 'later' }, { id: '9007199254740992', body: 'earlier' }, { id: '9007199254740993', body: 'duplicate' }]
  render()
  expect(output.messages.map(message => message.id)).toEqual(['9007199254740992', '9007199254740993'])
  api.get.mockResolvedValueOnce({ messages: [{ id: '9007199254740995', body: 'newest' }, { id: '9007199254740994', body: 'middle' }] })
  await vi.advanceTimersByTimeAsync(100); render()
  expect(api.get.mock.calls[0][0]).toContain('after=9007199254740993')
  api.get.mockResolvedValueOnce({ messages: [] })
  await vi.advanceTimersByTimeAsync(100)
  expect(api.get.mock.lastCall[0]).toContain('after=9007199254740995')
})

it.each(['not-an-array', [{ id: 'invalid', body: 'bad ID' }], [{ id: 2, body: {} }], [{ id: 2, body: 'text', senderName: {} }]])('preserves acknowledged history and the cursor after malformed poll data %j', async messages => {
  props.initial = [{ id: 1, body: 'safe' }]
  render()
  api.get.mockResolvedValueOnce({ messages })
  await vi.advanceTimersByTimeAsync(100); render()
  expect(output.messages).toEqual(props.initial)
  expect(output.error).toContain('메시지 응답')
  expect(output.lastSyncedAt).toBeNull()
  expect(incoming()).not.toHaveBeenCalled()
  api.get.mockResolvedValueOnce({ messages: [{ id: 2, body: 'recovered' }] })
  await vi.advanceTimersByTimeAsync(100); render()
  expect(api.get.mock.lastCall[0]).toContain('after=1')
  expect(output.messages.map(message => message.id)).toEqual([1, 2])
  expect(output.error).toBe('')
})

it('does not move the receive cursor backwards when an older duplicate batch is returned', async () => {
  props.initial = [{ id: '10', body: 'last received' }]
  render()
  api.get.mockResolvedValueOnce({ messages: [{ id: '9', body: 'old duplicate' }] })
  await vi.advanceTimersByTimeAsync(100); render()
  api.get.mockResolvedValueOnce({ messages: [] })
  await vi.advanceTimersByTimeAsync(100)
  expect(api.get.mock.lastCall[0]).toContain('after=10')
})

it('recovers an invalid initial snapshot from cursor zero instead of trusting its IDs or rendering its body', async () => {
  props.initial = [{ id: '20', body: {} }]
  render()
  expect(output.messages).toEqual([])
  expect(output.error).toContain('메시지 응답')
  api.get.mockResolvedValueOnce({ messages: [{ id: '19', body: 'recovered' }] })
  await vi.advanceTimersByTimeAsync(100); render()
  expect(api.get.mock.lastCall[0]).toContain('after=0')
  expect(output.messages.map(message => message.id)).toEqual(['19'])
})
