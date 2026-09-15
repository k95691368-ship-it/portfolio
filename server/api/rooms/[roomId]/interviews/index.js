import { genId } from '../../../../_lib/db.js'
import { jsonError, jsonResponse } from '../../../../_lib/http.js'
import {
  InterviewAccessError,
  getRoomForInterview,
  loadSessionForUser,
  loadSessionsForUser,
  normalizeScheduledAt,
  normalizeTitle,
  roleFromRoomRole,
  serializeSession,
} from '../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../_lib/roomLifecycle.js'
import { createMeeting } from '../../../../_lib/supabaseRealtime.js'
import { withScheduleLock, getSelectableSlot, findScheduleConflict, normalizeDuration } from '../../../../_lib/interviewScheduling.js'

function accessError(error) {
  if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
  throw error
}

function idempotencyKey(request, body) {
  const value = String(request.headers.get('Idempotency-Key') || body?.clientRequestId || '').trim()
  if (!value) return null
  if (value.length > 128) throw new TypeError('요청 식별자가 너무 깁니다.')
  return value
}

export async function onRequestGet({ env, data, params }) {
  let access
  try {
    access = await getRoomForInterview(env, params.roomId, data.user)
  } catch (error) {
    return accessError(error)
  }

  const rows = await loadSessionsForUser(env, params.roomId, data.user.id)
  const sessions = rows.map((row) => {
    if (!row.my_role && access.videoRole) {
      row.my_role = access.videoRole
      row.viewer_user_id = data.user.id
    }
    return serializeSession(row)
  })
  return jsonResponse({ sessions, latestSession: sessions[0] ?? null })
}

export const onRequestPost = context => withScheduleLock(context, createInterview)

async function createInterview({ request, env, data, params, scheduleAccess: access }) {
  const body = await request.json().catch(() => null)
  const selectingSlot = typeof body?.slotId === 'string'
  if (access.room.company_user_id !== data.user.id && !(access.roomRole === 'candidate' && selectingSlot)) {
    return jsonError('화상 면접은 이 면접방을 만든 회사 담당자만 만들 수 있습니다.', 403)
  }

  const frozen = blockedWhenFrozen(access.room, 'create_interview')
  if (frozen) return jsonError(frozen, 409)

  if (!body || typeof body !== 'object') return jsonError('요청 내용을 확인해주세요.', 400)

  let title
  let scheduledAt
  let key
  let slot = null
  let duration
  try {
    key = idempotencyKey(request, body)
    if (key) {
      const existing = await env.DB.prepare('SELECT id FROM interview_sessions WHERE room_id = ? AND idempotency_key = ?').bind(params.roomId, key).first()
      if (existing) return jsonResponse({ session: serializeSession(await loadSessionForUser(env, params.roomId, existing.id, data.user.id)) })
    }
    if (selectingSlot) slot = await getSelectableSlot(env, access.room.company_user_id, body.slotId)
    title = normalizeTitle(body.title, `${access.room.title} 화상 면접`)
    if (access.roomRole === 'candidate') title = normalizeTitle(undefined, `${access.room.title} 화상 면접`)
    scheduledAt = slot?.starts_at ?? normalizeScheduledAt(body.scheduledAt)
    duration = slot?.duration_minutes ?? normalizeDuration(body.durationMinutes)
  } catch (error) {
    return jsonError(error.message, error.status ?? 400)
  }
  const recordingRequired = slot ? slot.recording_required === 1 : body.recordingRequired !== false

  const activeExisting = await env.DB.prepare(
    `SELECT id FROM interview_sessions
      WHERE room_id = ? AND status IN ('scheduled','waiting','live')
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(params.roomId)
    .first()
  if (activeExisting) {
    const row = await loadSessionForUser(
      env,
      params.roomId,
      activeExisting.id,
      data.user.id
    )
    return jsonResponse(
      {
        error: '진행 중이거나 예정된 화상 면접이 이미 있습니다.',
        session: serializeSession(row),
      },
      409
    )
  }

  if (await findScheduleConflict(env, access.room.company_user_id, scheduledAt, duration)) {
    return jsonError('담당자의 다른 면접 일정과 겹칩니다. 다른 시간을 선택해주세요.', 409)
  }
  const provider = await createMeeting(env, { title })
  if (!provider?.id) {
    console.error('Supabase interview meeting id was not created')
    return jsonError('화상 면접방을 만들 수 없습니다. 잠시 후 다시 시도해주세요.', 502)
  }

  const { results: roomMembers } = await env.DB.prepare(
    'SELECT user_id, role_in_room FROM room_participants WHERE room_id = ? ORDER BY joined_at ASC'
  )
    .bind(params.roomId)
    .all()
  const sessionId = genId()
  const statements = [
    env.DB.prepare(
      `INSERT INTO interview_sessions
         (id, room_id, provider_meeting_id, title, recording_required, scheduled_at,
          created_by_user_id, idempotency_key, booking_slot_id, duration_minutes)
       SELECT ?, r.id, ?, ?, ?, ?, ?, ?, ?, ?
         FROM interview_rooms r
        WHERE r.id = ? AND r.archived_at IS NULL AND r.status <> 'closed'
          AND NOT EXISTS (
            SELECT 1 FROM interview_room_deletion_locks deletion_lock
             WHERE deletion_lock.room_id = r.id
               AND datetime(deletion_lock.created_at) > datetime('now', '-10 minutes')
          )`
    ).bind(
      sessionId,
      provider.id,
      title,
      recordingRequired ? 1 : 0,
      scheduledAt,
      data.user.id,
      key,
      slot?.id ?? null,
      duration,
      params.roomId
    ),
  ]

  for (const roomMember of roomMembers || []) {
    const role =
      roomMember.user_id === access.room.company_user_id
        ? 'host'
        : roleFromRoomRole(roomMember.role_in_room) === 'host'
          ? 'interviewer'
          : roleFromRoomRole(roomMember.role_in_room)
    if (!role) continue
    statements.push(
      env.DB.prepare(
        `INSERT INTO interview_session_members
           (session_id, user_id, role, custom_participant_id)
         VALUES (?, ?, ?, ?)`
      ).bind(sessionId, roomMember.user_id, role, crypto.randomUUID())
    )
  }

  try {
    const saved = await env.DB.batch(statements)
    if (saved?.[0]?.meta?.changes === 0) {
      throw new Error('interview_room_locked_or_frozen')
    }
  } catch (error) {
    // 동일 idempotency 요청 두 개가 경합했으면 먼저 만들어진 세션을 돌려준다.
    if (key) {
      const existing = await env.DB.prepare(
        'SELECT id FROM interview_sessions WHERE room_id = ? AND idempotency_key = ?'
      )
        .bind(params.roomId, key)
        .first()
      if (existing) {
        const row = await loadSessionForUser(env, params.roomId, existing.id, data.user.id)
        return jsonResponse({ session: serializeSession(row) })
      }
    }
    const active = await env.DB.prepare(
      `SELECT id FROM interview_sessions
        WHERE room_id = ? AND status IN ('scheduled','waiting','live')
        ORDER BY created_at DESC LIMIT 1`
    )
      .bind(params.roomId)
      .first()
    if (active) {
      const row = await loadSessionForUser(env, params.roomId, active.id, data.user.id)
      return jsonResponse(
        {
          error: '진행 중이거나 예정된 화상 면접이 이미 있습니다.',
          session: serializeSession(row),
        },
        409
      )
    }
    console.error(`Interview session insert failed (${sessionId}):`, error)
    return jsonError('화상 면접 기록을 저장하지 못했습니다.', 500)
  }

  const row = await loadSessionForUser(env, params.roomId, sessionId, data.user.id)
  return jsonResponse({ session: serializeSession(row) }, 201)
}
