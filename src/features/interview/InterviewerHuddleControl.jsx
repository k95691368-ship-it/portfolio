import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { normalizeRecording } from './sessionModel.js'

function recordingFromResponse(response, fallback) {
  return normalizeRecording(response?.recording ?? response?.currentRecording ?? fallback)
}

export default function InterviewerHuddleControl({
  roomId,
  session,
  meeting,
  meetingJoined,
  onRecordingChanged,
  onWorkflowStateChange,
}) {
  const [phase, setPhase] = useState('parent')
  const [error, setError] = useState('')
  const pausedRecordingRef = useRef(null)

  useEffect(() => {
    onWorkflowStateChange?.(phase)
  }, [onWorkflowStateChange, phase])

  if (session.myRole !== 'host') return null

  const controlRecording = async (recordingId, action) => {
    if (action === 'pause') meeting.recording.pause()
    if (action === 'resume') meeting.recording.resume()
    try {
      const response = await api.put(
        `/rooms/${roomId}/interviews/${session.id}/recording/${recordingId}/control`,
        { action }
      )
      const next = recordingFromResponse(response, session.recording)
      onRecordingChanged?.(next)
      return next
    } catch (caught) {
      if (action === 'pause') meeting.recording.resume()
      if (action === 'resume') meeting.recording.pause()
      throw caught
    }
  }

  const enterHuddle = async () => {
    if (!meetingJoined || !meeting?.self?.roomJoined || !meeting?.huddle) {
      setError('화상 면접에 입장한 뒤 협의를 시작할 수 있습니다.')
      return
    }
    setPhase('entering')
    setError('')
    try {
      const current = normalizeRecording(session.recording)
      if (current.status === 'recording' && current.id) {
        await controlRecording(current.id, 'pause')
        pausedRecordingRef.current = current.id
      } else if (['starting', 'resuming', 'stopping', 'processing'].includes(current.status)) {
        throw new Error('녹화 상태 변경이 끝난 뒤 다시 시도해주세요.')
      }
      await meeting.huddle.enter()
      setPhase('huddle')
    } catch (caught) {
      if (pausedRecordingRef.current) {
        try {
          await controlRecording(pausedRecordingRef.current, 'resume')
          pausedRecordingRef.current = null
        } catch {
          setError('협의를 시작하지 못했고 녹화 재개 상태도 확인하지 못했습니다.')
          setPhase('attention')
          return
        }
      }
      setError(caught.message || '면접관 협의를 시작하지 못했습니다.')
      setPhase('parent')
    }
  }

  const leaveHuddle = async () => {
    if (!meeting?.huddle) return
    setPhase('returning')
    setError('')
    try {
      await meeting.huddle.leave()
      if (pausedRecordingRef.current) {
        await controlRecording(pausedRecordingRef.current, 'resume')
        pausedRecordingRef.current = null
      }
      setPhase('parent')
    } catch (caught) {
      setError(caught.message || '면접으로 돌아오지 못했습니다. 녹화는 자동으로 재개하지 않았습니다.')
      setPhase('attention')
    }
  }

  const busy = phase === 'entering' || phase === 'returning'
  const inHuddle = phase === 'huddle' || phase === 'attention'

  return (
    <div className="interview-huddle-control">
      <button
        type="button"
        disabled={busy || (!inHuddle && !meetingJoined)}
        onClick={() => void (inHuddle ? leaveHuddle() : enterHuddle())}
      >
        {phase === 'entering'
          ? '협의 시작 중…'
          : phase === 'returning'
            ? '면접으로 복귀 중…'
            : inHuddle
              ? '면접으로 돌아가기'
              : '면접관 협의'}
      </button>
      {phase === 'huddle' && <span className="interview-huddle-status">지원자에게 음성이 전달되지 않습니다.</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
