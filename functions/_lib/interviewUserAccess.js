import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  controlRecording,
  deleteMeeting,
  deleteParticipant,
  isRealtimeKitAlreadyEnded,
  kickAllParticipants,
  kickParticipants,
} from './realtimekit.js'

export class InterviewUserAccessError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'InterviewUserAccessError'
    this.status = status
  }
}

function providerErrorStatus(error) {
  return error instanceof RealtimeKitConfigError ? 503 : 502
}

function alreadyAbsent(error) {
  return error instanceof RealtimeKitApiError && error.status === 404
}

async function revokeMembership(env, member) {
  const kick = kickParticipants(env, {
    meetingId: member.provider_meeting_id,
    customParticipantIds: [member.custom_participant_id],
  })
  const remove = member.provider_participant_id
    ? deleteParticipant(env, {
        meetingId: member.provider_meeting_id,
        participantId: member.provider_participant_id,
      })
    : Promise.reject(new Error('provider_participant_id_missing'))
  const [kickResult, deleteResult] = await Promise.allSettled([kick, remove])
  const kicked = kickResult.status === 'fulfilled' || alreadyAbsent(kickResult.reason)
  const deleted = deleteResult.status === 'fulfilled' || alreadyAbsent(deleteResult.reason)

  if (kicked && deleted) {
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_participant_id = NULL, provider_peer_id = NULL,
              left_at = COALESCE(left_at, datetime('now')), updated_at = datetime('now')
        WHERE session_id = ? AND user_id = ?`
    )
      .bind(member.session_id, member.user_id)
      .run()
    return
  }

  let recordingStopError = null
  const activeRecording = await env.DB.prepare(
    `SELECT id, provider_recording_id FROM interview_recordings
      WHERE session_id = ? AND provider_recording_id IS NOT NULL
        AND status IN ('starting','recording','paused','stopping')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(member.session_id)
    .first()
  if (activeRecording) {
    try {
      await controlRecording(env, {
        recordingId: activeRecording.provider_recording_id,
        action: 'stop',
      })
      await env.DB.prepare(
        `UPDATE interview_recordings
            SET status = 'processing', stopped_at = COALESCE(stopped_at, datetime('now')),
                updated_at = datetime('now') WHERE id = ?`
      )
        .bind(activeRecording.id)
        .run()
    } catch (error) {
      recordingStopError = error
      console.error(`Suspended user recording stop failed (${member.session_id}):`, error)
    }
  }

  let activeSessionEndError = null
  try {
    await kickAllParticipants(env, { meetingId: member.provider_meeting_id })
  } catch (error) {
    if (!isRealtimeKitAlreadyEnded(error)) {
      activeSessionEndError = error
      console.error(`Suspended user active session end failed (${member.session_id}):`, error)
    }
  }

  let meetingDeactivationError = null
  try {
    // 개별 연결/토큰 중 하나라도 폐기를 확인할 수 없으면 기존 토큰이 다시
    // 쓰이지 못하도록 meeting 전체를 INACTIVE로 만든다.
    await deleteMeeting(env, { meetingId: member.provider_meeting_id })
  } catch (error) {
    if (!isRealtimeKitAlreadyEnded(error)) {
      meetingDeactivationError = error
      console.error(`Suspended user meeting deactivation failed (${member.session_id}):`, error)
    }
  }

  if (!recordingStopError && !activeSessionEndError && !meetingDeactivationError) {
    await env.DB.prepare(
      `UPDATE interview_sessions
          SET status = 'failed', ended_at = COALESCE(ended_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ? AND status IN ('scheduled','waiting','live')`
    )
      .bind(member.session_id)
      .run()
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_participant_id = NULL, provider_peer_id = NULL,
              left_at = COALESCE(left_at, datetime('now')), updated_at = datetime('now')
        WHERE session_id = ?`
    )
      .bind(member.session_id)
      .run()
    return
  }

  const failure = recordingStopError || activeSessionEndError || meetingDeactivationError
  if (failure) {
    throw new InterviewUserAccessError(
      '계정은 정지했지만 녹화 중지·현재 세션 종료·재입장 차단 중 일부를 확인하지 못했습니다.',
      providerErrorStatus(failure)
    )
  }
}

export async function revokeActiveInterviewAccessForUser(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT m.session_id, m.user_id, m.custom_participant_id,
            m.provider_participant_id, s.provider_meeting_id
       FROM interview_session_members m
       JOIN interview_sessions s ON s.id = m.session_id
      WHERE m.user_id = ? AND s.status IN ('scheduled','waiting','live')
        AND (m.provider_participant_id IS NOT NULL OR m.admitted_at IS NOT NULL
             OR m.joined_at IS NOT NULL)`
  )
    .bind(userId)
    .all()

  const failures = []
  for (const member of results || []) {
    try {
      await revokeMembership(env, member)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    const status = failures.some((error) => error?.status === 503) ? 503 : 502
    throw new InterviewUserAccessError(
      `${failures.length}개 화상 면접의 기존 연결 정리를 완료하지 못했습니다. 계정 정지는 유지됩니다.`,
      status
    )
  }
  return { revokedMemberships: results?.length || 0 }
}
