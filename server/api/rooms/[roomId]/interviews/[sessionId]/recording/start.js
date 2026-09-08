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
  serializeRecording,
} from '../../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../../_lib/roomLifecycle.js'

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

export async function onRequestPost({ env, data, params }) {
  let access
  try {
    access = await getRoomForInterview(env, params.roomId, data.user, { allowAdminRead: false })
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }

  const session = await loadSessionForUser(env, params.roomId, params.sessionId, data.user.id)
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
  if (!env.INTERVIEW_RECORDINGS?.createSignedUploadUrl) {
    return jsonError('화상 면접 녹화 보관소가 아직 설정되지 않았습니다.', 503)
  }

  const localId = genId()
  const storageKey = `interviews/${params.sessionId}/${localId}.webm`
  const filename = `${localId}.webm`
  try {
    await env.DB.prepare(
      `INSERT INTO interview_recordings
         (id, session_id, provider_recording_id, provider_session_id, status,
          storage_status, r2_key, content_type, filename, started_at, created_by_user_id)
       VALUES (?, ?, ?, ?, 'recording', 'pending', ?, 'video/webm', ?, datetime('now'), ?)`
    )
      .bind(
        localId,
        params.sessionId,
        localId,
        session.provider_meeting_id,
        storageKey,
        filename,
        data.user.id
      )
      .run()
  } catch {
    const raced = await activeRecording(env, params.sessionId)
    if (raced) return jsonResponse({ recording: serializeRecording(raced), idempotent: true })
    return jsonError('녹화 시작 상태를 저장하지 못했습니다.', 500)
  }

  let upload
  try {
    upload = await env.INTERVIEW_RECORDINGS.createSignedUploadUrl(storageKey)
  } catch (error) {
    await env.DB.prepare(
      `UPDATE interview_recordings
          SET status = 'failed', failure_reason = 'signed_upload_failed',
              updated_at = datetime('now') WHERE id = ?`
    )
      .bind(localId)
      .run()
      .catch(() => {})
    console.error(`Supabase signed recording upload creation failed (${localId}):`, error)
    return jsonError('녹화 저장 경로를 준비하지 못했습니다.', 503)
  }

  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: 'recording.started',
    actorUserId: data.user.id,
    details: { recordingId: localId },
  })
  const stored = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
    .bind(localId)
    .first()
  return jsonResponse(
    {
      recording: serializeRecording(stored),
      upload: { bucket: 'interview-recordings', path: upload.path, token: upload.token },
    },
    201
  )
}
