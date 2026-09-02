import { jsonError, jsonResponse } from '../../../../../_lib/http.js'
import {
  CONSENT_NOTICE_HASH,
  CONSENT_NOTICE_VERSION,
  InterviewAccessError,
  configuredPresetForRole,
  ensureSessionMember,
  getInterviewSessionAccess,
  hasCurrentConsent,
  loadSessionForUser,
  logInterviewEvent,
  normalizeProviderRecording,
} from '../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../_lib/roomLifecycle.js'
import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  addParticipant,
  controlRecording,
  deleteMeeting,
  deleteParticipant,
  isRealtimeKitAlreadyEnded,
  kickAllParticipants,
  kickParticipants,
  listParticipants,
  refreshParticipantToken,
} from '../../../../../_lib/realtimekit.js'

function providerFailure(error) {
  if (error instanceof RealtimeKitConfigError) {
    console.error('RealtimeKit configuration is incomplete:', error.missing.join(', '))
    return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
  }
  if (error instanceof RealtimeKitApiError) {
    console.error(`RealtimeKit participant token failed (status ${error.status})`)
    return jsonError('화상 면접 입장 정보를 발급하지 못했습니다. 다시 시도해주세요.', 502)
  }
  throw error
}

async function recoverExistingParticipant(env, session, member) {
  const participants = await listParticipants(env, { meetingId: session.provider_meeting_id })
  const rows = Array.isArray(participants)
    ? participants
    : Array.isArray(participants?.participants)
      ? participants.participants
      : []
  const found = rows.find(
    (participant) => participant.custom_participant_id === member.custom_participant_id
  )
  if (!found?.id) return null
  return {
    id: found.id,
    ...(await refreshParticipantToken(env, {
      meetingId: session.provider_meeting_id,
      participantId: found.id,
    })),
  }
}

async function invalidateParticipantAfterConsentChange(
  env,
  session,
  member,
  providerParticipantId
) {
  // 토큰을 받은 직후 이미 연결을 시도한 경우와, 아직 토큰만 존재하는 경우를
  // 함께 닫기 위해 kick과 participant 삭제를 서로 독립적으로 실행한다.
  const [kickResult, deleteResult] = await Promise.allSettled([
    kickParticipants(env, {
      meetingId: session.provider_meeting_id,
      customParticipantIds: [member.custom_participant_id],
    }),
    deleteParticipant(env, {
      meetingId: session.provider_meeting_id,
      participantId: providerParticipantId,
    }),
  ])
  const actionConfirmed = (result) =>
    result.status === 'fulfilled' || isRealtimeKitAlreadyEnded(result.reason)
  const participantInvalidated = actionConfirmed(kickResult) && actionConfirmed(deleteResult)

  let recordingStopped = true
  let activeSessionEnded = false
  let meetingDeactivated = false
  if (!participantInvalidated) {
    const recording = await env.DB.prepare(
      `SELECT id, provider_recording_id
         FROM interview_recordings
        WHERE session_id = ? AND provider_recording_id IS NOT NULL
          AND status IN ('starting','recording','paused','stopping')
        ORDER BY created_at DESC LIMIT 1`
    )
      .bind(session.id)
      .first()
    if (recording) {
      try {
        const provider = normalizeProviderRecording(
          await controlRecording(env, {
            recordingId: recording.provider_recording_id,
            action: 'stop',
          })
        )
        await env.DB.prepare(
          `UPDATE interview_recordings
              SET status = ?, stopped_at = COALESCE(?, stopped_at),
                  updated_at = datetime('now')
            WHERE id = ?`
        )
          .bind(provider?.status || 'processing', provider?.stoppedAt, recording.id)
          .run()
      } catch (error) {
        recordingStopped = false
        console.error(`Consent race recording safety stop failed (${recording.id}):`, error)
      }
    }
    try {
      await kickAllParticipants(env, { meetingId: session.provider_meeting_id })
      activeSessionEnded = true
    } catch (error) {
      activeSessionEnded = isRealtimeKitAlreadyEnded(error)
      if (!activeSessionEnded) {
        console.error(`Consent race active session end failed (${session.id}):`, error)
      }
    }
    try {
      await deleteMeeting(env, { meetingId: session.provider_meeting_id })
      meetingDeactivated = true
    } catch (error) {
      meetingDeactivated = isRealtimeKitAlreadyEnded(error)
      if (!meetingDeactivated) {
        console.error(`Consent race meeting deactivation failed (${session.id}):`, error)
      }
    }
  }

  const fullMeetingClosed =
    !participantInvalidated && recordingStopped && activeSessionEnded && meetingDeactivated
  if (fullMeetingClosed) {
    await env.DB.prepare(
      `UPDATE interview_sessions
          SET status = 'failed', ended_at = COALESCE(ended_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ? AND status NOT IN ('ended','cancelled')`
    )
      .bind(session.id)
      .run()
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_participant_id = NULL, provider_peer_id = NULL,
              left_at = COALESCE(left_at, datetime('now')), updated_at = datetime('now')
        WHERE session_id = ?`
    )
      .bind(session.id)
      .run()
  } else if (participantInvalidated) {
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_participant_id = NULL, provider_peer_id = NULL, admitted_at = NULL,
              left_at = COALESCE(left_at, datetime('now')), updated_at = datetime('now')
        WHERE session_id = ? AND user_id = ?`
    )
      .bind(session.id, member.user_id)
      .run()
  }

  return {
    participantInvalidated,
    recordingStopped,
    activeSessionEnded,
    meetingDeactivated,
    fullMeetingClosed,
  }
}

async function rejectConsentRace(env, session, member, providerParticipantId) {
  const safety = await invalidateParticipantAfterConsentChange(
    env,
    session,
    member,
    providerParticipantId
  )
  if (!safety.participantInvalidated && !safety.fullMeetingClosed) {
    return jsonError(
      '녹화 동의가 변경되어 입장을 차단했지만 공급자 토큰 폐기를 확인하지 못했습니다.',
      502
    )
  }
  return jsonError(
    safety.fullMeetingClosed
      ? '녹화 동의가 변경되어 입장을 차단하고 화상 면접 연결을 종료했습니다.'
      : '녹화 동의가 변경되어 입장을 차단했습니다. 최신 안내를 다시 확인해주세요.',
    403
  )
}

async function userIsActive(env, userId) {
  const user = await env.DB.prepare(
    'SELECT is_suspended FROM users WHERE id = ?'
  )
    .bind(userId)
    .first()
  return Boolean(user) && Number(user.is_suspended) === 0
}

async function rejectSuspensionRace(env, session, member, providerParticipantId) {
  const safety = await invalidateParticipantAfterConsentChange(
    env,
    session,
    member,
    providerParticipantId
  )
  if (!safety.participantInvalidated && !safety.fullMeetingClosed) {
    return jsonError(
      '계정이 비활성화되어 입장을 차단했지만 공급자 토큰 폐기를 확인하지 못했습니다.',
      502
    )
  }
  return jsonError(
    safety.fullMeetingClosed
      ? '계정이 비활성화되어 입장을 차단하고 화상 면접 연결을 종료했습니다.'
      : '계정이 비활성화되어 화상 면접 입장을 차단했습니다.',
    403
  )
}

export async function onRequestPost({ env, data, params }) {
  let access
  try {
    access = await getInterviewSessionAccess(
      env,
      params.roomId,
      params.sessionId,
      data.user,
      { allowAdminRead: false }
    )
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }

  const session = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  const frozen = blockedWhenFrozen(access.room, 'join_interview')
  if (frozen) return jsonError(frozen, 409)
  if (!['scheduled', 'waiting', 'live'].includes(session.status)) {
    return jsonError('종료되었거나 취소된 화상 면접에는 입장할 수 없습니다.', 409)
  }

  const member = await ensureSessionMember(
    env,
    params.sessionId,
    data.user.id,
    access.videoRole
  )
  if (!member) return jsonError('이 화상 면접의 참가자가 아닙니다.', 403)

  if (
    Number(session.recording_required) === 1 &&
    !(await hasCurrentConsent(env, params.sessionId, data.user.id))
  ) {
    return jsonError(
      '녹화에 동의해야 이 화상 면접에 입장할 수 있습니다. 녹화 안내를 확인하고 동의해주세요.',
      403
    )
  }

  const presetName = configuredPresetForRole(env, member.role)
  if (!presetName) {
    console.error(`RealtimeKit role preset is missing (${member.role})`)
    return jsonError('화상 면접 역할 권한이 아직 설정되지 않았습니다.', 503)
  }

  let providerParticipant
  try {
    if (member.provider_participant_id) {
      providerParticipant = await refreshParticipantToken(env, {
        meetingId: session.provider_meeting_id,
        participantId: member.provider_participant_id,
      })
      providerParticipant.id = member.provider_participant_id
    } else {
      try {
        providerParticipant = await addParticipant(env, {
          meetingId: session.provider_meeting_id,
          customParticipantId: member.custom_participant_id,
          presetName,
          name: String(data.user.display_name || '참가자').slice(0, 100),
        })
      } catch (error) {
        // 공급자 생성은 성공하고 D1 반영만 실패했던 요청을 안전하게 복구한다.
        if (!(error instanceof RealtimeKitApiError) || error.status !== 409) throw error
        providerParticipant = await recoverExistingParticipant(env, session, member)
        if (!providerParticipant) throw error
      }
    }
  } catch (error) {
    return providerFailure(error)
  }

  const authToken = providerParticipant?.token
  if (!authToken || !providerParticipant?.id) {
    console.error('RealtimeKit participant response omitted token or participant id')
    return jsonError('화상 면접 입장 정보를 발급하지 못했습니다. 다시 시도해주세요.', 502)
  }

  const recordingRequired = Number(session.recording_required) === 1
  if (
    recordingRequired &&
    !(await hasCurrentConsent(env, params.sessionId, data.user.id))
  ) {
    return rejectConsentRace(env, session, member, providerParticipant.id)
  }

  // 인증 토큰은 응답으로만 전달한다. D1에는 공급자 참가자 ID와 발급 시각만 남긴다.
  const admitted = await env.DB.prepare(
    `UPDATE interview_session_members
        SET provider_participant_id = ?, admitted_at = COALESCE(admitted_at, datetime('now')),
            left_at = NULL, updated_at = datetime('now')
      WHERE session_id = ? AND user_id = ?
        AND EXISTS (
          SELECT 1 FROM users active_user
           WHERE active_user.id = interview_session_members.user_id
             AND active_user.is_suspended = 0
        )
        AND (? = 0 OR EXISTS (
          SELECT 1 FROM interview_recording_consents c
           WHERE c.session_id = interview_session_members.session_id
             AND c.user_id = interview_session_members.user_id
             AND c.notice_version = ? AND c.notice_hash = ?
             AND c.granted = 1 AND c.revoked_at IS NULL
        ))`
  )
    .bind(
      providerParticipant.id,
      params.sessionId,
      data.user.id,
      recordingRequired ? 1 : 0,
      CONSENT_NOTICE_VERSION,
      CONSENT_NOTICE_HASH
    )
    .run()
  const activeAfterAdmission = await userIsActive(env, data.user.id)
  if (admitted.meta?.changes === 0) {
    if (!activeAfterAdmission) {
      return rejectSuspensionRace(env, session, member, providerParticipant.id)
    }
    return rejectConsentRace(env, session, member, providerParticipant.id)
  }
  if (!activeAfterAdmission) {
    return rejectSuspensionRace(env, session, member, providerParticipant.id)
  }
  // 조건부 admitted 쓰기 직후 한 번 더 읽는다. 이 사이 철회 요청이 admitted 상태를
  // 보고 공급자 퇴장을 집행할 수 있고, 여기서 바뀐 동의를 보면 토큰을 반환하지 않는다.
  if (
    recordingRequired &&
    !(await hasCurrentConsent(env, params.sessionId, data.user.id))
  ) {
    return rejectConsentRace(env, session, member, providerParticipant.id)
  }
  // 녹화 비필수 세션도 포함해, provider 참가자 생성 뒤 계정이 정지된 요청은
  // 토큰을 반환하지 않는다. 이 최종 읽기 실패도 비활성으로 취급한다.
  if (!(await userIsActive(env, data.user.id))) {
    return rejectSuspensionRace(env, session, member, providerParticipant.id)
  }
  await env.DB.prepare(
    `UPDATE interview_sessions
        SET status = CASE WHEN status = 'scheduled' THEN 'waiting' ELSE status END,
            updated_at = datetime('now')
      WHERE id = ?`
  )
    .bind(params.sessionId)
    .run()
  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: 'participant.admitted',
    actorUserId: data.user.id,
    details: { role: member.role },
  })

  return jsonResponse({ authToken })
}
