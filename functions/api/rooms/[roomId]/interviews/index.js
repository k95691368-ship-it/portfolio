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
import {
  RealtimeKitApiError,
  RealtimeKitConfigError,
  createMeeting,
  deleteMeeting,
} from '../../../../_lib/realtimekit.js'

function accessError(error) {
  if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
  throw error
}

function providerError(error) {
  if (error instanceof RealtimeKitConfigError) {
    console.error('RealtimeKit configuration is incomplete:', error.missing.join(', '))
    return jsonError('화상 면접 서비스가 아직 설정되지 않았습니다.', 503)
  }
  if (error instanceof RealtimeKitApiError) {
    console.error(`RealtimeKit create meeting failed (status ${error.status})`)
    return jsonError('화상 면접방을 만들 수 없습니다. 잠시 후 다시 시도해주세요.', 502)
  }
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

export async function onRequestPost({ request, env, data, params }) {
  let access
  try {
    access = await getRoomForInterview(env, params.roomId, data.user, { allowAdminRead: false })
  } catch (error) {
    return accessError(error)
  }
  if (access.room.company_user_id !== data.user.id) {
    return jsonError('화상 면접은 이 면접방을 만든 회사 담당자만 만들 수 있습니다.', 403)
  }

  const frozen = blockedWhenFrozen(access.room, 'create_interview')
  if (frozen) return jsonError(frozen, 409)

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('요청 내용을 확인해주세요.', 400)

  let title
  let scheduledAt
  let key
  try {
    title = normalizeTitle(body.title, `${access.room.title} 화상 면접`)
    scheduledAt = normalizeScheduledAt(body.scheduledAt)
    key = idempotencyKey(request, body)
  } catch (error) {
    return jsonError(error.message, 400)
  }
  const recordingRequired = body.recordingRequired !== false

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

  let provider
  try {
    provider = await createMeeting(env, { title })
  } catch (error) {
    return providerError(error)
  }
  if (!provider?.id) {
    console.error('RealtimeKit create meeting response did not include an id')
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
          created_by_user_id, idempotency_key)
       SELECT ?, r.id, ?, ?, ?, ?, ?, ?
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
        await deleteMeeting(env, { meetingId: provider.id }).catch((cleanupError) => {
          console.error(`Orphan RealtimeKit meeting cleanup failed (${provider.id}):`, cleanupError)
        })
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
      await deleteMeeting(env, { meetingId: provider.id }).catch((cleanupError) => {
        console.error(`Orphan RealtimeKit meeting cleanup failed (${provider.id}):`, cleanupError)
      })
      const row = await loadSessionForUser(env, params.roomId, active.id, data.user.id)
      return jsonResponse(
        {
          error: '진행 중이거나 예정된 화상 면접이 이미 있습니다.',
          session: serializeSession(row),
        },
        409
      )
    }
    await deleteMeeting(env, { meetingId: provider.id }).catch((cleanupError) => {
      console.error(`Orphan RealtimeKit meeting cleanup failed (${provider.id}):`, cleanupError)
    })
    console.error(`Interview session insert failed (${sessionId}):`, error)
    return jsonError('화상 면접 기록을 저장하지 못했습니다.', 500)
  }

  const row = await loadSessionForUser(env, params.roomId, sessionId, data.user.id)
  return jsonResponse({ session: serializeSession(row) }, 201)
}
