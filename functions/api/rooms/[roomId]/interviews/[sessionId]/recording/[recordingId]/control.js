import { jsonError, jsonResponse } from '../../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getRoomForInterview,
  loadSessionForUser,
  logInterviewEvent,
  normalizeProviderRecording,
  serializeRecording,
} from '../../../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../../../_lib/roomLifecycle.js'
import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  controlRecording,
} from '../../../../../../../_lib/realtimekit.js'

const ACTIONS = new Set(['pause', 'resume', 'stop'])
const ALLOWED_FROM = {
  pause: new Set(['recording']),
  resume: new Set(['paused']),
  stop: new Set(['starting', 'recording', 'paused', 'stopping']),
}
const ALREADY_DONE = {
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
  const session = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  if (session.my_role !== 'host') return jsonError('녹화 제어는 진행자만 할 수 있습니다.', 403)

  const body = await request.json().catch(() => null)
  const action = body?.action
  if (!ACTIONS.has(action)) return jsonError('녹화 제어 동작을 확인해주세요.', 400)

  // 방이 그 사이 종료·보관됐더라도 이미 도는 녹화를 멈출 길은 열어 둔다.
  const frozen = blockedWhenFrozen(access.room, 'start_recording')
  if (frozen && action !== 'stop') return jsonError(frozen, 409)

  const recording = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE id = ? AND session_id = ? AND deleted_at IS NULL`
  )
    .bind(params.recordingId, params.sessionId)
    .first()
  if (!recording) return jsonError('녹화 기록을 찾을 수 없습니다.', 404)
  if (ALREADY_DONE[action].has(recording.status)) {
    return jsonResponse({ recording: serializeRecording(recording), idempotent: true })
  }
  if (!ALLOWED_FROM[action].has(recording.status)) {
    return jsonError('현재 녹화 상태에서는 이 동작을 할 수 없습니다.', 409)
  }
  if (!recording.provider_recording_id) {
    return jsonError('녹화 준비가 끝나지 않았습니다. 잠시 후 다시 시도해주세요.', 409)
  }

  let provider
  try {
    provider = normalizeProviderRecording(
      await controlRecording(env, {
        recordingId: recording.provider_recording_id,
        action,
      })
    )
  } catch (error) {
    if (error instanceof RealtimeKitConfigError) {
      console.error('RealtimeKit configuration is incomplete:', error.missing.join(', '))
      return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
    }
    if (error instanceof RealtimeKitApiError) {
      console.error(`RealtimeKit recording control failed (${action}, status ${error.status})`)
      return jsonError('녹화 상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.', 502)
    }
    throw error
  }

  const fallbackStatus = { pause: 'paused', resume: 'recording', stop: 'processing' }[action]
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET status = ?, provider_session_id = COALESCE(?, provider_session_id),
            provider_download_url = COALESCE(?, provider_download_url),
            provider_download_url_expires_at = COALESCE(?, provider_download_url_expires_at),
            size_bytes = COALESCE(?, size_bytes),
            duration_seconds = COALESCE(?, duration_seconds),
            filename = COALESCE(?, filename),
            started_at = COALESCE(?, started_at), stopped_at = COALESCE(?, stopped_at),
            updated_at = datetime('now')
      WHERE id = ?`
  )
    .bind(
      provider?.status || fallbackStatus,
      provider?.providerSessionId,
      provider?.downloadUrl,
      provider?.downloadUrlExpiresAt,
      provider?.sizeBytes,
      provider?.durationSeconds,
      provider?.filename,
      provider?.startedAt,
      provider?.stoppedAt,
      recording.id
    )
    .run()

  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: `recording.${action}Requested`,
    actorUserId: data.user.id,
    details: { recordingId: recording.id },
  })
  const updated = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
    .bind(recording.id)
    .first()
  return jsonResponse({ recording: serializeRecording(updated) })
}
