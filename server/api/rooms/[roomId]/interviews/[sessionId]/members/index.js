import { jsonError, jsonResponse } from '../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  loadSessionForUser,
  loadSessionMembers,
  logInterviewEvent,
  serializeInterviewMember,
} from '../../../../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../../../../_lib/roomLifecycle.js'

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TypeError('추가할 회사 계정 이메일을 확인해주세요.')
  }
  return email
}

async function mutableSessionContext(env, data, params) {
  const access = await getInterviewSessionAccess(
    env,
    params.roomId,
    params.sessionId,
    data.user,
    { allowAdminRead: false }
  )
  const session = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!session) throw new InterviewAccessError('화상 면접을 찾을 수 없습니다.', 404)
  if (session.my_role !== 'host') {
    throw new InterviewAccessError('면접관 등록은 진행자만 할 수 있습니다.', 403)
  }
  const frozen = blockedWhenFrozen(access.room, 'edit_interview')
  if (frozen) throw new InterviewAccessError(frozen, 409)
  if (session.status === 'live' || ['ended', 'cancelled', 'failed'].includes(session.status)) {
    throw new InterviewAccessError('시작되었거나 종료된 화상 면접의 참가자는 바꿀 수 없습니다.', 409)
  }
  const admitted = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM interview_session_members
      WHERE session_id = ? AND (admitted_at IS NOT NULL OR joined_at IS NOT NULL)`
  )
    .bind(params.sessionId)
    .first()
  if (Number(admitted?.count) > 0) {
    throw new InterviewAccessError('참가자 입장이 시작된 뒤에는 면접관을 바꿀 수 없습니다.', 409)
  }
  return { access, session }
}

async function responseMembers(env, sessionId) {
  const members = await loadSessionMembers(env, sessionId)
  return jsonResponse({ members: members.map(serializeInterviewMember) })
}

export async function onRequestPost({ request, env, data, params }) {
  try {
    await mutableSessionContext(env, data, params)
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }
  const body = await request.json().catch(() => null)
  let email
  try {
    email = normalizeEmail(body?.email)
  } catch (error) {
    return jsonError(error.message, 400)
  }

  const target = await env.DB.prepare(
    `SELECT id, display_name, is_admin, is_suspended
       FROM users WHERE lower(email) = ? AND role = 'company'`
  )
    .bind(email)
    .first()
  if (!target || target.is_suspended || target.is_admin) {
    return jsonError('사용할 수 있는 회사 계정을 찾을 수 없습니다.', 404)
  }

  const existing = await env.DB.prepare(
    'SELECT role FROM interview_session_members WHERE session_id = ? AND user_id = ?'
  )
    .bind(params.sessionId, target.id)
    .first()
  if (existing) {
    if (existing.role === 'interviewer') return responseMembers(env, params.sessionId)
    return jsonError('진행자 또는 지원자의 역할은 변경할 수 없습니다.', 409)
  }

  await env.DB.prepare(
    `INSERT INTO interview_session_members
       (session_id, user_id, role, custom_participant_id)
     VALUES (?, ?, 'interviewer', ?)`
  )
    .bind(params.sessionId, target.id, crypto.randomUUID())
    .run()
  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: 'member.interviewerAdded',
    actorUserId: data.user.id,
    details: { userId: target.id },
  })
  return responseMembers(env, params.sessionId)
}

export async function onRequestDelete({ request, env, data, params }) {
  try {
    await mutableSessionContext(env, data, params)
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }
  const body = await request.json().catch(() => null)
  let targetUserId = String(body?.userId || '').trim()
  if (!targetUserId && body?.email) {
    let email
    try {
      email = normalizeEmail(body.email)
    } catch (error) {
      return jsonError(error.message, 400)
    }
    const target = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ? AND role = 'company'")
      .bind(email)
      .first()
    targetUserId = target?.id || ''
  }
  if (!targetUserId) return jsonError('제외할 면접관을 선택해주세요.', 400)

  const member = await env.DB.prepare(
    'SELECT role FROM interview_session_members WHERE session_id = ? AND user_id = ?'
  )
    .bind(params.sessionId, targetUserId)
    .first()
  if (!member) return jsonError('등록된 면접관을 찾을 수 없습니다.', 404)
  if (member.role !== 'interviewer') {
    return jsonError('진행자 또는 지원자는 면접관 목록에서 제외할 수 없습니다.', 409)
  }

  await env.DB.prepare(
    "DELETE FROM interview_session_members WHERE session_id = ? AND user_id = ? AND role = 'interviewer'"
  )
    .bind(params.sessionId, targetUserId)
    .run()
  await logInterviewEvent(env, {
    sessionId: params.sessionId,
    eventType: 'member.interviewerRemoved',
    actorUserId: data.user.id,
    details: { userId: targetUserId },
  })
  return responseMembers(env, params.sessionId)
}

export { normalizeEmail }
