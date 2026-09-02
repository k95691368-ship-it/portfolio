import { genId } from '../../../../../../_lib/db.js'
import { jsonError, jsonResponse } from '../../../../../../_lib/http.js'
import {
  CONSENT_NOTICE_HASH,
  CONSENT_NOTICE_VERSION,
  InterviewAccessError,
  getRoomForInterview,
  hasCurrentConsent,
  loadSessionForUser,
  logInterviewEvent,
  normalizeProviderRecording,
  serializeRecording,
} from '../../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../../_lib/roomLifecycle.js'
import {
  getDirectRecordingPath,
  recordingFilePrefix,
} from '../../../../../../_lib/interviewRecordings.js'
import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  controlRecording,
  deleteMeeting,
  isRealtimeKitAlreadyEnded,
  kickAllParticipants,
  startRecording,
} from '../../../../../../_lib/realtimekit.js'

async function activeRecording(env, sessionId) {
  return env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE session_id = ?
        AND status IN ('starting','recording','paused','stopping','processing')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(sessionId)
    .first()
}

async function markFailed(env, recordingId, reason) {
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET status = 'failed', failure_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'starting'`
  )
    .bind(reason, recordingId)
    .run()
    .catch(() => {})
}

async function closeUncertainProviderMeeting(env, session) {
  let activeSessionEnded = false
  let meetingDeactivated = false
  try {
    await kickAllParticipants(env, { meetingId: session.provider_meeting_id })
    activeSessionEnded = true
  } catch (error) {
    activeSessionEnded = isRealtimeKitAlreadyEnded(error)
    if (!activeSessionEnded) {
      console.error(`Recording safety active session end failed (${session.id}):`, error)
    }
  }
  try {
    await deleteMeeting(env, { meetingId: session.provider_meeting_id })
    meetingDeactivated = true
  } catch (error) {
    meetingDeactivated = isRealtimeKitAlreadyEnded(error)
    if (!meetingDeactivated) {
      console.error(`Recording safety meeting deactivation failed (${session.id}):`, error)
    }
  }
  if (activeSessionEnded && meetingDeactivated) {
    await env.DB.prepare(
      `UPDATE interview_sessions
          SET status = 'failed', ended_at = COALESCE(ended_at, datetime('now')),
              updated_at = datetime('now')
        WHERE id = ? AND status IN ('scheduled','waiting','live')`
    )
      .bind(session.id)
      .run()
      .catch(() => {})
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_participant_id = NULL, provider_peer_id = NULL,
              left_at = COALESCE(left_at, datetime('now')), updated_at = datetime('now')
        WHERE session_id = ?`
    )
      .bind(session.id)
      .run()
      .catch(() => {})
  }
  return { activeSessionEnded, meetingDeactivated }
}

async function stopStartedRecordingOrCloseMeeting(env, session, providerRecordingId) {
  try {
    await controlRecording(env, { recordingId: providerRecordingId, action: 'stop' })
    return { recordingStopped: true, activeSessionEnded: false, meetingDeactivated: false }
  } catch (error) {
    console.error(`Recording compensation stop failed (${providerRecordingId}):`, error)
    return {
      recordingStopped: false,
      ...(await closeUncertainProviderMeeting(env, session)),
    }
  }
}

export async function onRequestPost({ env, data, params }) {
  let access
  try {
    access = await getRoomForInterview(env, params.roomId, data.user, { allowAdminRead: false })
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
  if (session.my_role !== 'host') return jsonError('녹화는 진행자만 시작할 수 있습니다.', 403)

  const frozen = blockedWhenFrozen(access.room, 'start_recording')
  if (frozen) return jsonError(frozen, 409)
  if (!['waiting', 'live'].includes(session.status)) {
    return jsonError('입장이 시작된 화상 면접에서만 녹화할 수 있습니다.', 409)
  }
  if (Number(session.recording_required) !== 1) {
    return jsonError('녹화가 필수로 고지된 화상 면접에서만 녹화를 시작할 수 있습니다.', 409)
  }
  if (!(await hasCurrentConsent(env, params.sessionId, data.user.id))) {
    return jsonError('진행자도 현재 녹화 안내에 동의해야 녹화를 시작할 수 있습니다.', 403)
  }

  const missing = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM interview_session_members m
       LEFT JOIN interview_recording_consents c
         ON c.session_id = m.session_id AND c.user_id = m.user_id
        AND c.notice_version = ? AND c.notice_hash = ?
      WHERE m.session_id = ?
        AND (m.admitted_at IS NOT NULL OR m.joined_at IS NOT NULL)
        AND m.left_at IS NULL
        AND (c.granted IS NULL OR c.granted <> 1 OR c.revoked_at IS NOT NULL)`
  )
    .bind(CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH, params.sessionId)
    .first()
  if (Number(missing?.count) > 0) {
    return jsonResponse(
      {
        error: '녹화에 동의하지 않은 입장자가 있어 녹화를 시작할 수 없습니다.',
        missingConsentCount: Number(missing.count),
      },
      409
    )
  }

  const existing = await activeRecording(env, params.sessionId)
  if (existing) return jsonResponse({ recording: serializeRecording(existing), idempotent: true })

  if (!env.INTERVIEW_RECORDINGS || !getDirectRecordingPath(env)) {
    return jsonError(
      '화상 면접 녹화 보관소가 아직 설정되지 않았습니다.',
      503
    )
  }

  const localId = genId()
  try {
    await env.DB.prepare(
      `INSERT INTO interview_recordings
         (id, session_id, status, storage_status, created_by_user_id)
       VALUES (?, ?, 'starting', 'pending', ?)`
    )
      .bind(localId, params.sessionId, data.user.id)
      .run()
  } catch {
    const raced = await activeRecording(env, params.sessionId)
    if (raced) return jsonResponse({ recording: serializeRecording(raced), idempotent: true })
    return jsonError('녹화 시작 상태를 저장하지 못했습니다.', 500)
  }

  let provider
  try {
    provider = normalizeProviderRecording(
      await startRecording(env, {
        meetingId: session.provider_meeting_id,
        fileNamePrefix: recordingFilePrefix(localId),
      })
    )
  } catch (error) {
    if (error instanceof RealtimeKitConfigError) {
      await markFailed(env, localId, 'provider_start_config_missing')
      console.error('RealtimeKit configuration is incomplete:', error.missing.join(', '))
      return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
    }
    const safety = await closeUncertainProviderMeeting(env, session)
    await markFailed(
      env,
      localId,
      safety.activeSessionEnded && safety.meetingDeactivated
        ? 'provider_start_unconfirmed_meeting_closed'
        : 'provider_start_unconfirmed_cleanup_failed'
    )
    if (error instanceof RealtimeKitApiError) {
      console.error(`RealtimeKit recording start failed (status ${error.status})`)
      return jsonError(
        safety.activeSessionEnded && safety.meetingDeactivated
          ? '녹화 시작 여부를 확인할 수 없어 화상 면접 연결을 안전하게 종료했습니다.'
          : '녹화 시작 여부와 화상 면접 연결 종료를 확인하지 못했습니다.',
        502
      )
    }
    throw error
  }

  if (!provider?.providerRecordingId || !provider.status) {
    const safety = provider?.providerRecordingId
      ? await stopStartedRecordingOrCloseMeeting(
          env,
          session,
          provider.providerRecordingId
        )
      : {
          recordingStopped: false,
          ...(await closeUncertainProviderMeeting(env, session)),
        }
    await markFailed(
      env,
      localId,
      safety.recordingStopped || (safety.activeSessionEnded && safety.meetingDeactivated)
        ? 'invalid_provider_response_compensated'
        : 'invalid_provider_response_cleanup_failed'
    )
    return jsonError(
      safety.recordingStopped || (safety.activeSessionEnded && safety.meetingDeactivated)
        ? '녹화 서비스 응답이 불완전해 시작된 작업을 안전하게 종료했습니다.'
        : '녹화 서비스 응답과 시작된 작업의 종료 여부를 확인할 수 없습니다.',
      502
    )
  }

  try {
    await env.DB.prepare(
      `UPDATE interview_recordings
          SET provider_recording_id = ?, provider_session_id = ?, status = ?,
              provider_download_url = NULL, provider_download_url_expires_at = NULL,
              size_bytes = ?, duration_seconds = ?, filename = ?,
              started_at = ?, stopped_at = ?, updated_at = datetime('now')
        WHERE id = ?`
    )
      .bind(
        provider.providerRecordingId,
        provider.providerSessionId,
        provider.status,
        provider.sizeBytes,
        provider.durationSeconds,
        provider.filename,
        provider.startedAt,
        provider.stoppedAt,
        localId
      )
      .run()
  } catch (error) {
    // 공급자 녹화는 시작됐는데 로컬 식별자 연결이 실패하면 webhook만으로
    // 소유권을 복원할 수 없다. 즉시 stop하고, stop도 불확실하면 meeting을
    // INACTIVE로 닫아 녹화가 고아로 계속되는 상태를 막는다.
    const safety = await stopStartedRecordingOrCloseMeeting(
      env,
      session,
      provider.providerRecordingId
    )
    const compensated =
      safety.recordingStopped || (safety.activeSessionEnded && safety.meetingDeactivated)
    await env.DB.prepare(
      `UPDATE interview_recordings
          SET provider_recording_id = COALESCE(provider_recording_id, ?), status = 'failed',
              failure_reason = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(
        provider.providerRecordingId,
        compensated ? 'provider_started_local_update_failed' : 'provider_stop_unconfirmed',
        localId
      )
      .run()
      .catch(() => {})
    console.error(`Recording provider link update failed (${localId}):`, error)
    return jsonError(
      compensated
        ? '녹화 기록 저장에 실패해 시작된 녹화를 중지했습니다.'
        : '녹화 기록 저장과 공급자 녹화 중지 확인에 실패했습니다.',
      compensated ? 500 : 502
    )
  }

  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: 'recording.startRequested',
    actorUserId: data.user.id,
    details: { recordingId: localId },
  })
  const stored = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
    .bind(localId)
    .first()
  return jsonResponse({ recording: serializeRecording(stored) }, 201)
}
