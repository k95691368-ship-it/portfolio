import { maskEmail, sendRoomInviteEmail, isEmailConfigured } from '../../../_lib/email.js'
import { jsonError, jsonResponse } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'

const SUBJECT_MAX_LENGTH = 150
const BODY_MAX_LENGTH = 5000

async function getCandidate(env, roomId) {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.display_name
     FROM room_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.room_id = ? AND rp.role_in_room = 'candidate'
     LIMIT 1`
  )
    .bind(roomId)
    .first()
}

async function requireCompanyParticipant(env, data, roomId) {
  if (!data.user) return { error: jsonError('로그인이 필요합니다.', 401) }
  const participant = await getRoomParticipant(env, roomId, data.user.id)
  if (!participant) return { error: jsonError('이 면접방에 참여하지 않았습니다.', 403) }
  if (participant.role_in_room !== 'company') {
    return { error: jsonError('회사 측만 초대 이메일을 보낼 수 있습니다.', 403) }
  }
  return { participant }
}

export async function onRequestGet({ env, data, params }) {
  const access = await requireCompanyParticipant(env, data, params.roomId)
  if (access.error) return access.error

  const candidate = await getCandidate(env, params.roomId)
  return jsonResponse({
    candidate: candidate
      ? { displayName: candidate.display_name, emailMasked: maskEmail(candidate.email) }
      : null,
    emailConfigured: isEmailConfigured(env),
  })
}

export async function onRequestPost({ request, env, data, params }) {
  const access = await requireCompanyParticipant(env, data, params.roomId)
  if (access.error) return access.error

  const body = await request.json().catch(() => null)
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const bodyText = typeof body?.bodyText === 'string' ? body.bodyText.trim() : ''

  if (!subject || !bodyText) return jsonError('제목과 내용을 모두 입력해주세요.', 400)
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return jsonError(`제목은 ${SUBJECT_MAX_LENGTH}자 이하로 입력해주세요.`, 400)
  }
  if (bodyText.length > BODY_MAX_LENGTH) {
    return jsonError(`내용은 ${BODY_MAX_LENGTH}자 이하로 입력해주세요.`, 400)
  }
  if (!isEmailConfigured(env)) {
    return jsonError('이메일 발송 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.', 503)
  }

  const candidate = await getCandidate(env, params.roomId)
  if (!candidate) return jsonError('초대할 지원자가 아직 면접방에 없습니다.', 409)

  const companyName = data.user.company_name || data.user.display_name
  try {
    await sendRoomInviteEmail(env, {
      to: candidate.email,
      subject,
      bodyText,
      companyName,
    })
  } catch (error) {
    const detail = String(error?.message || 'Unknown email error').slice(0, 500)
    console.error(`Room invite email failed for room ${params.roomId}:`, detail)
    return jsonError('이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.', 502)
  }

  await notifyUser(env, candidate.id, {
    type: 'room_invite',
    message: `${companyName}에서 면접방 참여를 요청했습니다.`,
    link: `/rooms/${params.roomId}`,
  })

  return jsonResponse({ ok: true, recipientEmailMasked: maskEmail(candidate.email) }, 201)
}
