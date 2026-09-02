import React, { useState } from 'react'
import { api } from '../../api/client.js'
import { normalizeRecording, normalizeSession, recordingActions } from './sessionModel.js'

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
  meetingJoined = false,
  controlsLocked = false,
  onRecordingChanged,
}) {
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const recording = normalizeRecording(session.recording)
  const actions = session.canControlRecording
    ? recordingActions(recording, session.recordingRequired)
    : []

  if (!session.recordingRequired) return null

  const updateRecording = async (action) => {
    if (controlsLocked) return
    setBusyAction(action)
    setError('')
    try {
      let response
      if (action === 'start') {
        response = await api.post(
          `/rooms/${roomId}/interviews/${session.id}/recording/start`,
          {}
        )
      } else {
        if (!recording.id) throw new Error('녹화 정보를 다시 불러와주세요.')
        if (typeof api.put !== 'function') throw new Error('녹화 제어를 준비하지 못했습니다.')
        response = await api.put(
          `/rooms/${roomId}/interviews/${session.id}/recording/${recording.id}/control`,
          { action }
        )
      }
      onRecordingChanged?.(recordingFromResponse(response, recording))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyAction('')
    }
  }

  const live = recording.status === 'recording'
  const active = ['starting', 'recording', 'paused', 'resuming', 'stopping'].includes(
    recording.status
  )

  return (
    <div className={`interview-recording-bar${live ? ' is-live' : ''}`}>
      <div className="interview-recording-bar__state" role="status" aria-live="polite">
        <span className={`interview-recording-state-dot${active ? ' is-active' : ''}`} aria-hidden="true" />
        <span className="interview-recording-bar__label">
          <strong>{recording.label}</strong>
          <small>녹화 동의 필수 면접</small>
        </span>
      </div>

      {actions.length > 0 && (
        <div className="interview-recording-actions" aria-label="녹화 제어">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'stop' ? 'is-danger' : ''}
              disabled={
                Boolean(busyAction) ||
                controlsLocked ||
                (action === 'start' && !meetingJoined)
              }
              title={
                controlsLocked
                  ? '면접관 협의가 끝난 뒤 녹화를 제어할 수 있습니다.'
                  : action === 'start' && !meetingJoined
                  ? '화상 면접에 입장한 뒤 녹화를 시작할 수 있습니다.'
                  : undefined
              }
              onClick={() => updateRecording(action)}
            >
              {busyAction === action ? '처리 중…' : ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}

      {actions.includes('start') && !meetingJoined && (
        <span className="interview-recording-bar__join-note">
          입장 후 녹화를 시작할 수 있습니다.
        </span>
      )}

      {actions.length > 0 && controlsLocked && (
        <span className="interview-recording-bar__join-note">
          면접관 협의 중에는 녹화 제어가 잠깁니다.
        </span>
      )}

      {error && <p className="interview-recording-bar__error" role="alert">{error}</p>}
    </div>
  )
}
