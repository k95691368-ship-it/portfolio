import { jsonError, jsonResponse } from '../../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  loadSessionForUser,
  logInterviewEvent,
  retentionHasExpired,
  serializeRecording,
} from '../../../../../../../_lib/interviews.js'

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
  const session = await loadSessionForUser(env, params.roomId, params.sessionId, data.user.id)
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  if (access.videoRole !== 'host' || session.my_role !== 'host') {
    return jsonError('녹화 저장 완료는 진행자만 확인할 수 있습니다.', 403)
  }

  const recording = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE id = ? AND session_id = ? AND deleted_at IS NULL`
  )
    .bind(params.recordingId, params.sessionId)
    .first()
  if (!recording) return jsonError('녹화 기록을 찾을 수 없습니다.', 404)
  if (retentionHasExpired(recording.retention_until)) {
    return jsonError('보존 기간이 끝난 녹화는 저장할 수 없습니다.', 410)
  }
  if (recording.storage_status === 'stored' && recording.status === 'available') {
    return jsonResponse({ recording: serializeRecording(recording), idempotent: true })
  }
  if (!recording.r2_key || !env.INTERVIEW_RECORDINGS) {
    return jsonError('녹화 저장 경로를 확인할 수 없습니다.', 503)
  }

  const body = await request.json().catch(() => null)
  const claimedSize = Number(body?.sizeBytes)
  const duration = Number(body?.durationSeconds)
  const sha256 = String(body?.sha256 || '').toLowerCase()
  if (!Number.isSafeInteger(claimedSize) || claimedSize <= 0) {
    return jsonError('녹화 파일 크기를 확인할 수 없습니다.', 400)
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return jsonError('녹화 파일 지문을 확인할 수 없습니다.', 400)
  }

  const stored = await env.INTERVIEW_RECORDINGS.head(recording.r2_key)
  if (!stored) return jsonError('업로드된 녹화 파일을 찾을 수 없습니다.', 409)
  if (Number(stored.size) !== claimedSize) {
    return jsonError('업로드된 녹화 파일의 크기가 일치하지 않습니다.', 409)
  }

  await env.DB.prepare(
    `UPDATE interview_recordings
        SET status = 'available', storage_status = 'stored', sha256 = ?, size_bytes = ?,
            duration_seconds = ?, content_type = 'video/webm',
            retention_until = COALESCE(retention_until, datetime('now', '+30 days')),
            stopped_at = COALESCE(stopped_at, datetime('now')), failure_reason = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL`
  )
    .bind(
      sha256,
      claimedSize,
      Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
      recording.id
    )
    .run()

  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: 'recording.stored',
    actorUserId: data.user.id,
    details: { recordingId: recording.id, sizeBytes: claimedSize, sha256 },
  })
  const updated = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
    .bind(recording.id)
    .first()
  return jsonResponse({ recording: serializeRecording(updated) })
}
