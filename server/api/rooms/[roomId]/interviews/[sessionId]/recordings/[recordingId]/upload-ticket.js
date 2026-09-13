import { jsonResponse, jsonError } from '../../../../../../../_lib/http.js'
import { getInterviewSessionAccess, InterviewAccessError, retentionHasExpired } from '../../../../../../../_lib/interviews.js'

export async function onRequestPost({ env, data, params }) {
  try {
    const access = await getInterviewSessionAccess(env, params.roomId, params.sessionId, data.user, { allowAdminRead: false })
    if (access.videoRole !== 'host') return jsonError('진행자만 녹화를 복구할 수 있습니다.', 403)
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }
  const recording = await env.DB.prepare(`SELECT * FROM interview_recordings
    WHERE id = ? AND session_id = ? AND created_by_user_id = ? AND deleted_at IS NULL`)
    .bind(params.recordingId, params.sessionId, data.user.id).first()
  if (!recording || !recording.r2_key) return jsonError('복구할 녹화가 없습니다.', 404)
  const started = Date.parse(recording.started_at)
  const deadline = recording.retention_until || (Number.isFinite(started) ? new Date(started + 30 * 86400000).toISOString() : null)
  if (!deadline || ['available', 'deleted'].includes(recording.status) || retentionHasExpired(deadline)) return jsonError('완료되었거나 보관 기간을 확인할 수 없는 녹화입니다.', 409)
  const upload = await env.INTERVIEW_RECORDINGS.createSignedUploadUrl(recording.r2_key)
  await env.DB.prepare(`UPDATE interview_recordings SET status = 'processing', stopped_at = COALESCE(stopped_at, datetime('now')),
    retention_until = COALESCE(retention_until, datetime('now', '+30 days')) WHERE id = ?`).bind(recording.id).run()
  return jsonResponse({ upload: { bucket: 'interview-recordings', path: upload.path, token: upload.token } })
}
