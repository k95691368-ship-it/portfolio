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
  // Serialize recovery with deletion before minting any upload capability.
  // A late recovery must never recreate a key after its parent was removed.
  let claim
  try {
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE interview_rooms SET id = id WHERE id = ?').bind(params.roomId),
      env.DB.prepare(`UPDATE interview_recordings SET status = 'processing', stopped_at = COALESCE(stopped_at, datetime('now')),
        retention_until = COALESCE(retention_until, datetime('now', '+30 days'))
        WHERE id = ? AND session_id = ? AND created_by_user_id = ? AND r2_key = ? AND deleted_at IS NULL
          AND status NOT IN ('available', 'deleted')
          AND NOT EXISTS (
            SELECT 1 FROM interview_room_deletion_locks
            WHERE room_id = ? AND datetime(created_at) > datetime('now', '-10 minutes')
          )`)
        .bind(recording.id, params.sessionId, data.user.id, recording.r2_key, params.roomId),
    ])
    claim = results[1]
  } catch {
    return jsonError('녹화 복구 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', 503)
  }
  if (!claim.meta?.changes) return jsonError('면접방이 삭제 중이거나 녹화 상태가 변경되어 복구를 시작하지 않았습니다.', 409)
  let upload
  try {
    upload = await env.INTERVIEW_RECORDINGS.createSignedUploadUrl(recording.r2_key)
  } catch {
    // Keep processing: another previously issued upload may still be in flight.
    return jsonError('녹화 업로드 경로를 준비하지 못했습니다. 다시 시도해주세요.', 503)
  }
  return jsonResponse({ upload: { bucket: 'interview-recordings', path: upload.path, token: upload.token } })
}
