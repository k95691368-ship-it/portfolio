import { jsonError, jsonResponse } from '../../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  loadSessionForUser,
  retentionHasExpired,
  serializeRecording,
} from '../../../../../../../_lib/interviews.js'

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
  if (access.videoRole !== 'host' || session.my_role !== 'host') {
    return jsonError('녹화 보관 재시도는 진행자만 할 수 있습니다.', 403)
  }

  const recording = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE id = ? AND session_id = ? AND deleted_at IS NULL`
  )
    .bind(params.recordingId, params.sessionId)
    .first()
  if (!recording) return jsonError('녹화 기록을 찾을 수 없습니다.', 404)
  if (retentionHasExpired(recording.retention_until)) {
    return jsonError('보존 기간이 끝난 녹화는 다시 보관할 수 없습니다.', 410)
  }
  if (recording.storage_status === 'stored' && recording.r2_key) {
    return jsonResponse({ recording: serializeRecording(recording), idempotent: true })
  }
  if (!recording.r2_key || !env.INTERVIEW_RECORDINGS) {
    return jsonError('녹화 저장 경로를 확인할 수 없습니다.', 503)
  }

  const stored = await env.INTERVIEW_RECORDINGS.head(recording.r2_key)
  if (!stored) {
    return jsonError('업로드된 녹화 파일을 찾을 수 없습니다. 녹화를 다시 업로드해주세요.', 409)
  }
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET status = 'available', storage_status = 'stored', size_bytes = ?,
            content_type = COALESCE(?, content_type),
            retention_until = COALESCE(retention_until, datetime('now', '+30 days')),
            stopped_at = COALESCE(stopped_at, datetime('now')), failure_reason = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL`
  )
    .bind(stored.size, stored.httpMetadata?.contentType, recording.id)
    .run()
  const updated = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
    .bind(recording.id)
    .first()
  return jsonResponse({ recording: serializeRecording(updated) })
}
