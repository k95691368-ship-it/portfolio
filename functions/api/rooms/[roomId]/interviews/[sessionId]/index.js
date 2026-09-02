import { jsonError, jsonResponse } from '../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  getRoomForInterview,
  loadSessionForUser,
  loadSessionMembers,
  loadSessionRecordings,
  logInterviewEvent,
  normalizeScheduledAt,
  normalizeTitle,
  serializeSession,
} from '../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../_lib/roomLifecycle.js'
import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  deleteMeeting,
  isRealtimeKitAlreadyEnded,
  kickAllParticipants,
} from '../../../../../_lib/realtimekit.js'

async function loadPayload(env, roomId, sessionId, userId, fallbackRole = null) {
  const row = await loadSessionForUser(env, roomId, sessionId, userId)
  if (!row) return null
  if (!row.my_role && fallbackRole) {
    row.my_role = fallbackRole
    row.viewer_user_id = userId
  }
  const [members, recordings] = await Promise.all([
    loadSessionMembers(env, sessionId),
    loadSessionRecordings(env, sessionId),
  ])
  return serializeSession(row, { members, recordings })
}

export async function onRequestGet({ env, data, params }) {
  let access
  try {
    access = await getInterviewSessionAccess(
      env,
      params.roomId,
      params.sessionId,
      data.user
    )
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }

  const session = await loadPayload(
    env,
    params.roomId,
    params.sessionId,
    data.user.id,
    access.videoRole
  )
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  return jsonResponse({ session })
}

export async function onRequestPatch({ request, env, data, params }) {
  let access
  try {
    access = await getRoomForInterview(env, params.roomId, data.user, { allowAdminRead: false })
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }

  const current = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!current) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  if (current.my_role !== 'host') {
    return jsonError('화상 면접 일정은 진행자만 변경할 수 있습니다.', 403)
  }
  const frozen = blockedWhenFrozen(access.room, 'edit_interview')
  if (frozen) return jsonError(frozen, 409)
  if (['ended', 'cancelled', 'failed'].includes(current.status)) {
    return jsonError('종료되었거나 취소된 화상 면접은 변경할 수 없습니다.', 409)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('요청 내용을 확인해주세요.', 400)
  if (Object.hasOwn(body, 'recordingRequired')) {
    return jsonError(
      '녹화 필수 여부는 화상 면접을 만들 때 확정되며 기존 일정에서는 변경할 수 없습니다.',
      409
    )
  }

  const setters = []
  const values = []
  try {
    if (Object.hasOwn(body, 'title')) {
      setters.push('title = ?')
      values.push(normalizeTitle(body.title))
    }
    if (Object.hasOwn(body, 'scheduledAt')) {
      setters.push('scheduled_at = ?')
      values.push(normalizeScheduledAt(body.scheduledAt))
    }
  } catch (error) {
    return jsonError(error.message, 400)
  }

  if (Object.hasOwn(body, 'status')) {
    if (body.status !== 'cancelled') {
      return jsonError('이 경로에서는 화상 면접 취소만 요청할 수 있습니다.', 400)
    }
    if (!['scheduled', 'waiting'].includes(current.status)) {
      return jsonError('이미 시작된 화상 면접은 일정 취소로 종료할 수 없습니다.', 409)
    }
    const activeRecording = await env.DB.prepare(
      `SELECT id FROM interview_recordings
        WHERE session_id = ? AND status IN ('starting','recording','paused','stopping')
        LIMIT 1`
    )
      .bind(params.sessionId)
      .first()
    if (activeRecording) {
      return jsonError(
        '진행 중인 녹화가 있어 일정 취소를 할 수 없습니다. 녹화를 먼저 중지해주세요.',
        409
      )
    }
    const providerCloseErrors = []
    try {
      await kickAllParticipants(env, { meetingId: current.provider_meeting_id })
    } catch (error) {
      if (!isRealtimeKitAlreadyEnded(error)) providerCloseErrors.push(error)
    }
    try {
      // 현재 연결을 먼저 끝내고, 이미 발급된 참가 토큰으로 공급자 회의를
      // 다시 열 수도 없게 한 뒤에만 로컬 일정을 취소 상태로 바꾼다.
      await deleteMeeting(env, { meetingId: current.provider_meeting_id })
    } catch (error) {
      if (!isRealtimeKitAlreadyEnded(error)) providerCloseErrors.push(error)
    }
    if (providerCloseErrors.length) {
      if (providerCloseErrors.some((error) => error instanceof RealtimeKitConfigError)) {
        return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
      }
      const apiError = providerCloseErrors.find((error) => error instanceof RealtimeKitApiError)
      if (apiError) {
        console.error(`RealtimeKit meeting cancellation failed (status ${apiError.status})`)
        return jsonError('화상 면접 연결을 종료하지 못해 일정을 취소하지 않았습니다.', 502)
      }
      throw providerCloseErrors[0]
    }
    setters.push("status = 'cancelled'")
    setters.push("ended_at = datetime('now')")
  }

  if (setters.length === 0) return jsonError('변경할 항목이 없습니다.', 400)
  setters.push("updated_at = datetime('now')")
  await env.DB.prepare(
    `UPDATE interview_sessions SET ${setters.join(', ')} WHERE id = ? AND room_id = ?`
  )
    .bind(...values, params.sessionId, params.roomId)
    .run()

  if (body.status === 'cancelled') {
    await logInterviewEvent(env, {
      sessionId: params.sessionId,
      eventType: 'meeting.cancelled',
      actorUserId: data.user.id,
    })
  }

  const session = await loadPayload(
    env,
    params.roomId,
    params.sessionId,
    data.user.id,
    access.videoRole
  )
  return jsonResponse({ session })
}
