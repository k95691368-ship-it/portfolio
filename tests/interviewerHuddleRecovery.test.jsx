import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Run the real huddle and recording recovery hook with controlled lifetimes.
// Capture and huddle methods are simulations; no device or provider is opened.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', async original => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
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
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), put: vi.fn() } }))
import { api } from '../src/api/client.js'
import InterviewerHuddleControl from '../src/features/interview/InterviewerHuddleControl.jsx'

let props, tree, calls
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
const recording = status => ({ id: 'recording-a', status })
const serverSession = status => ({ session: { ...props.session, permissions: { canControlRecording: true }, recording: recording(status) } })
function render() {
  for (let attempt = 0; attempt < 20; attempt++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = InterviewerHuddleControl(props)
    for (const index of host.effects) host.cells[index].cleanup?.()
    for (const index of host.effects) host.cells[index].cleanup = host.cells[index].effect()
    if (!host.dirty) return tree
  }
  throw new Error('Unsettled huddle component')
}
async function flush() { for (let index = 0; index < 30; index++) await Promise.resolve() }
async function settle() { await flush(); render() }
function unmount() { for (const cell of host.cells) cell?.cleanup?.(); host.dirty = false }
async function enter() { button('면접관 협의').props.onClick(); await settle() }
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  calls = []
  let captureStatus = 'recording'
  props = {
    roomId: 'room-a', meetingJoined: true,
    session: { id: 'session-a', myRole: 'host', canControlRecording: true, recordingRequired: true, recording: recording('recording') },
    meeting: {
      self: { roomJoined: true },
      recording: {
        captureState: vi.fn(() => ({ recordingId: 'recording-a', sessionId: 'session-a', state: captureStatus })),
        pause: vi.fn(() => { captureStatus = 'paused'; calls.push('local.pause') }),
        resume: vi.fn(() => { captureStatus = 'recording'; calls.push('local.resume') }),
      },
      huddle: {
        enter: vi.fn(async () => { calls.push('huddle.enter') }),
        leave: vi.fn(async () => { calls.push('huddle.leave') }),
      },
    },
    onRecordingChanged: vi.fn(), onWorkflowStateChange: vi.fn(),
  }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden') }))
  render()
})
afterEach(() => { unmount(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

it('keeps capture paused and huddle controls locked when pause acknowledgement and its read both fail', async () => {
  api.put.mockRejectedValueOnce(new Error('Pause response lost'))
  api.get.mockRejectedValueOnce(new Error('Read unavailable'))
  await enter()
  expect(props.meeting.recording.pause).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledOnce()
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('attention')
  expect(button('녹화 상태 다시 확인').props.disabled).toBe(false)
  expect(button('면접으로 돌아가 녹화 재개').props.disabled).toBe(true)
  expect(button('일시정지 확인 후 협의 시작').props.disabled).toBe(true)
  button('면접으로 돌아가 녹화 재개').props.onClick()
  button('일시정지 확인 후 협의 시작').props.onClick(); await settle()
  expect(api.put).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledOnce()
  expect(props.meeting.huddle.leave).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).not.toHaveBeenCalled()
})

it('requires a matching paused state before entering after a malformed pause acknowledgement', async () => {
  api.put.mockResolvedValueOnce({})
  api.get.mockResolvedValueOnce(serverSession('paused'))
  await enter()
  expect(api.get).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).toHaveBeenCalledOnce()
  expect(props.onRecordingChanged).toHaveBeenLastCalledWith(expect.objectContaining(recording('paused')))
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('huddle')
})

it('preserves a confirmed pause when entering the huddle fails, then resumes only on explicit return acknowledgement', async () => {
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  props.meeting.huddle.enter.mockRejectedValueOnce(new Error('Huddle broadcast failed'))
  await enter()
  expect(api.put).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(text(tree)).toContain('녹화 일시정지는 확인했습니다')
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('attention')
  const resume = deferred()
  api.put.mockImplementationOnce(() => { calls.push('server.resume'); return resume.promise })
  button('면접으로 돌아가 녹화 재개').props.onClick(); await settle()
  expect(props.meeting.huddle.leave).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  resume.resolve({ recording: recording('recording') }); await settle()
  expect(calls.slice(-3)).toEqual(['huddle.leave', 'server.resume', 'local.resume'])
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('parent')
})

it('never treats a GET recording state as permission to resume after a lost return acknowledgement', async () => {
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  await enter()
  api.put.mockRejectedValueOnce(new Error('Resume response lost'))
  api.get.mockResolvedValueOnce(serverSession('recording'))
  button('면접으로 돌아가기').props.onClick(); await settle()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('attention')
  api.put.mockResolvedValueOnce({ recording: recording('recording') })
  button('면접으로 돌아가 녹화 재개').props.onClick(); await settle()
  expect(props.meeting.recording.resume).toHaveBeenCalledOnce()
  expect(api.put.mock.calls.map(([, body]) => body.action)).toEqual(['pause', 'resume', 'resume'])
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('parent')
})

it('offers a read-only retry while pause is uncertain and keeps capture paused when the server reports recording', async () => {
  api.put.mockRejectedValueOnce(new Error('Pause response lost'))
  api.get.mockRejectedValueOnce(new Error('Read unavailable'))
  await enter()
  api.get.mockResolvedValueOnce(serverSession('recording'))
  button('녹화 상태 다시 확인').props.onClick(); await settle()
  expect(api.put).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).not.toHaveBeenCalled()
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('attention')
  expect(button('면접으로 돌아가 녹화 재개').props.disabled).toBe(false)
  expect(button('일시정지 확인 후 협의 시작').props.disabled).toBe(false)
})

it('unlocks explicit resume only after a GET confirms the unknown recording state', async () => {
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  await enter()
  api.put.mockRejectedValueOnce(new Error('Resume response lost'))
  api.get.mockRejectedValueOnce(new Error('Read unavailable'))
  button('면접으로 돌아가기').props.onClick(); await settle()
  expect(props.meeting.huddle.leave).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(button('면접으로 돌아가 녹화 재개').props.disabled).toBe(true)
  expect(button('일시정지 확인 후 협의 시작').props.disabled).toBe(true)
  button('면접으로 돌아가 녹화 재개').props.onClick(); await settle()
  expect(api.put).toHaveBeenCalledTimes(2)
  api.get.mockResolvedValueOnce(serverSession('paused'))
  button('녹화 상태 다시 확인').props.onClick(); await settle()
  expect(button('면접으로 돌아가 녹화 재개').props.disabled).toBe(false)
  api.put.mockResolvedValueOnce({ recording: recording('recording') })
  button('면접으로 돌아가 녹화 재개').props.onClick(); await settle()
  expect(props.meeting.recording.resume).toHaveBeenCalledOnce()
  expect(api.put.mock.calls.map(([, body]) => body.action)).toEqual(['pause', 'resume', 'resume'])
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('parent')
})

it('confirms an existing pause before private speech and keeps it paused when returning', async () => {
  props = { ...props, session: { ...props.session, recording: recording('paused') } }; render()
  props.meeting.recording.pause(); props.meeting.recording.pause.mockClear()
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  await enter()
  expect(props.meeting.recording.pause).toHaveBeenCalledOnce()
  expect(api.put).toHaveBeenCalledWith(expect.stringContaining('/recording/recording-a/control'), { action: 'pause' })
  expect(props.meeting.huddle.enter).toHaveBeenCalledOnce()
  button('면접으로 돌아가기').props.onClick(); await settle()
  expect(props.meeting.huddle.leave).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(api.put).toHaveBeenCalledOnce()
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('parent')
})

it.each(['different-recording', 'not-host', 'missing-permission'])('does not enter using a %s read after a lost pause acknowledgement', async invalid => {
  api.put.mockRejectedValueOnce(new Error('Pause response lost'))
  const response = serverSession('paused')
  if (invalid === 'different-recording') response.session.recording.id = 'recording-b'
  if (invalid === 'not-host') response.session.myRole = 'candidate'
  if (invalid === 'missing-permission') delete response.session.permissions
  api.get.mockResolvedValueOnce(response)
  await enter()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).not.toHaveBeenCalled()
  expect(props.onWorkflowStateChange).toHaveBeenLastCalledWith('attention')
})

it('does not pause or enter when this browser owns no capture', async () => {
  props.meeting.recording.captureState.mockReturnValue(null)
  await enter()
  expect(api.put).not.toHaveBeenCalled()
  expect(props.meeting.recording.pause).not.toHaveBeenCalled()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).not.toHaveBeenCalled()
})

it('never claims a maintained pause or isolated voice when native pause silently has no effect', async () => {
  props.meeting.recording.pause.mockImplementation(() => calls.push('local.pause-noop'))
  api.get.mockResolvedValue(serverSession('paused'))
  await enter()
  expect(props.meeting.recording.captureState().state).toBe('recording')
  expect(api.put).not.toHaveBeenCalled()
  expect(props.meeting.huddle.enter).not.toHaveBeenCalled()
  expect(text(tree)).toContain('브라우저 녹화의 일시정지를 확인하지 못해 협의를 시작하지 않았습니다')
  expect(text(tree)).not.toContain('일시정지 상태로 유지')
  expect(text(tree)).not.toContain('지원자에게 음성이 전달되지 않습니다')
  button('녹화 상태 다시 확인').props.onClick(); await settle()
  expect(text(tree)).not.toContain('일시정지 상태로 유지')
  expect(text(tree)).not.toContain('지원자에게 음성이 전달되지 않습니다')
  expect(button('면접으로 돌아가 녹화 재개').props.disabled).toBe(true)
  expect(button('일시정지 확인 후 협의 시작').props.disabled).toBe(true)
  button('면접으로 돌아가 녹화 재개').props.onClick(); await settle()
  expect(props.meeting.recording.captureState().state).toBe('recording')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  expect(text(tree)).not.toContain('일시정지 상태로 유지')
  expect(text(tree)).not.toContain('지원자에게 음성이 전달되지 않습니다')
})

it('does not send resume after a late huddle leave when the meeting changes', async () => {
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  await enter()
  const pending = deferred()
  props.meeting.huddle.leave.mockReturnValueOnce(pending.promise)
  button('면접으로 돌아가기').props.onClick(); await settle()
  const originalMeeting = props.meeting
  props = { ...props, meeting: { ...props.meeting } }; render()
  props.onRecordingChanged.mockClear(); props.onWorkflowStateChange.mockClear()
  pending.resolve(); await settle()
  expect(api.put).toHaveBeenCalledOnce()
  expect(originalMeeting.recording.resume).not.toHaveBeenCalled()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(props.onWorkflowStateChange).not.toHaveBeenCalledWith('parent')
})

it('ignores a late huddle entry when its session changes', async () => {
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  const pending = deferred()
  props.meeting.huddle.enter.mockReturnValueOnce(pending.promise)
  button('면접관 협의').props.onClick(); await settle()
  expect(props.meeting.huddle.enter).toHaveBeenCalledOnce()
  props = { ...props, session: { ...props.session, id: 'session-b' } }; render()
  props.onWorkflowStateChange.mockClear()
  pending.resolve(); await settle()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.onWorkflowStateChange).not.toHaveBeenCalledWith('huddle')
  expect(button('면접관 협의')).toBeDefined()
})

it.each(['session', 'recording', 'meeting', 'role', 'unmount'])('ignores a late resume acknowledgement after %s changes', async scope => {
  api.put.mockResolvedValueOnce({ recording: recording('paused') })
  await enter()
  const pending = deferred()
  api.put.mockReturnValueOnce(pending.promise)
  const originalMeeting = props.meeting
  button('면접으로 돌아가기').props.onClick(); await settle()
  if (scope === 'session') props = { ...props, session: { ...props.session, id: 'session-b' } }
  if (scope === 'recording') props = { ...props, session: { ...props.session, recording: { id: 'recording-b', status: 'recording' } } }
  if (scope === 'meeting') props = { ...props, meeting: { ...props.meeting } }
  if (scope === 'role') props = { ...props, session: { ...props.session, myRole: 'candidate', canControlRecording: false } }
  if (scope === 'unmount') unmount()
  else render()
  props.onRecordingChanged.mockClear(); props.onWorkflowStateChange.mockClear()
  pending.resolve({ recording: recording('recording') }); await flush()
  if (scope !== 'unmount') render()
  expect(originalMeeting.recording.resume).not.toHaveBeenCalled()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(props.onWorkflowStateChange).not.toHaveBeenCalledWith('parent')
})
