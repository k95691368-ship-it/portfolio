import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { normalizeRecording, normalizeSession } from './sessionModel.js'

// The recording bar and huddle are separate callers of the same browser
// capture. A same-tick action in either caller must see the other one's claim.
const captureChanges = new WeakMap()
function releaseCaptureClaim(scope) {
  const recording = scope.meeting?.recording
  if ((!scope.recovery || !scope.active) && !scope.busy
    && captureChanges.get(recording)?.scope === scope) captureChanges.delete(recording)
}

// A failed HTTP acknowledgement cannot undo a user's local pause. In
// particular, a read confirming server "recording" never resumes capture.
export function useRecordingControlRecovery({ roomId, session, meeting, controlsLocked = false, onRecordingChanged }) {
  const selected = normalizeRecording(session.recording)
  const scopeRef = useRef(null)
  const [snapshot, setSnapshot] = useState(null)
  const key = JSON.stringify([roomId, session.id, selected.id, session.myRole, session.canControlRecording])
  if (!scopeRef.current || scopeRef.current.key !== key || scopeRef.current.meeting !== meeting) {
    scopeRef.current = { key, meeting, active: true, busy: false, busyAction: '',
      recovery: null, error: '', readController: null }
  }
  const scope = scopeRef.current
  scope.canControl = session.myRole === 'host' && session.canControlRecording === true
  scope.locked = controlsLocked
  scope.onChanged = onRecordingChanged
  const current = () => scopeRef.current === scope && scope.active
  const allowed = () => current() && scope.canControl && !scope.locked && Boolean(meeting?.recording)
  const ownedCapture = () => {
    try {
      const capture = meeting?.recording?.captureState?.()
      return capture?.recordingId === selected.id && capture.sessionId === session.id
        && ['recording', 'paused'].includes(capture.state) ? capture : null
    } catch { return null }
  }
  const publish = changes => {
    if (!current()) return
    Object.assign(scope, changes)
    setSnapshot({ scope, busyAction: scope.busyAction, recovery: scope.recovery, error: scope.error })
  }
  useEffect(() => {
    scope.active = true
    return () => { scope.active = false; scope.readController?.abort(); releaseCaptureClaim(scope) }
  }, [scope])

  const read = async action => {
    if (!current()) return null
    publish({ busyAction: 'check' })
    const controller = new AbortController()
    scope.readController = controller
    try {
      const response = await api.get(`/rooms/${roomId}/interviews/${session.id}`, { signal: controller.signal })
      if (!current()) return null
      const nextSession = normalizeSession(response)
      const next = nextSession?.recording
      if (nextSession?.id !== session.id || next?.id !== selected.id
        || !['paused', 'recording'].includes(next?.status)) {
        throw new Error('같은 면접과 녹화의 상태를 확인하지 못했습니다. 녹화를 자동으로 재개하지 않습니다.')
      }
      if (!scope.canControl || nextSession.myRole !== 'host'
        || response?.session?.permissions?.canControlRecording !== true) {
        throw new Error('현재 녹화 제어 권한을 확인하지 못했습니다. 녹화를 자동으로 재개하지 않습니다.')
      }
      if (ownedCapture()?.state !== 'paused') throw new Error('이 화면의 녹화 일시정지를 확인하지 못했습니다. 녹화를 자동으로 재개하지 않습니다.')
      publish({ recovery: next.status === 'paused' ? null : { action, phase: 'resume-required' }, error: '' })
      scope.onChanged?.(next)
      return next
    } catch (caught) {
      publish({ recovery: { action, phase: 'unknown' }, error: caught.message || '녹화 상태를 확인하지 못했습니다.' })
      return null
    } finally {
      if (scope.readController === controller) scope.readController = null
    }
  }

  const change = async (action, { allowRecovery = false } = {}) => {
    if (!['pause', 'resume'].includes(action) || !allowed() || !selected.id || scope.busy
      || (captureChanges.has(meeting.recording) && captureChanges.get(meeting.recording).scope !== scope)
      || (scope.recovery && (!allowRecovery || scope.recovery.phase !== 'resume-required'))) return null
    if (!ownedCapture()) {
      publish({ error: '이 화면에서 진행 중인 같은 녹화가 없습니다. 녹화 상태와 브라우저 복구 자료를 확인해주세요.' })
      return null
    }
    const claim = { scope }
    captureChanges.set(meeting.recording, claim)
    scope.busy = true
    publish({ busyAction: action, error: '' })
    try {
      // A server pause may have arrived from another controller while this
      // browser still captures. Resume permission must not keep that capture
      // running until an acknowledged resume has been checked.
      if (action === 'pause' || ownedCapture()?.state === 'recording') meeting.recording.pause()
      if (ownedCapture()?.state !== 'paused') {
        throw new Error('브라우저 녹화의 일시정지를 확인하지 못했습니다. 녹화를 자동으로 재개하지 않습니다.')
      }
      const response = await api.put(`/rooms/${roomId}/interviews/${session.id}/recording/${selected.id}/control`, { action })
      if (!current()) return null
      const raw = response?.recording
      const expected = action === 'pause' ? 'paused' : 'recording'
      if (raw?.id !== selected.id || raw.status !== expected) {
        throw new Error('녹화 제어 결과를 확인하지 못했습니다. 브라우저 녹화는 일시정지 상태로 유지합니다.')
      }
      if (!allowed()) throw new Error('녹화 제어 권한이나 면접관 협의 상태가 변경되었습니다. 브라우저 녹화는 일시정지 상태로 유지합니다.')
      if (!ownedCapture()) throw new Error('이 화면의 녹화 상태가 변경되었습니다. 녹화를 자동으로 재개하지 않습니다.')
      if (action === 'pause' && ownedCapture().state !== 'paused') {
        throw new Error('이 화면의 녹화 일시정지가 변경되었습니다. 현재 상태를 다시 확인해주세요.')
      }
      const next = normalizeRecording(raw)
      if (action === 'resume') meeting.recording.resume()
      if (action === 'resume' && ownedCapture()?.state !== 'recording') {
        throw new Error('브라우저 녹화의 재개를 확인하지 못했습니다. 현재 상태를 다시 확인해주세요.')
      }
      publish({ recovery: null, error: '' })
      scope.onChanged?.(next)
      return next
    } catch (caught) {
      if (!current()) return null
      publish({ recovery: { action, phase: 'unknown' }, error: caught.message || '녹화 제어 결과를 확인하지 못했습니다.' })
      const checked = await read(action)
      return action === 'pause' && checked?.status === 'paused' ? checked : null
    } finally {
      scope.busy = false
      releaseCaptureClaim(scope)
      publish({ busyAction: '' })
    }
  }

  const refresh = async () => {
    if (!current() || scope.busy || !selected.id) return null
    scope.busy = true
    try { return await read(scope.recovery?.action || 'pause') }
    finally { scope.busy = false; releaseCaptureClaim(scope); publish({ busyAction: '' }) }
  }
  const visible = snapshot?.scope === scope ? snapshot : scope
  return { busyAction: visible.busyAction, error: visible.error, recovery: visible.recovery,
    get pausedLocally() { return ownedCapture()?.state === 'paused' },
    ownsCapture: () => Boolean(ownedCapture()),
    canMutate: () => allowed() && !scope.busy && !scope.recovery && !captureChanges.has(meeting.recording),
    change, refresh }
}
