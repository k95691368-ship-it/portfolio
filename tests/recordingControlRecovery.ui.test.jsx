import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPut as controlRecording } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recording/[recordingId]/control.js'
import { onRequestGet as readSession } from '../server/api/rooms/[roomId]/interviews/[sessionId]/index.js'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', async original => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
  return { ...await original(),
    useState(initial) {
      const index = host.index++, cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
    },
    useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
    useEffect(effect, deps) {
      const index = host.index++, previous = host.cells[index]
      if (!previous || changed(previous.deps, deps)) {
        host.cells[index] = { deps, effect, cleanup: previous?.cleanup }
        host.effects.push(index)
      }
    },
  }
})
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }))
import { api } from '../src/api/client.js'
import RecordingBar from '../src/features/interview/RecordingBar.jsx'
import { useRecordingControlRecovery } from '../src/features/interview/useRecordingControlRecovery.js'

let props, tree, capture, db
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
const serverSession = status => ({ session: { ...props.session,
  permissions: { canControlRecording: true }, recording: recording(status) } })
function render() {
  host.index = 0; host.effects = []; host.dirty = false
  tree = RecordingBar(props)
  for (const index of host.effects) host.cells[index].cleanup?.()
  for (const index of host.effects) host.cells[index].cleanup = host.cells[index].effect()
  return tree
}
async function flush() { for (let index = 0; index < 40; index++) await Promise.resolve() }
async function settle() { await flush(); render() }
function unmount() { for (const cell of host.cells) cell?.cleanup?.() }
function paused() { capture.state = 'paused'; props.session.recording = recording('paused'); render() }
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false; db = null
  capture = { recordingId: 'recording-a', sessionId: 'session-a', state: 'recording' }
  props = { roomId: 'room-a', meetingJoined: true,
    session: { id: 'session-a', myRole: 'host', canControlRecording: true, recordingRequired: true, recording: recording('recording') },
    meeting: { recording: {
      captureState: vi.fn(() => capture), pause: vi.fn(() => { capture.state = 'paused' }),
      resume: vi.fn(() => { capture.state = 'recording' }), recover: vi.fn(), clearBackup: vi.fn(),
    } },
    onRecordingChanged: vi.fn(next => { props.session.recording = next }),
  }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls forbidden') }))
  api.get.mockImplementation(async () => serverSession('paused'))
  render()
})
afterEach(() => { unmount(); db?.close(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

it('pauses locally before acknowledgement and blocks duplicate captured handlers synchronously', async () => {
  const pending = deferred(); api.put.mockReturnValueOnce(pending.promise)
  const pause = button('일시정지').props.onClick
  pause(); pause(); render()
  expect(capture.state).toBe('paused')
  expect(api.put).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(button('녹화 종료').props.disabled).toBe(true)
  pending.resolve({ recording: recording('paused') }); await settle()
  expect(props.onRecordingChanged).toHaveBeenCalledWith(expect.objectContaining(recording('paused')))
})

it('resumes only after a matching recording acknowledgement, never before it', async () => {
  paused(); const pending = deferred(); api.put.mockReturnValueOnce(pending.promise)
  const resume = button('녹화 재개').props.onClick
  resume(); resume(); render()
  expect(api.put).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  pending.resolve({ recording: recording('recording') }); await settle()
  expect(props.meeting.recording.resume).toHaveBeenCalledOnce()
  expect(capture.state).toBe('recording')
})

it('pauses divergent native capture before a denied resume and never resumes from GET alone', async () => {
  props.session.recording = recording('paused'); render()
  expect(capture.state).toBe('recording')
  api.put.mockImplementationOnce(async () => {
    expect(capture.state).toBe('paused')
    throw new Error('Recording permission revoked')
  })
  api.get.mockResolvedValueOnce(serverSession('paused'))
  button('녹화 재개').props.onClick(); await settle()
  expect(props.meeting.recording.pause).toHaveBeenCalledOnce()
  expect(api.put).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledOnce()
  expect(capture.state).toBe('paused')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
})

function realHandlers(status) {
  db = sqliteApp(); const user = seedUser(db, 'host-a', 'company')
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room-a','host-a','Synthetic','active','CONTROLRECOVERY');
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room-a','host-a','company');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session-a','room-a','synthetic','Synthetic','live');
    INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id) VALUES ('session-a','host-a','host','member-a');
    INSERT INTO interview_recordings (id,session_id,status,storage_status,r2_key,created_by_user_id) VALUES ('recording-a','session-a','${status}','pending','synthetic.webm','host-a');`)
  const context = { env: { DB: db }, data: { user }, params: { roomId: 'room-a', sessionId: 'session-a', recordingId: 'recording-a' } }
  let lost = false
  api.put.mockImplementation(async (_path, body) => {
    const response = await controlRecording({ ...context, request: new Request('https://synthetic.invalid/control', { method: 'PUT', body: JSON.stringify(body) }) })
    expect(response.status).toBe(200)
    if (!lost) { lost = true; throw new Error('Committed response lost') }
    return response.json()
  })
  api.get.mockImplementation(async () => {
    const response = await readSession(context)
    expect(response.status).toBe(200)
    return response.json()
  })
  return context
}

it('preserves pause after the actual control API commits and loses its response', async () => {
  realHandlers('recording')
  button('일시정지').props.onClick(); await settle()
  expect(db.sql.prepare('SELECT status FROM interview_recordings').get().status).toBe('paused')
  expect(capture.state).toBe('paused')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(api.put).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledOnce()
  expect(button('녹화 재개').props.disabled).toBe(false)
})

it('shows actual server recording/local paused separately and requires an explicit acknowledged resume', async () => {
  paused(); realHandlers('paused')
  button('녹화 재개').props.onClick(); await settle()
  expect(db.sql.prepare('SELECT status FROM interview_recordings').get().status).toBe('recording')
  expect(capture.state).toBe('paused')
  expect(text(tree)).toContain('브라우저 녹화 일시정지 · 서버는 녹화 중')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(button('녹화 종료').props.disabled).toBe(true)
  expect(button('이 브라우저의 중단된 녹화 복구')).toBeUndefined()
  button('확인 후 녹화 재개').props.onClick(); await settle()
  expect(api.put).toHaveBeenCalledTimes(2)
  expect(props.meeting.recording.resume).toHaveBeenCalledOnce()
  expect(capture.state).toBe('recording')
})

it('keeps divergent capture paused when the actual control API denies a demoted host', async () => {
  props.session.recording = recording('paused'); render()
  const context = realHandlers('paused')
  db.sql.exec("UPDATE interview_session_members SET role = 'interviewer' WHERE session_id = 'session-a'")
  api.put.mockImplementation(async (_path, body) => {
    expect(capture.state).toBe('paused')
    const response = await controlRecording({ ...context, request: new Request('https://synthetic.invalid/control', { method: 'PUT', body: JSON.stringify(body) }) })
    expect(response.status).toBe(403)
    throw new Error('Recording permission revoked')
  })
  button('녹화 재개').props.onClick(); await settle()
  expect(db.sql.prepare('SELECT status FROM interview_recordings').get().status).toBe('paused')
  expect(capture.state).toBe('paused')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(button('녹화 재개').props.disabled).toBe(true)
  expect(button('녹화 상태 다시 확인')).toBeDefined()
})

it('keeps mutators locked after a failed read and retries GET without resending the write', async () => {
  api.put.mockRejectedValueOnce(new Error('Write response lost'))
  api.get.mockRejectedValueOnce(new Error('Read unavailable'))
  const staleStop = button('녹화 종료').props.onClick
  button('일시정지').props.onClick(); await settle()
  expect(button('녹화 종료').props.disabled).toBe(true)
  expect(button('이 브라우저의 중단된 녹화 복구')).toBeUndefined()
  staleStop(); await settle()
  expect(api.put).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
  button('녹화 상태 다시 확인').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.put).toHaveBeenCalledOnce()
  expect(capture.state).toBe('paused')
  expect(button('녹화 재개').props.disabled).toBe(false)
})

it('blocks a captured recovery write after a later GET makes the server state unknown', async () => {
  paused(); api.put.mockRejectedValueOnce(new Error('Write response lost'))
  api.get.mockResolvedValueOnce(serverSession('recording'))
  button('녹화 재개').props.onClick(); await settle()
  const staleRecoveryResume = button('확인 후 녹화 재개').props.onClick
  api.get.mockRejectedValueOnce(new Error('Read unavailable'))
  button('녹화 상태 다시 확인').props.onClick(); await settle()
  expect(button('확인 후 녹화 재개')).toBeUndefined()
  staleRecoveryResume(); await settle()
  expect(api.put).toHaveBeenCalledOnce()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(capture.state).toBe('paused')
  expect(button('녹화 상태 다시 확인')).toBeDefined()
})

it.each([null, {}, { recording: { id: 'different', status: 'recording' } }, { recording: recording('paused') }])(
  'never resumes from malformed control acknowledgement %j', async response => {
    paused(); api.put.mockResolvedValueOnce(response); api.get.mockResolvedValueOnce(serverSession('recording'))
    button('녹화 재개').props.onClick(); await settle()
    expect(props.meeting.recording.resume).not.toHaveBeenCalled()
    expect(button('확인 후 녹화 재개')).toBeDefined()
    expect(api.put).toHaveBeenCalledOnce()
  })

it.each(['session', 'recording', 'capability', 'missing capability', 'role', 'missing recording'])('rejects a recovery GET with changed %s', async change => {
  paused(); api.put.mockRejectedValueOnce(new Error('Write response lost'))
  const response = serverSession('recording')
  if (change === 'session') response.session.id = 'session-b'
  if (change === 'recording') response.session.recording.id = 'recording-b'
  if (change === 'capability') response.session.permissions.canControlRecording = false
  if (change === 'missing capability') delete response.session.permissions
  if (change === 'role') response.session.myRole = 'candidate'
  if (change === 'missing recording') delete response.session.recording
  api.get.mockResolvedValueOnce(response)
  button('녹화 재개').props.onClick(); await settle()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(button('녹화 상태 다시 확인')).toBeDefined()
  expect(button('확인 후 녹화 재개')).toBeUndefined()
  expect(props.meeting.recording.clearBackup).not.toHaveBeenCalled()
})

it.each(['room', 'session', 'recording', 'meeting', 'role', 'unmount'])('ignores late control acknowledgement after %s changes', async change => {
  paused(); const pending = deferred(); api.put.mockReturnValueOnce(pending.promise)
  const original = props.meeting
  button('녹화 재개').props.onClick(); await settle()
  if (change === 'room') props = { ...props, roomId: 'room-b' }
  if (change === 'session') props = { ...props, session: { ...props.session, id: 'session-b' } }
  if (change === 'recording') props = { ...props, session: { ...props.session, recording: { id: 'recording-b', status: 'paused' } } }
  if (change === 'meeting') props = { ...props, meeting: { ...props.meeting } }
  if (change === 'role') props = { ...props, session: { ...props.session, myRole: 'candidate' } }
  if (change === 'unmount') unmount()
  else render()
  pending.resolve({ recording: recording('recording') }); await flush()
  if (change !== 'unmount') render()
  expect(original.recording.resume).not.toHaveBeenCalled()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(api.get).not.toHaveBeenCalled()
})

it('does not use a stale GET from another recording to unlock its replacement', async () => {
  paused(); api.put.mockRejectedValueOnce(new Error('Lost acknowledgement'))
  const pending = deferred(); api.get.mockReturnValueOnce(pending.promise)
  button('녹화 재개').props.onClick(); await settle()
  props = { ...props, session: { ...props.session, recording: { id: 'recording-b', status: 'paused' } } }; render()
  pending.resolve(serverSession('recording')); await settle()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
})

it.each(['absent', 'wrong recording', 'wrong session', 'inactive'])('never controls an unowned %s capture', async kind => {
  paused()
  if (kind === 'absent') props.meeting.recording.captureState.mockReturnValue(null)
  if (kind === 'wrong recording') capture.recordingId = 'other-recording'
  if (kind === 'wrong session') capture.sessionId = 'other-session'
  if (kind === 'inactive') capture.state = 'inactive'
  render(); button('녹화 재개').props.onClick(); await settle()
  expect(api.put).not.toHaveBeenCalled()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(button('녹화 재개').props.disabled).toBe(true)
})

it('keeps an acknowledged resume paused when collaboration locks capture before the response', async () => {
  paused(); const pending = deferred(); api.put.mockReturnValueOnce(pending.promise)
  api.get.mockResolvedValueOnce(serverSession('recording'))
  button('녹화 재개').props.onClick(); await settle()
  props = { ...props, controlsLocked: true }; render()
  pending.resolve({ recording: recording('recording') }); await settle()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(button('확인 후 녹화 재개').props.disabled).toBe(true)
})

it('serializes two independent controls sharing the same native capture before React rerenders', async () => {
  unmount(); host.cells = []; host.index = 0; host.effects = []
  const options = { ...props, onRecordingChanged: vi.fn() }
  const first = useRecordingControlRecovery(options)
  const second = useRecordingControlRecovery(options)
  for (const index of host.effects) host.cells[index].cleanup = host.cells[index].effect()
  const pending = deferred(); api.put.mockReturnValueOnce(pending.promise)
  const pausing = first.change('pause')
  expect(second.canMutate()).toBe(false)
  expect(await second.change('resume')).toBeNull()
  expect(api.put).toHaveBeenCalledOnce()
  pending.resolve({ recording: recording('paused') }); await pausing
  expect(capture.state).toBe('paused')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
})

it('keeps a second control locked while the first control has an unknown acknowledgement', async () => {
  unmount(); host.cells = []; host.index = 0; host.effects = []
  const options = { ...props, onRecordingChanged: vi.fn() }
  const first = useRecordingControlRecovery(options)
  const second = useRecordingControlRecovery(options)
  for (const index of host.effects) host.cells[index].cleanup = host.cells[index].effect()
  api.put.mockRejectedValueOnce(new Error('Pause acknowledgement unavailable'))
  api.get.mockRejectedValueOnce(new Error('Read unavailable'))
  expect(await first.change('pause')).toBeNull()
  expect(second.canMutate()).toBe(false)
  expect(await second.change('pause')).toBeNull()
  expect(api.put).toHaveBeenCalledOnce()
  expect(capture.state).toBe('paused')
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  await first.refresh()
  expect(second.canMutate()).toBe(true)
  expect(api.put).toHaveBeenCalledOnce()
})

it('does not confirm a server pause when the owned native capture is still recording', async () => {
  props.meeting.recording.pause.mockImplementation(() => {})
  api.get.mockResolvedValueOnce(serverSession('paused'))
  button('일시정지').props.onClick(); await settle()
  expect(api.put).not.toHaveBeenCalled()
  expect(props.onRecordingChanged).not.toHaveBeenCalled()
  expect(props.meeting.recording.resume).not.toHaveBeenCalled()
  expect(button('녹화 상태 다시 확인')).toBeDefined()
})
