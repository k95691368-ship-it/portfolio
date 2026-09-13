import { jsonError, jsonResponse } from '../../../../../_lib/http.js'
import {
  CONSENT_NOTICE_HASH,
  CONSENT_NOTICE_VERSION,
  InterviewAccessError,
  ensureSessionMember,
  getInterviewSessionAccess,
  hasCurrentConsent,
  loadSessionForUser,
  logInterviewEvent,
} from '../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../_lib/roomLifecycle.js'
import { interviewIceServers } from '../../../../../_lib/turn.js'
import {
  VideoServiceConfigError,
  issueParticipantCredentials,
} from '../../../../../_lib/supabaseRealtime.js'

async function userIsActive(env, userId) {
  const user = await env.DB.prepare('SELECT is_suspended FROM users WHERE id = ?')
    .bind(userId)
    .first()
  return Boolean(user) && Number(user.is_suspended) === 0
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

  const session = await loadSessionForUser(env, params.roomId, params.sessionId, data.user.id)
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  const frozen = blockedWhenFrozen(access.room, 'join_interview')
  if (frozen) return jsonError(frozen, 409)
  if (!['scheduled', 'waiting', 'live'].includes(session.status)) {
    return jsonError('종료되었거나 취소된 화상 면접에는 입장할 수 없습니다.', 409)
  }

  const member = await ensureSessionMember(env, params.sessionId, data.user.id, access.videoRole)
  if (!member) return jsonError('이 화상 면접의 참가자가 아닙니다.', 403)

  const recordingRequired = Number(session.recording_required) === 1
  if (recordingRequired && !(await hasCurrentConsent(env, params.sessionId, data.user.id))) {
    return jsonError(
      '녹화에 동의해야 이 화상 면접에 입장할 수 있습니다. 녹화 안내를 확인하고 동의해주세요.',
      403
    )
  }
  if (!(await userIsActive(env, data.user.id))) {
    return jsonError('계정이 비활성화되어 화상 면접에 입장할 수 없습니다.', 403)
  }

  const participantId = crypto.randomUUID()
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
      participantId,
      params.sessionId,
      data.user.id,
      recordingRequired ? 1 : 0,
      CONSENT_NOTICE_VERSION,
      CONSENT_NOTICE_HASH
    )
    .run()

  if (admitted.meta?.changes === 0) {
    return jsonError('입장 조건이 변경되었습니다. 녹화 동의와 계정 상태를 다시 확인해주세요.', 403)
  }
  if (
    !(await userIsActive(env, data.user.id)) ||
    (recordingRequired && !(await hasCurrentConsent(env, params.sessionId, data.user.id)))
  ) {
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET admitted_at = NULL, left_at = datetime('now'), updated_at = datetime('now')
        WHERE session_id = ? AND user_id = ?`
    )
      .bind(params.sessionId, data.user.id)
      .run()
    return jsonError('입장 조건이 변경되어 화상 면접 입장을 차단했습니다.', 403)
  }

  let credentials
  try {
    credentials = issueParticipantCredentials(env, {
      meetingId: session.provider_meeting_id,
      participantId,
      customParticipantId: member.custom_participant_id,
      role: member.role,
      displayName: String(data.user.display_name || '참가자').slice(0, 100),
    })
  } catch (error) {
    if (error instanceof VideoServiceConfigError) {
      console.error('Supabase realtime configuration is incomplete:', error.missing.join(', '))
      return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
    }
    throw error
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

  return jsonResponse({ ...credentials, roomId: params.roomId, sessionId: params.sessionId,
    ...(await interviewIceServers(env, participantId)) })
}
