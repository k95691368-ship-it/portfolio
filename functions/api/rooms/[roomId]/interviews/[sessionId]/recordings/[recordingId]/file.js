import {
  FILE_CACHE_HEADERS,
  contentDisposition,
  jsonError,
} from '../../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  clientAddress,
  clientUserAgent,
  getInterviewSessionAccess,
  loadSessionForUser,
  retentionHasExpired,
} from '../../../../../../../_lib/interviews.js'

function safeFilename(value, fallback) {
  const name = String(value || fallback).replace(/[\r\n/\\]/g, '_').trim()
  return name || fallback
}

function parseRange(value, size) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return { invalid: true }

  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true }
    end = Math.min(end, size - 1)
  }
  if (start < 0 || start >= size || end < start) return { invalid: true }
  return { start, end, length: end - start + 1 }
}

async function logAccess(env, request, recordingId, userId, action, outcome, detail = null) {
  await env.DB.prepare(
    `INSERT INTO recording_access_logs
       (id, recording_id, user_id, action, outcome, ip_address, user_agent, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      recordingId,
      userId,
      action,
      outcome,
      clientAddress(request),
      clientUserAgent(request),
      detail
    )
    .run()
    .catch((error) => console.error(`Recording access log failed (${recordingId}):`, error))
}

export async function onRequestGet({ request, env, data, params }) {
  try {
    await getInterviewSessionAccess(
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
  if (!session.my_role) return jsonError('이 화상 면접의 참가자가 아닙니다.', 403)

  const recording = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE id = ? AND session_id = ? AND deleted_at IS NULL`
  )
    .bind(params.recordingId, params.sessionId)
    .first()
  if (!recording) return jsonError('녹화 기록을 찾을 수 없습니다.', 404)

  const wantsDownload = new URL(request.url).searchParams.get('download') === '1'
  const action = wantsDownload ? 'download' : 'view'
  if (retentionHasExpired(recording.retention_until)) {
    if (recording.r2_key) {
      if (!env.INTERVIEW_RECORDINGS) {
        await logAccess(env, request, recording.id, data.user.id, action, 'failed', 'binding_missing')
        return jsonError('만료된 녹화 파일을 삭제할 수 없어 접근을 차단했습니다.', 503)
      }
      try {
        await env.INTERVIEW_RECORDINGS.delete(recording.r2_key)
      } catch (error) {
        console.error(`Expired recording delete failed (${recording.id}):`, error)
        await logAccess(env, request, recording.id, data.user.id, action, 'failed', 'expiry_delete_failed')
        return jsonError('만료된 녹화 파일 삭제를 완료하지 못했습니다.', 503)
      }
    }
    await env.DB.prepare(
      `UPDATE interview_recordings
          SET status = 'deleted', storage_status = 'deleted', r2_key = NULL,
              deleted_at = COALESCE(deleted_at, datetime('now')), updated_at = datetime('now')
        WHERE id = ?`
    )
      .bind(recording.id)
      .run()
    await logAccess(env, request, recording.id, data.user.id, action, 'denied', 'retention_expired')
    return jsonError('보존 기간이 끝나 녹화 파일이 삭제되었습니다.', 410)
  }
  if (recording.status !== 'available' || recording.storage_status !== 'stored' || !recording.r2_key) {
    await logAccess(env, request, recording.id, data.user.id, action, 'denied', 'not_available')
    return jsonError('녹화 파일을 아직 사용할 수 없습니다.', 409)
  }
  if (!env.INTERVIEW_RECORDINGS) {
    await logAccess(env, request, recording.id, data.user.id, action, 'failed', 'binding_missing')
    return jsonError('녹화 보관소가 설정되지 않았습니다.', 503)
  }

  const head = await env.INTERVIEW_RECORDINGS.head(recording.r2_key)
  if (!head) {
    await logAccess(env, request, recording.id, data.user.id, action, 'failed', 'object_missing')
    return jsonError('녹화 파일을 찾을 수 없습니다.', 404)
  }

  const range = parseRange(request.headers.get('Range'), head.size)
  if (range?.invalid) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${head.size}`, ...FILE_CACHE_HEADERS },
    })
  }
  const object = await env.INTERVIEW_RECORDINGS.get(
    recording.r2_key,
    range ? { range: { offset: range.start, length: range.length } } : undefined
  )
  if (!object) {
    await logAccess(env, request, recording.id, data.user.id, action, 'failed', 'object_missing')
    return jsonError('녹화 파일을 찾을 수 없습니다.', 404)
  }

  await logAccess(env, request, recording.id, data.user.id, action, 'allowed')
  const filename = safeFilename(recording.filename, `${recording.id}.mp4`)
  const headers = {
    'Content-Type': recording.content_type || 'video/mp4',
    'Content-Disposition': contentDisposition(filename, wantsDownload ? 'attachment' : 'inline'),
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range ? range.length : head.size),
    ...FILE_CACHE_HEADERS,
  }
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${head.size}`
  return new Response(object.body, { status: range ? 206 : 200, headers })
}

export { parseRange }
