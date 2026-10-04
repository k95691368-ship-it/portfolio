import { useEffect, useRef, useState } from 'react'
import { normalizeRecording } from './sessionModel.js'
import { useRecordingControlRecovery } from './useRecordingControlRecovery.js'

export default function InterviewerHuddleControl({
  roomId,
  session,
  meeting,
  meetingJoined,
  onRecordingChanged,
  onWorkflowStateChange,
}) {
  const recording = normalizeRecording(session.recording)
  const scopeRef = useRef(null)
  const [snapshot, setSnapshot] = useState(null)
  const key = JSON.stringify([roomId, session.id, recording.id, session.myRole, session.canControlRecording])
  if (!scopeRef.current || scopeRef.current.key !== key || scopeRef.current.meeting !== meeting) {
    scopeRef.current = { key, meeting, active: true, phase: 'parent', error: '', busy: false,
      pausedId: null, pauseConfirmed: false, huddleAttempted: false }
  }
  const scope = scopeRef.current
  const control = useRecordingControlRecovery({ roomId, session, meeting, onRecordingChanged })
  const current = () => scopeRef.current === scope && scope.active && session.myRole === 'host'
  const publish = changes => {
    if (!current()) return
    Object.assign(scope, changes)
    setSnapshot({ scope, phase: scope.phase, error: scope.error, busy: scope.busy })
  }
  const visible = snapshot?.scope === scope ? snapshot : scope
  const phase = control.recovery && visible.phase === 'parent' ? 'attention' : visible.phase
  const error = visible.error || control.error

  useEffect(() => {
    scope.active = true
    return () => { scope.active = false }
  }, [scope])

  useEffect(() => {
    onWorkflowStateChange?.(phase)
  }, [onWorkflowStateChange, phase])

  if (session.myRole !== 'host') return null

  const recordingUnknown = control.recovery?.phase === 'unknown'
  const enterHuddle = async ({ allowRecovery = false } = {}) => {
    if (!current() || scope.busy || recordingUnknown || (control.recovery && !allowRecovery)) return
    if (!meetingJoined || !meeting?.self?.roomJoined || !meeting?.huddle) {
      publish({ error: '화상 면접에 입장한 뒤 협의를 시작할 수 있습니다.' })
      return
    }
    scope.busy = true
    publish({ phase: 'entering', error: '' })
    try {
      if ((['recording', 'paused'].includes(recording.status) || scope.pausedId) && recording.id) {
        // A pre-existing pause remains paused when returning from the huddle.
        // Still pause and confirm locally before transmitting private speech.
        if (recording.status === 'recording' || scope.pausedId) scope.pausedId = recording.id
        const paused = await control.change('pause', { allowRecovery })
        if (!current()) return
        if (paused?.id !== recording.id || paused.status !== 'paused') {
          if (control.ownsCapture()) scope.pausedId = recording.id
          publish({ phase: 'attention', error: control.pausedLocally
            ? '이 브라우저의 녹화는 일시정지 상태로 유지합니다. 서버의 일시정지 상태를 확인한 뒤 협의를 시작해주세요.'
            : control.ownsCapture()
              ? '브라우저 녹화의 일시정지를 확인하지 못해 협의를 시작하지 않았습니다. 녹화 상태를 다시 확인해주세요.'
              : '이 화면에서 진행 중인 녹화를 확인하지 못해 협의를 시작하지 않았습니다. 녹화 상태를 다시 확인해주세요.' })
          return
        }
        scope.pauseConfirmed = true
      } else if (['starting', 'resuming', 'stopping', 'processing'].includes(recording.status)) {
        throw new Error('녹화 상태 변경이 끝난 뒤 다시 시도해주세요.')
      }
      if (!current()) return
      scope.huddleAttempted = true
      await meeting.huddle.enter()
      publish({ phase: 'huddle' })
    } catch (caught) {
      publish({ phase: scope.pausedId || scope.huddleAttempted ? 'attention' : 'parent',
        error: scope.pauseConfirmed
          ? control.pausedLocally
            ? `녹화 일시정지는 확인했습니다. 협의를 시작하지 못해 일시정지를 유지합니다. 면접으로 돌아간 뒤 녹화를 재개해주세요. ${caught.message || ''}`
            : `서버의 일시정지는 확인했지만 현재 브라우저의 일시정지 상태는 확인하지 못했습니다. 협의를 시작하지 못했습니다. 녹화 상태를 다시 확인해주세요. ${caught.message || ''}`
          : caught.message || '면접관 협의를 시작하지 못했습니다.' })
    } finally {
      scope.busy = false
      publish({ busy: false })
    }
  }

  const leaveHuddle = async () => {
    if (!current() || scope.busy || !meeting?.huddle
      || (scope.pausedId && recordingUnknown && !scope.huddleAttempted)) return
    scope.busy = true
    publish({ phase: 'returning', error: '' })
    try {
      if (scope.huddleAttempted) {
        await meeting.huddle.leave()
        if (!current()) return
        scope.huddleAttempted = false
      }
      if (scope.pausedId) {
        const resumed = await control.change('resume', { allowRecovery: true })
        if (!current()) return
        if (resumed?.id !== scope.pausedId || resumed.status !== 'recording') {
          publish({ phase: 'attention', error: control.pausedLocally
            ? '면접으로 복귀했지만 녹화 재개 결과를 확인하지 못했습니다. 이 브라우저의 녹화는 일시정지 상태로 유지합니다. 상태를 확인한 뒤 재개를 다시 선택해주세요.'
            : '면접으로 복귀했지만 녹화 재개 결과를 확인하지 못했습니다. 브라우저 녹화의 일시정지도 확인되지 않았습니다. 녹화 상태를 다시 확인해주세요.' })
          return
        }
        scope.pausedId = null
        scope.pauseConfirmed = false
      }
      publish({ phase: 'parent' })
    } catch (caught) {
      publish({ phase: 'attention', error: `${caught.message || '면접으로 돌아오지 못했습니다.'} ${control.pausedLocally
        ? '녹화는 일시정지 상태로 유지합니다.'
        : '브라우저 녹화의 일시정지 상태를 확인하지 못했습니다. 녹화 상태를 다시 확인해주세요.'}` })
    } finally {
      scope.busy = false
      publish({ busy: false })
    }
  }

  const refreshRecording = async () => {
    if (!current() || scope.busy) return
    scope.busy = true
    publish({ busy: true, error: '' })
    try {
      const latest = await control.refresh()
      if (!current()) return
      if (latest?.status === 'paused') {
        scope.pauseConfirmed = true
        publish({ error: control.pausedLocally
          ? '녹화 일시정지를 확인했습니다. 협의 시작 또는 면접 복귀를 선택해주세요.'
          : '서버의 일시정지는 확인했지만 브라우저 녹화의 일시정지 상태는 확인하지 못했습니다. 협의 시작 전에 녹화 상태를 다시 확인해주세요.' })
      } else if (latest?.status === 'recording') {
        publish({ error: control.pausedLocally
          ? '서버는 녹화 중이지만 이 브라우저는 일시정지 상태로 유지합니다. 협의하려면 일시정지를 확인하거나 면접으로 돌아가 녹화 재개를 선택해주세요.'
          : '서버는 녹화 중이며 브라우저 녹화의 일시정지는 확인되지 않았습니다. 협의 시작 전에 녹화 상태를 다시 확인해주세요.' })
      } else {
        publish({ error: control.pausedLocally
          ? '현재 녹화 상태를 확인하지 못했습니다. 이 브라우저의 녹화는 일시정지 상태로 유지합니다. 연결을 확인한 뒤 다시 확인해주세요.'
          : '현재 녹화 상태를 확인하지 못했습니다. 브라우저 녹화의 일시정지도 확인되지 않았습니다. 연결을 확인한 뒤 다시 확인해주세요.' })
      }
    } finally {
      scope.busy = false
      publish({ busy: false })
    }
  }

  const busy = visible.busy || Boolean(control.busyAction) || phase === 'entering' || phase === 'returning'
  const inHuddle = phase === 'huddle' || phase === 'attention'

  return (
    <div className="interview-huddle-control">
      <button
        type="button"
        disabled={busy || (!inHuddle && !meetingJoined)
          || Boolean(scope.pausedId && recordingUnknown && !scope.huddleAttempted)}
        onClick={() => void (inHuddle ? leaveHuddle() : enterHuddle())}
      >
        {phase === 'entering'
          ? '협의 시작 중…'
          : phase === 'returning'
            ? '면접으로 복귀 중…'
            : phase === 'attention' && scope.pausedId
              ? '면접으로 돌아가 녹화 재개'
              : inHuddle
              ? '면접으로 돌아가기'
              : '면접관 협의'}
      </button>
      {phase === 'attention' && <>
        <button type="button" disabled={busy} onClick={() => void refreshRecording()}>녹화 상태 다시 확인</button>
        {scope.pausedId && !scope.huddleAttempted && <button type="button" disabled={busy || !meetingJoined || recordingUnknown}
          onClick={() => void enterHuddle({ allowRecovery: true })}>일시정지 확인 후 협의 시작</button>}
      </>}
      {phase === 'huddle' && <span className="interview-huddle-status">지원자에게 음성이 전달되지 않습니다.</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
