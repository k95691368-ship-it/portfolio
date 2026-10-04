import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the actual chat hook and recipient model; only hooks and transports are synthetic.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, updates: 0 }))
vi.mock('react', async original => {
  const memo = (factory, deps) => {
    const index = host.index++
    const previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      host.cells[index] = { deps, value: factory() }
    }
    return host.cells[index].value
  }
  return {
    ...await original(),
    useState(initial) {
      const index = host.index++
      const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, value => {
        cell.value = typeof value === 'function' ? value(cell.value) : value
        host.dirty = true
        host.updates++
      }]
    },
    useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
    useEffect(effect, deps) {
      const index = host.index++
      const previous = host.cells[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const cell = { deps, effect, cleanup: previous?.cleanup }
        host.cells[index] = cell
        host.effects.push(cell)
      }
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
  }
})
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api }))

import InterviewConversationPanel from '../src/features/interview/InterviewConversationPanel.jsx'

const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const textarea = tree => walk(tree).find(node => node.type === 'textarea')
const form = tree => walk(tree).find(node => node.type === 'form')
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && text(node) === label)
const labels = { public: '공개 대화', private: '면접관 대화' }
const first = 'First message A'
const next = 'Next unsent message B'
const other = 'Other channel draft'
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const ack = (body = first, id = 1) => ({
  id, body, senderId: 'host-user', senderName: 'Host fixture', createdAt: '2026-10-04T00:00:00Z',
})
function propsFor(pending) {
  const participants = [
    { id: 'host-provider', customParticipantId: 'host-custom', userId: 'host-user' },
    { id: 'peer-provider', customParticipantId: 'peer-custom', userId: 'peer-user' },
    { id: 'candidate-provider', customParticipantId: 'candidate-custom', userId: 'candidate-user' },
    { id: 'unregistered-provider', customParticipantId: 'unregistered-custom', userId: 'unregistered-user' },
  ]
  api.post.mockImplementation(() => pending.promise)
  return {
    open: true, onClose: vi.fn(), roomId: 'room-fixture',
    session: {
      id: 'session-fixture', myRole: 'host', viewerUserId: 'host-user', members: [
        { userId: 'host-user', customParticipantId: 'host-custom', role: 'host', displayName: 'Host fixture' },
        { userId: 'peer-user', customParticipantId: 'peer-custom', role: 'interviewer', displayName: 'Peer fixture' },
        { userId: 'candidate-user', customParticipantId: 'candidate-custom', role: 'candidate', displayName: 'Candidate fixture' },
      ],
    },
    meeting: {
      self: participants[0],
      participants: { joined: { toArray: () => participants, on: vi.fn(), removeListener: vi.fn() } },
      chat: { messages: [], on: vi.fn(), removeListener: vi.fn(), sendTextMessage: vi.fn(() => pending.promise) },
    },
  }
}
function render(props) {
  for (let count = 0; count < 12; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    const tree = InterviewConversationPanel(props)
    for (const cell of host.effects) {
      cell.cleanup?.()
      cell.cleanup = cell.effect()
    }
    if (!host.dirty) return tree
  }
  throw new Error('Interview conversation did not settle')
}
function choose(props, channel) {
  const tree = render(props)
  button(tree, labels[channel]).props.onClick()
  return render(props)
}
function edit(props, channel, value) {
  const tree = choose(props, channel)
  textarea(tree).props.onChange({ target: { value } })
  return render(props)
}
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} })
const sender = (props, channel) => channel === 'public' ? api.post : props.meeting.chat.sendTextMessage
function expectSent(props, channel, body = first) {
  if (channel === 'public') {
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/rooms/room-fixture/messages?interviewSessionId=session-fixture', {
      body, interviewSessionId: 'session-fixture',
    })
    expect(props.meeting.chat.sendTextMessage).not.toHaveBeenCalled()
  } else {
    expect(props.meeting.chat.sendTextMessage).toHaveBeenCalledExactlyOnceWith(body, ['peer-provider'])
    expect(api.post).not.toHaveBeenCalled()
  }
  expect(api.get).not.toHaveBeenCalled()
}
function cleanup() { for (const cell of host.cells) cell.cleanup?.() }
function replayEffects() {
  cleanup()
  for (const cell of host.cells) if (cell.effect) cell.cleanup = cell.effect()
}

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockReset()
  api.get.mockReset().mockRejectedValue(new Error('Unexpected polling transport'))
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false; host.updates = 0
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each(['public', 'private'])('%s interview message draft', channel => {
  it('clears unchanged draft A after success and keeps the existing transport/recipients', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, `  ${first}  `))
    pending.resolve(ack())
    await task
    expectSent(props, channel)
    const tree = render(props)
    expect(textarea(tree).props.value).toBe('')
    if (channel === 'public') {
      expect(walk(tree).find(node => node.type?.name === 'MessageLog').props.messages.map(message => message.body)).toEqual([first])
    }
  })

  it('retains draft A after a definite failure and shows the existing error', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    pending.reject(Object.assign(new Error('Synthetic rejection'), { status: 403 }))
    await task
    expectSent(props, channel)
    const tree = render(props)
    expect(textarea(tree).props.value).toBe(first)
    expect(walk(tree).filter(node => node.props?.role === 'alert').map(text)).toEqual([
      channel === 'public' ? 'Synthetic rejection' : '면접관 대화를 보내지 못했습니다. 연결 상태를 확인해주세요.',
    ])
  })

  it('preserves edited draft B when request A succeeds', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    const tree = render(props)
    expect(textarea(tree).props.disabled).not.toBe(true)
    edit(props, channel, next)
    pending.resolve(ack())
    await task
    expectSent(props, channel)
    expect(textarea(render(props)).props.value).toBe(next)
  })

  it('preserves an edit queued before rerender and completion', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const tree = edit(props, channel, first)
    const task = submit(tree)
    textarea(tree).props.onChange({ target: { value: next } })
    pending.resolve(ack())
    await task
    expect(textarea(render(props)).props.value).toBe(next)
    expectSent(props, channel)
  })

  it('preserves new editing intent even when the value returns to A', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    edit(props, channel, next)
    edit(props, channel, first)
    pending.resolve(ack())
    await task
    expect(textarea(render(props)).props.value).toBe(first)
    expectSent(props, channel)
  })

  it('keeps both drafts independent across a tab switch and late A success', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    edit(props, channel, next)
    const otherChannel = channel === 'public' ? 'private' : 'public'
    edit(props, otherChannel, other)
    pending.resolve(ack())
    await task
    expect(textarea(render(props)).props.value).toBe(other)
    expect(textarea(choose(props, channel)).props.value).toBe(next)
    expectSent(props, channel)
  })

  it('blocks same-tick duplicate submissions and allows an explicit new submission after completion', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const tree = edit(props, channel, first)
    const task = submit(tree)
    const duplicate = submit(tree)
    expectSent(props, channel)
    edit(props, channel, next)
    pending.resolve(ack())
    await Promise.all([task, duplicate])
    expect(textarea(render(props)).props.value).toBe(next)
    sender(props, channel).mockResolvedValueOnce(ack(next, 2))
    await submit(render(props))
    expect(sender(props, channel)).toHaveBeenCalledTimes(2)
    expect(textarea(render(props)).props.value).toBe('')
  })

  it('allows a deliberate retry after a definite failure', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    pending.reject(Object.assign(new Error('Synthetic rejection'), { status: 403 }))
    await task
    sender(props, channel).mockResolvedValueOnce(ack())
    await submit(render(props))
    expect(sender(props, channel)).toHaveBeenCalledTimes(2)
    expect(textarea(render(props)).props.value).toBe('')
  })

  it.each(['success', 'failure'])('ignores a late %s after unmount without updating disposed state', async outcome => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    edit(props, channel, next)
    cleanup()
    const updates = host.updates
    if (outcome === 'success') pending.resolve(ack())
    else pending.reject(new Error('Synthetic late failure'))
    await task
    expect(host.updates).toBe(updates)
    expectSent(props, channel)
  })

  it('keeps a fresh mount draft independent of an old request completion', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const task = submit(edit(props, channel, first))
    cleanup()
    host.cells = []
    const freshProps = propsFor(deferred())
    edit(freshProps, channel, next)
    const updates = host.updates
    pending.resolve(ack())
    await task
    expect(host.updates).toBe(updates)
    expect(textarea(render(freshProps)).props.value).toBe(next)
    expect(sender(freshProps, channel)).toHaveBeenCalledTimes(channel === 'public' ? 1 : 0)
  })

  it('does not start writes or update state through a disposed form handler', async () => {
    const pending = deferred()
    const props = propsFor(pending)
    const tree = edit(props, channel, first)
    cleanup()
    const updates = host.updates
    const task = submit(tree)
    pending.resolve(ack())
    await task
    expect(host.updates).toBe(updates)
    expect(api.post).not.toHaveBeenCalled()
    expect(props.meeting.chat.sendTextMessage).not.toHaveBeenCalled()
  })

  it('does not let a disposed attempt clear or unlock a newer pending attempt after effect replay', async () => {
    const firstPending = deferred()
    const nextPending = deferred()
    const props = propsFor(firstPending)
    sender(props, channel).mockReset()
      .mockImplementationOnce(() => firstPending.promise)
      .mockImplementationOnce(() => nextPending.promise)
    const firstTask = submit(edit(props, channel, first))
    replayEffects()
    const nextTree = edit(props, channel, next)
    const nextTask = submit(nextTree)
    const updates = host.updates
    firstPending.resolve(ack())
    await firstTask
    expect(host.updates).toBe(updates)
    expect(textarea(render(props)).props.value).toBe(next)
    await submit(render(props))
    expect(sender(props, channel)).toHaveBeenCalledTimes(2)
    nextPending.resolve(ack(next, 2))
    await nextTask
    expect(textarea(render(props)).props.value).toBe('')
  })
})

it('allows independent public/private pending sends and preserves both newer drafts', async () => {
  const publicPending = deferred()
  const privatePending = deferred()
  const props = propsFor(publicPending)
  props.meeting.chat.sendTextMessage.mockImplementation(() => privatePending.promise)
  const publicTask = submit(edit(props, 'public', first))
  edit(props, 'public', next)
  const privateTask = submit(edit(props, 'private', other))
  edit(props, 'private', 'New private draft')
  publicPending.resolve(ack())
  await publicTask
  expect(textarea(render(props)).props.value).toBe('New private draft')
  expect(button(render(props), '보내는 중…').props.disabled).toBe(true)
  privatePending.resolve(ack(other, 2))
  await privateTask
  expect(textarea(render(props)).props.value).toBe('New private draft')
  expect(textarea(choose(props, 'public')).props.value).toBe(next)
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(props.meeting.chat.sendTextMessage).toHaveBeenCalledExactlyOnceWith(other, ['peer-provider'])
  expect(api.get).not.toHaveBeenCalled()
})
