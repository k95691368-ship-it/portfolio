import { jsonError, jsonResponse } from '../../../../../_lib/http.js'
import {
  CONSENT_NOTICE,
  CONSENT_NOTICE_HASH,
  CONSENT_NOTICE_VERSION,
  InterviewAccessError,
  clientAddress,
  clientUserAgent,
  ensureSessionMember,
  getInterviewSessionAccess,
  loadSessionForUser,
  logInterviewEvent,
  normalizeProviderRecording,
  serializeSession,
} from '../../../../../_lib/interviews.js'
import {
  controlRecording,
  deleteMeeting,
  deleteParticipant,
  isRealtimeKitAlreadyEnded,
  kickAllParticipants,
  kickParticipants,
} from '../../../../../_lib/realtimekit.js'

async function stopRecordingAfterRemovalFailure(env, sessionId) {
  const recording = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE session_id = ? AND provider_recording_id IS NOT NULL
        AND status IN ('starting','recording','paused','stopping')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(sessionId)
    .first()
  if (!recording) return true
  try {
    const provider = normalizeProviderRecording(
      await controlRecording(env, {
        recordingId: recording.provider_recording_id,
        action: 'stop',
      })
    )
    await env.DB.prepare(
      `UPDATE interview_recordings
          SET status = ?, stopped_at = COALESCE(?, stopped_at), updated_at = datetime('now')
        WHERE id = ?`
    )
      .bind(provider?.status || 'processing', provider?.stoppedAt, recording.id)
      .run()
    return true
  } catch (error) {
    console.error(`Recording safety stop failed (${recording.id}):`, error)
    return false
  }
}

async function revokeAdmission(env, session, member) {
  if (!member.admitted_at && !member.joined_at && !member.provider_participant_id) return
  const failures = []
  if (member.admitted_at || member.joined_at || member.provider_participant_id) {
    try {
      await kickParticipants(env, {
        meetingId: session.provider_meeting_id,
        customParticipantIds: [member.custom_participant_id],
      })
    } catch (error) {
      failures.push({ action: 'kick', error })
    }
  }
  if (member.provider_participant_id) {
    try {
      await deleteParticipant(env, {
        meetingId: session.provider_meeting_id,
        participantId: member.provider_participant_id,
      })
    } catch (error) {
      failures.push({ action: 'delete', error })
    }
  }
  if (failures.length) {
    const failure = new Error('공급자 참가자 퇴장 또는 토큰 폐기를 확인하지 못했습니다.')
    failure.actions = failures.map(({ action }) => action)
    throw failure
  }

  await env.DB.prepare(
    `UPDATE interview_session_members
        SET provider_participant_id = NULL, provider_peer_id = NULL, admitted_at = NULL,
            left_at = COALESCE(left_at, datetime('now')), updated_at = datetime('now')
      WHERE session_id = ? AND user_id = ?`
  )
    .bind(session.id, member.user_id)
    .run()
}

async function failClosedInterview(env, session) {
  const recordingStopped = await stopRecordingAfterRemovalFailure(env, session.id)
  let activeSessionEnded = false
  try {
    await kickAllParticipants(env, { meetingId: session.provider_meeting_id })
    activeSessionEnded = true
  } catch (error) {
    activeSessionEnded = isRealtimeKitAlreadyEnded(error)
    if (!activeSessionEnded) {
      console.error(`Consent safety active session end failed (${session.id}):`, error)
    }
  }
  let meetingDeactivated = false
  try {
    await deleteMeeting(env, { meetingId: session.provider_meeting_id })
    meetingDeactivated = true
  } catch (error) {
    meetingDeactivated = isRealtimeKitAlreadyEnded(error)
    if (!meetingDeactivated) {
      console.error(`Consent safety meeting deactivation failed (${session.id}):`, error)
    }
  }

  let localSessionClosed = false
  if (recordingStopped && activeSessionEnded && meetingDeactivated) {
    try {
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
      localSessionClosed = true
    } catch (error) {
      console.error(`Consent safety local close failed (${session.id}):`, error)
    }
  }
  return { recordingStopped, activeSessionEnded, meetingDeactivated, localSessionClosed }
}

async function storeConsentDecision(env, request, sessionId, userId, granted) {
  await env.DB.prepare(
    `INSERT INTO interview_recording_consents
       (session_id, user_id, notice_version, notice_hash, granted,
        consented_at, revoked_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?,
             CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
             CASE WHEN ? = 0 THEN datetime('now') ELSE NULL END, ?, ?)
     ON CONFLICT(session_id, user_id, notice_version) DO UPDATE SET
       notice_hash = excluded.notice_hash,
       granted = excluded.granted,
       consented_at = CASE WHEN excluded.granted = 1 THEN datetime('now') ELSE interview_recording_consents.consented_at END,
       revoked_at = CASE WHEN excluded.granted = 0 THEN datetime('now') ELSE NULL END,
       ip_address = excluded.ip_address,
       user_agent = excluded.user_agent,
       updated_at = datetime('now')`
  )
    .bind(
      sessionId,
      userId,
      CONSENT_NOTICE_VERSION,
      CONSENT_NOTICE_HASH,
      granted ? 1 : 0,
      granted ? 1 : 0,
      granted ? 1 : 0,
      clientAddress(request),
      clientUserAgent(request)
    )
    .run()
}

function consentFailureMessage(safety) {
  if (safety.localSessionClosed) {
    return '녹화 동의는 철회되었습니다. 개별 참가자 퇴장 또는 토큰 폐기를 확인하지 못해 화상 면접 연결 전체를 종료했습니다.'
  }
  return safety.recordingStopped && safety.activeSessionEnded
    ? '녹화 동의는 철회되었습니다. 참가자 퇴장을 확인하지 못해 진행 중인 녹화를 중지했습니다.'
    : '녹화 동의는 철회되었지만 참가자 퇴장과 녹화 중지를 확인하지 못했습니다. 진행자에게 즉시 녹화 중지를 요청해주세요.'
}

export async function onRequestPost({ request, env, data, params }) {
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
  if (['ended', 'cancelled', 'failed'].includes(session.status)) {
    return jsonError('종료되었거나 취소된 화상 면접의 동의 상태는 변경할 수 없습니다.', 409)
  }

  const member = await ensureSessionMember(
    env,
    params.sessionId,
    data.user.id,
    access.videoRole
  )
  if (!member) return jsonError('이 화상 면접의 참가자가 아닙니다.', 403)

  const body = await request.json().catch(() => null)
  if (typeof body?.granted !== 'boolean') {
    return jsonError('녹화 동의 여부를 선택해주세요.', 400)
  }
  if (
    body.noticeVersion !== CONSENT_NOTICE_VERSION ||
    body.noticeHash !== CONSENT_NOTICE_HASH
  ) {
    return jsonResponse(
      {
        error: '녹화 동의 안내가 변경되었습니다. 최신 내용을 확인해주세요.',
        consentNotice: CONSENT_NOTICE,
      },
      409
    )
  }

  const granted = body.granted
  // 철회는 먼저 D1에 확정한다. 이 쓰기가 끝난 순간부터 join-token이 거부되므로,
  // 공급자 퇴장 요청이나 그 뒤의 정리 쓰기가 실패해도 새 토큰은 발급되지 않는다.
  await storeConsentDecision(env, request, params.sessionId, data.user.id, granted)

  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: granted ? 'recording.consentGranted' : 'recording.consentRefused',
    actorUserId: data.user.id,
    details: { noticeVersion: CONSENT_NOTICE_VERSION, noticeHash: CONSENT_NOTICE_HASH },
  }).catch((error) => {
    // 동의 정본은 이미 저장되었다. 감사 이벤트 실패 때문에 철회 집행을 건너뛰지 않는다.
    console.error(`Consent event write failed (${params.sessionId}):`, error)
  })

  if (!granted) {
    // 동의 화면을 연 뒤 join-token 요청이 동시에 admitted 상태를 쓸 수 있다.
    // 철회 저장 전의 member snapshot을 쓰면 그 참가자를 놓치므로 정본 저장 직후
    // 최신 공급자 참가자 ID/admitted 상태를 다시 읽어 퇴장을 집행한다.
    const currentMember =
      (await env.DB.prepare(
        'SELECT * FROM interview_session_members WHERE session_id = ? AND user_id = ?'
      )
        .bind(params.sessionId, data.user.id)
        .first()) || member
    try {
      await revokeAdmission(env, session, currentMember)
    } catch (error) {
      console.error(
        `Consent withdrawal participant removal failed (${currentMember.custom_participant_id}):`,
        error
      )
      const safety = await failClosedInterview(env, session)
      const updated = await loadSessionForUser(
        env,
        params.roomId,
        params.sessionId,
        data.user.id
      )
      if (updated) {
        updated.my_consent_decided = 1
        updated.my_consent_granted = 0
      }
      return jsonResponse(
        {
          error: consentFailureMessage(safety),
          granted: false,
          participantRemoved: false,
          recordingSafetyStopped: safety.recordingStopped,
          activeSessionEnded: safety.activeSessionEnded,
          meetingDeactivated: safety.meetingDeactivated,
          localSessionClosed: safety.localSessionClosed,
          session: serializeSession(updated),
        },
        502
      )
    }
  }

  const updated = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  return jsonResponse({
    granted,
    ...(!granted ? { participantRemoved: true } : {}),
    session: serializeSession(updated),
  })
}
