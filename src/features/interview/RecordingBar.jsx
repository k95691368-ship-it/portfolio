import React, { useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { normalizeRecording, normalizeSession, recordingActions } from './sessionModel.js'
import { useRecordingControlRecovery } from './useRecordingControlRecovery.js'

const ACTION_LABELS = {
  start: '녹화 시작',
  pause: '일시정지',
  resume: '녹화 재개',
  stop: '녹화 종료',
}

function recordingFromResponse(response, fallback) {
  const session = response?.session ? normalizeSession(response) : null
  if (session?.recording) return session.recording
  return normalizeRecording(response?.recording ?? response?.currentRecording ?? fallback)
}

export default function RecordingBar({
  roomId,
  session,
  meeting,
  meetingJoined = false,
  controlsLocked = false,
  onRecordingChanged,
}) {
  const [otherBusyAction, setBusyAction] = useState('')
  const [otherError, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const uploadTicketRef = useRef(null)
  const pendingUploadRef = useRef(null)
  const actionLockRef = useRef(false)
  const recording = normalizeRecording(session.recording)
  const control = useRecordingControlRecovery({ roomId, session, meeting, controlsLocked, onRecordingChanged })
  const busyAction = control.busyAction || otherBusyAction
  const error = control.error || otherError
  const actions = session.canControlRecording
    ? recordingActions(recording, session.recordingRequired)
    : []

  if (!session.recordingRequired) return null

  const completeUpload = async ({ recordingId, result, ticket }) => {
    if (!meeting?.recording?.upload) throw new Error('녹화 업로드를 준비하지 못했습니다.')
    setBusyAction('upload')
    setUploadProgress(0)
    pendingUploadRef.current = { recordingId, result, ticket }
    await meeting.recording.upload(result, ticket, setUploadProgress)
    const response = await api.post(
      `/rooms/${roomId}/interviews/${session.id}/recordings/${recordingId}/complete`,
      {
        sha256: result.sha256,
        sizeBytes: result.sizeBytes,
        durationSeconds: result.durationSeconds,
      }
    )
    await meeting.recording.clearBackup?.(recordingId)
    pendingUploadRef.current = null
    uploadTicketRef.current = null
    setUploadProgress(1)
    onRecordingChanged?.(recordingFromResponse(response, recording))
  }

  const updateRecording = async (action) => {
    if (action === 'pause' || action === 'resume') {
      if (!actionLockRef.current) await control.change(action)
      return
    }
    if (controlsLocked || !meeting?.recording || actionLockRef.current || !control.canMutate()) return
    actionLockRef.current = true
    setBusyAction(action)
    setError('')
    try {
      if (action === 'start') {
        const response = await api.post(
          `/rooms/${roomId}/interviews/${session.id}/recording/start`,
          {}
        )
        const next = recordingFromResponse(response, recording)
        if (!response.upload || response.idempotent) {
          onRecordingChanged?.(next)
          if (response.idempotent) {
            throw new Error('다른 화면에서 시작된 녹화가 있습니다.')
          }
          throw new Error('녹화 저장 경로를 받지 못했습니다.')
        }
        try {
          await meeting.recording.start(next.id)
        } catch (startError) {
          try {
            const cancelled = await api.put(
              `/rooms/${roomId}/interviews/${session.id}/recording/${next.id}/control`, { action: 'abort' }
            )
            onRecordingChanged?.(recordingFromResponse(cancelled, next))
          } catch {
            onRecordingChanged?.(next)
            throw new Error(`${startError.message} 서버의 녹화 상태 정리는 확인되지 않았습니다. 화면을 새로고침한 뒤 상태를 확인해주세요.`)
          }
          throw startError
        }
        uploadTicketRef.current = { recordingId: next.id, ticket: response.upload }
        onRecordingChanged?.(next)
        return
      }

      if (!recording.id) throw new Error('녹화 정보를 다시 불러와주세요.')
      if (action === 'stop') {
        const ticket = uploadTicketRef.current
        if (!ticket || ticket.recordingId !== recording.id) {
          throw new Error('이 화면에서 시작한 녹화만 종료하고 저장할 수 있습니다.')
        }
        const result = await meeting.recording.stop()
        const stopped = await api.put(
          `/rooms/${roomId}/interviews/${session.id}/recording/${recording.id}/control`,
          { action: 'stop' }
        )
        onRecordingChanged?.(recordingFromResponse(stopped, recording))
        await completeUpload({ recordingId: recording.id, result, ticket: ticket.ticket })
        return
      }

      const response = await api.put(
        `/rooms/${roomId}/interviews/${session.id}/recording/${recording.id}/control`,
        { action }
      )
      onRecordingChanged?.(recordingFromResponse(response, recording))
    } catch (caught) {
      setError(caught.message)
    } finally {
      actionLockRef.current = false
      setBusyAction('')
    }
  }

  const retryUpload = async () => {
    const pending = pendingUploadRef.current
    if (!pending || actionLockRef.current || !control.canMutate()) return
    actionLockRef.current = true
    setError('')
    try {
      await completeUpload(pending)
    } catch (caught) {
      setError(caught.message)
    } finally {
      actionLockRef.current = false
      setBusyAction('')
    }
  }

  const recoverUpload = async () => {
    if (!recording.id || !meeting?.recording?.recover || actionLockRef.current || !control.canMutate()) return
    actionLockRef.current = true
    setBusyAction('recover'); setError('')
    try {
      const result = await meeting.recording.recover(recording.id)
      if (!result) throw new Error('이 브라우저에 복구할 녹화 조각이 없습니다.')
      const response = await api.post(`/rooms/${roomId}/interviews/${session.id}/recordings/${recording.id}/upload-ticket`, {})
      await completeUpload({ recordingId: recording.id, result, ticket: response.upload })
    } catch (caught) { setError(caught.message) }
    finally { actionLockRef.current = false; setBusyAction('') }
  }

  const live = recording.status === 'recording' && !control.pausedLocally
  const active = ['starting', 'recording', 'paused', 'resuming', 'stopping'].includes(recording.status)
  const label = control.pausedLocally && control.recovery?.phase === 'unknown'
    ? '브라우저 녹화 일시정지 · 서버 상태 확인 필요'
    : control.pausedLocally && recording.status === 'recording'
      ? '브라우저 녹화 일시정지 · 서버는 녹화 중'
      : recording.label

  return (
    <div className={`interview-recording-bar${live ? ' is-live' : ''}`}>
      <div className="interview-recording-bar__state" role="status" aria-live="polite">
        <span className={`interview-recording-state-dot${active ? ' is-active' : ''}`} aria-hidden="true" />
        <span className="interview-recording-bar__label">
          <strong>{busyAction === 'upload' ? `업로드 중 ${Math.round(uploadProgress * 100)}%` : label}</strong>
          <small>녹화 동의 필수 면접 · 업로드 완료 전 이 브라우저에 복구용 임시 저장</small>
        </span>
      </div>

      {actions.length > 0 && (
        <div className="interview-recording-actions" aria-label="녹화 제어">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'stop' ? 'is-danger' : ''}
              disabled={Boolean(busyAction) || controlsLocked || !control.canMutate()
                || (['pause', 'resume'].includes(action) && !control.ownsCapture()) || (action === 'start' && !meetingJoined)}
              title={
                controlsLocked
                  ? '면접관 협의가 끝난 뒤 녹화를 제어할 수 있습니다.'
                  : action === 'start' && !meetingJoined
                    ? '화상 면접에 입장한 뒤 녹화를 시작할 수 있습니다.'
                    : undefined
              }
              onClick={() => void updateRecording(action)}
            >
              {busyAction === action ? '처리 중…' : ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}

      {control.recovery && (
        <div className="interview-recording-actions" aria-label="녹화 상태 복구">
          <button type="button" disabled={Boolean(busyAction)} onClick={() => void control.refresh()}>
            {busyAction === 'check' ? '녹화 상태 확인 중…' : '녹화 상태 다시 확인'}
          </button>
          {control.recovery.phase === 'resume-required' && <>
            <button type="button" disabled={Boolean(busyAction) || controlsLocked || !session.canControlRecording}
              onClick={() => void control.change('pause', { allowRecovery: true })}>일시정지 다시 요청</button>
            <button type="button" disabled={Boolean(busyAction) || controlsLocked || !session.canControlRecording}
              onClick={() => void control.change('resume', { allowRecovery: true })}>확인 후 녹화 재개</button>
          </>}
        </div>
      )}
      {pendingUploadRef.current && !busyAction && !control.recovery && (
        <button type="button" className="interview-upload-retry" onClick={() => void retryUpload()}>
          녹화 업로드 다시 시도
        </button>
      )}
      {session.canControlRecording && recording.id && !['available', 'expired', 'deleted'].includes(recording.status) && !busyAction && !control.recovery && !uploadTicketRef.current && (
        <button type="button" className="interview-upload-retry" onClick={() => void recoverUpload()}>이 브라우저의 중단된 녹화 복구</button>
      )}
      {actions.includes('start') && !meetingJoined && (
        <span className="interview-recording-bar__join-note">입장 후 녹화를 시작할 수 있습니다.</span>
      )}
      {actions.length > 0 && controlsLocked && (
        <span className="interview-recording-bar__join-note">면접관 협의 중에는 녹화 제어가 잠깁니다.</span>
      )}
      {error && <p className="interview-recording-bar__error" role="alert">{error}</p>}
    </div>
  )
}
