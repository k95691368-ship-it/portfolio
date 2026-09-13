import { jsonError, jsonResponse } from '../../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getRoomForInterview,
  loadSessionForUser,
  logInterviewEvent,
  serializeRecording,
} from '../../../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../../../_lib/roomLifecycle.js'

const ACTIONS = new Set(['pause', 'resume', 'stop', 'abort'])
const ALLOWED_FROM = {
  abort: new Set(['starting', 'recording']),
  pause: new Set(['recording']),
  resume: new Set(['paused']),
  stop: new Set(['starting', 'recording', 'paused', 'stopping']),
}
const ALREADY_DONE = {
  abort: new Set(['failed']),
  pause: new Set(['paused']),
  resume: new Set(['recording']),
  stop: new Set(['processing', 'available', 'failed', 'deleted']),
}

export async function onRequestPut({ request, env, data, params }) {
  let access
  try {
    access = await getRoomForInterview(env, params.roomId, data.user, { allowAdminRead: false })
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }
  const session = await loadSessionForUser(env, params.roomId, params.sessionId, data.user.id)
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  if (session.my_role !== 'host') return jsonError('녹화 제어는 진행자만 할 수 있습니다.', 403)

  const body = await request.json().catch(() => null)
  const action = body?.action
  if (!ACTIONS.has(action)) return jsonError('녹화 제어 동작을 확인해주세요.', 400)

  const frozen = blockedWhenFrozen(access.room, 'start_recording')
  if (frozen && !['stop', 'abort'].includes(action)) return jsonError(frozen, 409)

  const recording = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE id = ? AND session_id = ? AND deleted_at IS NULL`
  )
    .bind(params.recordingId, params.sessionId)
    .first()
  if (!recording) return jsonError('녹화 기록을 찾을 수 없습니다.', 404)
  if (action === 'abort' && (recording.created_by_user_id !== data.user.id || recording.storage_status !== 'pending')) {
    return jsonError('본인이 시작하지 못한 녹화만 취소할 수 있습니다.', 403)
  }
  if (ALREADY_DONE[action].has(recording.status)) {
    return jsonResponse({ recording: serializeRecording(recording), idempotent: true })
  }
  if (!ALLOWED_FROM[action].has(recording.status)) {
    return jsonError('현재 녹화 상태에서는 이 동작을 할 수 없습니다.', 409)
  }

  const nextStatus = { pause: 'paused', resume: 'recording', stop: 'processing', abort: 'failed' }[action]
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET status = ?, stopped_at = CASE WHEN ? = 'stop' THEN datetime('now') ELSE stopped_at END,
            updated_at = datetime('now')
      WHERE id = ?`
  )
    .bind(nextStatus, action, recording.id)
    .run()

  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: `recording.${action}`,
    actorUserId: data.user.id,
    details: { recordingId: recording.id },
  })
  const updated = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
    .bind(recording.id)
    .first()
  return jsonResponse({ recording: serializeRecording(updated) })
}
