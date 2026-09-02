import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import {
  activeParticipantsReturnedToParent,
  candidateCustomParticipantIds,
  findHuddleMeeting,
  HUDDLE_TITLE,
  HUDDLE_WORKFLOW_STORAGE_VERSION,
  huddleWorkflowStorageKey,
  huddleTransitionConfirmed,
  meetingEntry,
  normalizeHuddleWorkflow,
  participantMovePlan,
  placementConfirmed,
  recordingMediaState,
  waitForConfirmedState,
} from './collaborationModel.js'
import { normalizeRecording, normalizeSession } from './sessionModel.js'

const CONFIRM_TIMEOUT_MS = 15000

function currentMeetingId(meeting) {
  return meeting?.meta?.meetingId ?? null
}

function recordingFromResponse(response) {
  const normalizedSession = normalizeSession(response)
  if (response?.session && normalizedSession?.recording) return normalizedSession.recording
  return normalizeRecording(response?.recording ?? response?.currentRecording)
}

function loadStoredWorkflow(sessionId) {
  try {
    return normalizeHuddleWorkflow(
      JSON.parse(window.sessionStorage.getItem(huddleWorkflowStorageKey(sessionId)))
    )
  } catch {
    return null
  }
}

function storeWorkflow(sessionId, workflow) {
  try {
    window.sessionStorage.setItem(
      huddleWorkflowStorageKey(sessionId),
      JSON.stringify({ version: HUDDLE_WORKFLOW_STORAGE_VERSION, ...workflow })
    )
  } catch {
    // Safari private mode or a full storage quota must not break the call.
  }
}

function clearStoredWorkflow(sessionId) {
  try {
    window.sessionStorage.removeItem(huddleWorkflowStorageKey(sessionId))
  } catch {
    // Storage is only a crash-recovery aid; provider state remains authoritative.
  }
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
  const meetingRef = useRef(meeting)
  const workflowRef = useRef(null)
  const recoveryKeyRef = useRef('')

  useEffect(() => {
    meetingRef.current = meeting
    const huddleId = workflowRef.current?.huddleId
    const activeMeetingId = currentMeetingId(meeting)
    if (huddleId && activeMeetingId === huddleId) setPhase('huddle')
    if (workflowRef.current?.parentId === activeMeetingId && phase === 'huddle') {
      // A provider-side switch can move this tab before the rest of the panel.
      // Keep recording controls locked until returnToInterview verifies everyone.
      setPhase('attention')
    }
  }, [meeting, phase])

  useEffect(() => {
    if (
      session.myRole !== 'host' ||
      !meetingJoined ||
      !meeting?.self?.roomJoined ||
      !meeting.connectedMeetings?.getConnectedMeetings ||
      workflowRef.current
    ) {
      return undefined
    }

    const recoveryKey = `${session.id}:${currentMeetingId(meeting) ?? 'unknown'}`
    if (recoveryKeyRef.current === recoveryKey) return undefined
    recoveryKeyRef.current = recoveryKey
    let current = true

    void meeting.connectedMeetings
      .getConnectedMeetings()
      .then((snapshot) => {
        if (!current || workflowRef.current) return
        const parentId = snapshot?.parentMeeting?.id
        const huddle = findHuddleMeeting(snapshot)
        const activeMeetingId = currentMeetingId(meetingRef.current)
        const stored = loadStoredWorkflow(session.id)
        let recovered = null

        if (stored && parentId === stored.parentId) {
          const storedHuddleExists = Boolean(meetingEntry(snapshot, stored.huddleId))
          if (storedHuddleExists || activeMeetingId === parentId) recovered = stored
        }

        // A different tab or a refresh can lose sessionStorage. Reconstruct the
        // route from provider state, but never guess that a paused recording
        // should resume without the saved recording id and workflow flag.
        if (!recovered && parentId && huddle?.id && activeMeetingId === huddle.id) {
          const huddleStaff = participantMovePlan(
            session.members,
            huddle.participants ?? []
          )
          const connectedCandidates = candidateCustomParticipantIds(session.members).filter(
            (customId) =>
              (snapshot.parentMeeting?.participants ?? []).some(
                (participant) => participant?.customParticipantId === customId
              )
          )
          recovered = {
            parentId,
            huddleId: huddle.id,
            staffCustomIds: huddleStaff.customParticipantIds,
            candidateCustomIds: connectedCandidates,
            shouldResume: false,
            recordingId: null,
          }
        }

        if (!recovered) {
          clearStoredWorkflow(session.id)
          return
        }
        workflowRef.current = recovered
        storeWorkflow(session.id, recovered)
        setPhase(activeMeetingId === recovered.huddleId ? 'huddle' : 'attention')
      })
      .catch(() => {
        // The normal action will surface a useful error if recovery is needed.
      })

    return () => {
      current = false
    }
  }, [meeting, meetingJoined, session.id, session.members, session.myRole])

  useEffect(() => {
    onWorkflowStateChange?.(phase)
  }, [onWorkflowStateChange, phase])

  if (session.myRole !== 'host') return null

  const loadSessionRecording = async () => {
    const response = await api.get(`/rooms/${roomId}/interviews/${session.id}`)
    const latest = normalizeSession(response)
    if (!latest?.id) throw new Error('recording_state_unavailable')
    onRecordingChanged?.(latest.recording)
    return latest.recording
  }

  const waitForRecording = async (recordingId, targetStatus) => {
    let confirmed = null
    const ready = await waitForConfirmedState(
      async () => {
        const current = await loadSessionRecording()
        if (current.id !== recordingId || current.status !== targetStatus) return false
        confirmed = current
        return true
      },
      { timeoutMs: CONFIRM_TIMEOUT_MS, intervalMs: 500 }
    )
    if (!ready || !confirmed) throw new Error('recording_state_unconfirmed')
    return confirmed
  }

  const controlRecording = async (recordingId, action, targetStatus) => {
    const response = await api.put(
      `/rooms/${roomId}/interviews/${session.id}/recording/${recordingId}/control`,
      { action }
    )
    const next = recordingFromResponse(response)
    onRecordingChanged?.(next)
    if (next.id === recordingId && next.status === targetStatus) return next
    return waitForRecording(recordingId, targetStatus)
  }

  const getSnapshot = async () => {
    const activeMeeting = meetingRef.current
    if (!activeMeeting?.connectedMeetings?.getConnectedMeetings) {
      throw new Error('connected_meetings_unavailable')
    }
    return activeMeeting.connectedMeetings.getConnectedMeetings()
  }

  const enterHuddle = async () => {
    if (phase !== 'parent') return
    if (!meetingRef.current || !meetingJoined || !meetingRef.current.self?.roomJoined) {
      setError('화상 면접에 입장한 뒤 협의를 시작할 수 있습니다.')
      return
    }

    setPhase('entering')
    setError('')
    let pausedByWorkflow = false
    let pauseRequested = false
    let moveAttempted = false
    let pausedRecordingId = null

    try {
      let snapshot = await getSnapshot()
      const parentId = snapshot.parentMeeting?.id
      if (!parentId || currentMeetingId(meetingRef.current) !== parentId) {
        throw new Error('not_in_parent')
      }

      const sourcePlan = participantMovePlan(
        session.members,
        snapshot.parentMeeting?.participants ?? []
      )
      if (sourcePlan.participantIds.length === 0) throw new Error('staff_not_found')
      if (
        meetingRef.current.self?.customParticipantId &&
        !sourcePlan.customParticipantIds.includes(
          meetingRef.current.self.customParticipantId
        )
      ) {
        throw new Error('host_not_found')
      }

      const candidateIds = candidateCustomParticipantIds(session.members)
      const connectedCandidateIds = candidateIds.filter((customId) =>
        (snapshot.parentMeeting?.participants ?? []).some(
          (participant) => participant?.customParticipantId === customId
        )
      )
      const existingHuddle = findHuddleMeeting(snapshot)
      if (
        existingHuddle &&
        !placementConfirmed(snapshot, existingHuddle.id, [], candidateIds)
      ) {
        throw new Error('candidate_in_huddle')
      }

      const latestRecording = await loadSessionRecording()
      const recordingState = recordingMediaState(latestRecording.status)
      if (recordingState === 'transitioning') throw new Error('recording_transitioning')
      if (recordingState === 'must-pause') {
        if (!latestRecording.id) throw new Error('recording_state_unavailable')
        pausedRecordingId = latestRecording.id
        pauseRequested = true
        await controlRecording(latestRecording.id, 'pause', 'paused')
        pausedByWorkflow = true
      }

      let huddle = existingHuddle
      if (!huddle) {
        const created = await meetingRef.current.connectedMeetings.createMeetings([
          { title: HUDDLE_TITLE },
        ])
        const createdId = created?.[0]?.id
        if (!createdId) throw new Error('huddle_create_failed')
        snapshot = await getSnapshot()
        huddle = meetingEntry(snapshot, createdId) ?? { id: createdId, title: HUDDLE_TITLE }
      }
      if (!huddle?.id) throw new Error('huddle_unavailable')

      snapshot = await getSnapshot()
      const latestSource = participantMovePlan(
        session.members,
        snapshot.parentMeeting?.participants ?? []
      )
      if (latestSource.participantIds.length === 0) throw new Error('staff_not_found')

      workflowRef.current = {
        parentId,
        huddleId: huddle.id,
        staffCustomIds: latestSource.customParticipantIds,
        candidateCustomIds: connectedCandidateIds,
        shouldResume: pausedByWorkflow,
        recordingId: pausedRecordingId,
      }
      storeWorkflow(session.id, workflowRef.current)
      moveAttempted = true
      const moved = await meetingRef.current.connectedMeetings.moveParticipants(
        parentId,
        huddle.id,
        latestSource.participantIds
      )
      if (moved?.success === false) throw new Error('move_failed')

      const confirmed = await waitForConfirmedState(
        async () => {
          const latestSnapshot = await getSnapshot()
          return huddleTransitionConfirmed(
            latestSnapshot,
            currentMeetingId(meetingRef.current),
            huddle.id,
            latestSource.customParticipantIds,
            candidateIds
          )
        },
        { timeoutMs: CONFIRM_TIMEOUT_MS, intervalMs: 400 }
      )
      if (!confirmed) throw new Error('move_unconfirmed')
      setPhase('huddle')
    } catch (caught) {
      if (pausedByWorkflow && pausedRecordingId && !moveAttempted) {
        try {
          await controlRecording(pausedRecordingId, 'resume', 'recording')
        } catch {
          setError('협의실로 이동하지 않았습니다. 녹화 재개 상태를 확인해주세요.')
          setPhase('parent')
          workflowRef.current = null
          return
        }
      }
      setError(
        caught?.message === 'recording_transitioning'
          ? '녹화 상태 변경이 끝난 뒤 다시 시도해주세요.'
          : pauseRequested && !pausedByWorkflow
            ? '녹화 일시정지를 확인하지 못해 참가자를 이동하지 않았습니다.'
            : moveAttempted
              ? pausedByWorkflow
                ? '참가자 이동 완료를 확인하지 못했습니다. 녹화는 일시정지 상태로 유지됩니다.'
                : '참가자 이동 완료를 확인하지 못했습니다.'
              : '면접관 협의실 상태를 확인하지 못했습니다. 참가자를 이동하지 않았습니다.'
      )
      setPhase(moveAttempted ? 'attention' : 'parent')
      if (!moveAttempted) {
        workflowRef.current = null
        clearStoredWorkflow(session.id)
      }
    }
  }

  const returnToInterview = async () => {
    const workflow = workflowRef.current
    if (
      !workflow ||
      !meetingRef.current ||
      !['huddle', 'attention'].includes(phase)
    ) return
    setPhase('returning')
    setError('')

    try {
      let snapshot = await getSnapshot()
      const huddle = meetingEntry(snapshot, workflow.huddleId)
      const returnPlan = participantMovePlan(session.members, huddle?.participants ?? [])
      if (returnPlan.participantIds.length > 0) {
        const moved = await meetingRef.current.connectedMeetings.moveParticipants(
          workflow.huddleId,
          workflow.parentId,
          returnPlan.participantIds
        )
        if (moved?.success === false) throw new Error('return_failed')
      }

      const requiredInParent = [
        ...workflow.staffCustomIds,
        ...workflow.candidateCustomIds,
      ]
      const confirmed = await waitForConfirmedState(
        async () => {
          snapshot = await getSnapshot()
          return activeParticipantsReturnedToParent(
            snapshot,
            currentMeetingId(meetingRef.current),
            workflow.parentId,
            requiredInParent
          )
        },
        { timeoutMs: CONFIRM_TIMEOUT_MS, intervalMs: 400 }
      )
      if (!confirmed) throw new Error('return_unconfirmed')

      if (workflow.shouldResume && workflow.recordingId) {
        await controlRecording(workflow.recordingId, 'resume', 'recording')
      }
      workflowRef.current = null
      clearStoredWorkflow(session.id)
      setPhase('parent')
    } catch {
      setError(
        '면접관 전원의 복귀를 확인하지 못했습니다. 녹화는 자동으로 재개하지 않았습니다.'
      )
      setPhase('attention')
    }
  }

  const busy = phase === 'entering' || phase === 'returning'
  const inHuddle = phase === 'huddle'
  const needsRecovery = phase === 'attention'

  return (
    <div className="interview-huddle-control">
      <button
        type="button"
        disabled={busy || (!inHuddle && !needsRecovery && !meetingJoined)}
        onClick={inHuddle || needsRecovery ? returnToInterview : enterHuddle}
      >
        {phase === 'entering'
          ? '협의실로 이동 중…'
          : phase === 'returning'
            ? '면접으로 복귀 중…'
            : inHuddle
              ? '면접으로 돌아가기'
              : needsRecovery
                ? '복귀 상태 확인'
              : '면접관 협의'}
      </button>
      {inHuddle && <span className="interview-huddle-status">면접관 협의실</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
