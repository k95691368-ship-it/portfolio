import { jsonError, jsonResponse } from '../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  loadSessionForUser,
  loadSessionMembers,
  loadSessionRecordings,
  logInterviewEvent,
  normalizeScheduledAt,
  normalizeTitle,
  serializeSession,
} from '../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../_lib/roomLifecycle.js'
import { withScheduleLock, getSelectableSlot, findScheduleConflict, normalizeDuration } from '../../../../../_lib/interviewScheduling.js'
import {
  VideoServiceError,
  VideoServiceConfigError,
  closeMeeting,
  isMeetingAlreadyEnded,
  kickAllParticipants,
} from '../../../../../_lib/supabaseRealtime.js'

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

export const onRequestPatch = context => withScheduleLock(context, changeInterview)

async function changeInterview({ request, env, data, params, scheduleAccess: access }) {
  const current = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!current) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  const body = await request.json().catch(() => null)
  const candidateBooking = current.my_role === 'candidate' && current.booking_slot_id
  if (current.my_role !== 'host' && !candidateBooking) {
    return jsonError('화상 면접 일정은 진행자만 변경할 수 있습니다.', 403)
  }
  const frozen = blockedWhenFrozen(access.room, 'edit_interview')
  if (frozen) return jsonError(frozen, 409)
  if (['ended', 'cancelled', 'failed'].includes(current.status)) {
    return jsonError('종료되었거나 취소된 화상 면접은 변경할 수 없습니다.', 409)
  }

  if (!body || typeof body !== 'object') return jsonError('요청 내용을 확인해주세요.', 400)
  if (body.status && (Object.hasOwn(body, 'slotId') || Object.hasOwn(body, 'scheduledAt') || Object.hasOwn(body, 'durationMinutes'))) return jsonError('시간 변경과 취소는 각각 요청해주세요.', 400)
  if (candidateBooking && Object.keys(body).some(key => !['slotId', 'status'].includes(key))) {
    return jsonError('지원자는 시간 선택 또는 예약 취소만 할 수 있습니다.', 403)
  }
  const rescheduling = Object.hasOwn(body, 'slotId') || Object.hasOwn(body, 'scheduledAt') || Object.hasOwn(body, 'durationMinutes')
  if (rescheduling || candidateBooking) {
    const admitted = await env.DB.prepare('SELECT user_id FROM interview_session_members WHERE session_id = ? AND (admitted_at IS NOT NULL OR joined_at IS NOT NULL) LIMIT 1').bind(params.sessionId).first()
    if (!['scheduled', 'waiting'].includes(current.status) || admitted) return jsonError('참가자 입장이 시작된 면접은 예약을 변경할 수 없습니다.', 409)
  }
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
    if (rescheduling) {
      const slot = Object.hasOwn(body, 'slotId') ? await getSelectableSlot(env, access.room.company_user_id, body.slotId, current.id) : null
      if (slot && slot.recording_required !== current.recording_required) return jsonError('녹화 조건이 같은 시간을 선택해주세요. 조건을 바꾸려면 기존 예약을 취소해주세요.', 409)
      const at = slot?.starts_at ?? (Object.hasOwn(body, 'scheduledAt') ? normalizeScheduledAt(body.scheduledAt) : current.scheduled_at)
      const duration = slot?.duration_minutes ?? normalizeDuration(body.durationMinutes ?? current.duration_minutes ?? 30)
      if (await findScheduleConflict(env, access.room.company_user_id, at, duration, current.id)) return jsonError('담당자의 다른 면접 일정과 겹칩니다.', 409)
      setters.push('scheduled_at = ?', 'booking_slot_id = ?', 'duration_minutes = ?')
      values.push(at, slot?.id ?? null, duration)
    }
  } catch (error) {
    return jsonError(error.message, error.status ?? 400)
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
      if (!isMeetingAlreadyEnded(error)) providerCloseErrors.push(error)
    }
    try {
      // 현재 연결을 먼저 끝내고, 이미 발급된 참가 토큰으로 공급자 회의를
      // 다시 열 수도 없게 한 뒤에만 로컬 일정을 취소 상태로 바꾼다.
      await closeMeeting(env, { meetingId: current.provider_meeting_id })
    } catch (error) {
      if (!isMeetingAlreadyEnded(error)) providerCloseErrors.push(error)
    }
    if (providerCloseErrors.length) {
      if (providerCloseErrors.some((error) => error instanceof VideoServiceConfigError)) {
        return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
      }
      const apiError = providerCloseErrors.find((error) => error instanceof VideoServiceError)
      if (apiError) {
        console.error(`Supabase realtime meeting cancellation failed (status ${apiError.status})`)
        return jsonError('화상 면접 연결을 종료하지 못해 일정을 취소하지 않았습니다.', 502)
      }
      throw providerCloseErrors[0]
    }
    setters.push("status = 'cancelled'")
    setters.push("ended_at = datetime('now')")
  }

  if (setters.length === 0) return jsonError('변경할 항목이 없습니다.', 400)
  setters.push("updated_at = datetime('now')")
  const saved = await env.DB.prepare(
    `UPDATE interview_sessions SET ${setters.join(', ')} WHERE id = ? AND room_id = ?
      ${rescheduling ? `AND status IN ('scheduled','waiting') AND NOT EXISTS (
        SELECT 1 FROM interview_session_members WHERE session_id = interview_sessions.id AND (admitted_at IS NOT NULL OR joined_at IS NOT NULL))` : ''}`
  )
    .bind(...values, params.sessionId, params.roomId)
    .run()
  if (saved.meta?.changes === 0) return jsonError('면접 상태가 변경되었습니다. 새로고침해주세요.', 409)

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
