import { genId } from '../../../_lib/db.js'
import { maskEmail, sendFinalOfferEmail, isEmailConfigured } from '../../../_lib/email.js'
import { jsonError, jsonResponse } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'

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

async function getDelivery(env, roomId) {
  return env.DB.prepare(
    `SELECT status, recipient_email, subject, attempt_count, sent_at, created_at, updated_at
     FROM final_offer_emails
     WHERE room_id = ?`
  )
    .bind(roomId)
    .first()
}

function deliveryResponse(row) {
  if (!row) return null
  return {
    status: row.status,
    recipientEmailMasked: maskEmail(row.recipient_email),
    subject: row.subject,
    attemptCount: row.attempt_count,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function requireCompanyParticipant(env, data, roomId) {
  if (!data.user) return { error: jsonError('로그인이 필요합니다.', 401) }
  const participant = await getRoomParticipant(env, roomId, data.user.id)
  if (!participant) return { error: jsonError('이 면접방에 참여하지 않았습니다.', 403) }
  if (participant.role_in_room !== 'company') {
    return { error: jsonError('회사 측만 최종합격 이메일을 보낼 수 있습니다.', 403) }
  }
  return { participant }
}

export async function onRequestGet({ env, data, params }) {
  const access = await requireCompanyParticipant(env, data, params.roomId)
  if (access.error) return access.error

  const [candidate, delivery] = await Promise.all([
    getCandidate(env, params.roomId),
    getDelivery(env, params.roomId),
  ])

  return jsonResponse({
    candidate: candidate
      ? {
          displayName: candidate.display_name,
          emailMasked: maskEmail(candidate.email),
        }
      : null,
    delivery: deliveryResponse(delivery),
  })
}

export async function onRequestPost({ request, env, data, params }) {
  const access = await requireCompanyParticipant(env, data, params.roomId)
  if (access.error) return access.error

  const body = await request.json().catch(() => null)
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  const bodyText = typeof body?.bodyText === 'string' ? body.bodyText.trim() : ''

  if (!subject || !bodyText) return jsonError('제목과 이메일 내용을 모두 입력해주세요.', 400)
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return jsonError(`제목은 ${SUBJECT_MAX_LENGTH}자 이하로 입력해주세요.`, 400)
  }
  if (bodyText.length > BODY_MAX_LENGTH) {
    return jsonError(`이메일 내용은 ${BODY_MAX_LENGTH}자 이하로 입력해주세요.`, 400)
  }
  if (!isEmailConfigured(env)) {
    return jsonError('이메일 발송 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.', 503)
  }

  const [room, candidate] = await Promise.all([
    env.DB.prepare('SELECT id, title FROM interview_rooms WHERE id = ?').bind(params.roomId).first(),
    getCandidate(env, params.roomId),
  ])
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (!candidate) return jsonError('최종합격 이메일을 받을 지원자가 아직 참여하지 않았습니다.', 409)

  const companyName = data.user.company_name || data.user.display_name
  const claim = await env.DB.prepare(
    `INSERT INTO final_offer_emails (
       id, room_id, sent_by_user_id, recipient_email, subject, body_text, status
     ) VALUES (?, ?, ?, ?, ?, ?, 'sending')
     ON CONFLICT(room_id) DO UPDATE SET
       sent_by_user_id=excluded.sent_by_user_id,
       recipient_email=excluded.recipient_email,
       subject=excluded.subject,
       body_text=excluded.body_text,
       status='sending',
       attempt_count=final_offer_emails.attempt_count + 1,
       error_message=NULL,
       updated_at=datetime('now')
     WHERE final_offer_emails.status = 'failed'`
  )
    .bind(genId(), params.roomId, data.user.id, candidate.email, subject, bodyText)
    .run()

  if (claim.meta.changes === 0) {
    const existing = await getDelivery(env, params.roomId)
    if (existing?.status === 'sent') {
      return jsonError('최종합격 이메일은 이미 발송되었습니다.', 409)
    }
    return jsonError('최종합격 이메일 발송이 이미 진행 중입니다.', 409)
  }

  try {
    await sendFinalOfferEmail(env, {
      to: candidate.email,
      subject,
      bodyText,
      companyName,
    })

    await env.DB.prepare(
      `UPDATE final_offer_emails
       SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now'), error_message = NULL
       WHERE room_id = ?`
    )
      .bind(params.roomId)
      .run()
  } catch (error) {
    const detail = String(error?.message || 'Unknown email error').slice(0, 500)
    console.error(`Final offer email failed for room ${params.roomId}:`, detail)
    await env.DB.prepare(
      `UPDATE final_offer_emails
       SET status = 'failed', error_message = ?, updated_at = datetime('now')
       WHERE room_id = ?`
    )
      .bind(detail, params.roomId)
      .run()
    return jsonError('이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.', 502)
  }

  const delivery = await getDelivery(env, params.roomId)
  return jsonResponse({ ok: true, delivery: deliveryResponse(delivery) }, 201)
}
