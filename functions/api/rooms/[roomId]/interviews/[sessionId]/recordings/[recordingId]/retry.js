import { jsonError, jsonResponse } from '../../../../../../../_lib/http.js'
import { adoptDirectRecordingFromR2 } from '../../../../../../../_lib/interviewRecordings.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  loadSessionForUser,
  normalizeProviderRecording,
  retentionHasExpired,
  serializeRecording,
} from '../../../../../../../_lib/interviews.js'
import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  getRecording,
} from '../../../../../../../_lib/realtimekit.js'

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
  const session = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  if (access.videoRole !== 'host' || session.my_role !== 'host') {
    return jsonError('녹화 보관 재시도는 진행자만 할 수 있습니다.', 403)
  }

  let recording = await env.DB.prepare(
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
  const adopted = await adoptDirectRecordingFromR2(env, recording)
  if (adopted) {
    const stored = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
      .bind(recording.id)
      .first()
    return jsonResponse({ recording: serializeRecording(stored), direct: true })
  }
  if (!['processing', 'available'].includes(recording.status)) {
    return jsonError('업로드가 끝난 녹화만 다시 보관할 수 있습니다.', 409)
  }
  if (!recording.provider_recording_id) {
    return jsonError('공급자 녹화 식별자가 없어 다시 보관할 수 없습니다.', 409)
  }

  let provider
  try {
    provider = normalizeProviderRecording(
      await getRecording(env, { recordingId: recording.provider_recording_id })
    )
  } catch (error) {
    if (error instanceof RealtimeKitConfigError) {
      return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
    }
    if (error instanceof RealtimeKitApiError) {
      console.error(`RealtimeKit recording refresh failed (status ${error.status})`)
      return jsonError('녹화 정보를 갱신하지 못했습니다.', 502)
    }
    throw error
  }
  if (provider?.status !== 'available') {
    return jsonError('공급자에서 녹화 파일 처리가 아직 끝나지 않았습니다.', 409)
  }
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET provider_download_url = NULL, provider_download_url_expires_at = NULL,
            provider_session_id = COALESCE(?, provider_session_id),
            size_bytes = COALESCE(?, size_bytes), filename = COALESCE(?, filename),
            stopped_at = COALESCE(?, stopped_at), updated_at = datetime('now')
      WHERE id = ?`
  )
    .bind(
      provider.providerSessionId,
      provider.sizeBytes,
      provider.filename,
      provider.stoppedAt,
      recording.id
    )
    .run()
  recording = {
    ...recording,
    provider_download_url: null,
    provider_download_url_expires_at: null,
    provider_session_id: provider.providerSessionId || recording.provider_session_id,
    size_bytes: provider.sizeBytes ?? recording.size_bytes,
    filename: provider.filename || recording.filename,
    stopped_at: provider.stoppedAt || recording.stopped_at,
  }
  const refreshedDirect = await adoptDirectRecordingFromR2(env, recording)
  if (refreshedDirect) {
    const stored = await env.DB.prepare('SELECT * FROM interview_recordings WHERE id = ?')
      .bind(recording.id)
      .first()
    return jsonResponse({ recording: serializeRecording(stored), direct: true })
  }
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET storage_status = 'copy_failed', status = 'processing',
            failure_reason = 'recording_object_not_found', updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL`
  )
    .bind(recording.id)
    .run()
  return jsonError(
    'R2에서 직접 업로드된 녹화 파일을 아직 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.',
    409
  )
}
