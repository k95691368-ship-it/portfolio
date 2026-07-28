import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'

// 채용 확정을 회사가 직접 처리한다.
//
// 지금까지 채용 확정은 AI 대화 분석으로만 가능했다. 그래서 면접을 오프라인으로
// 봤거나, 대화 표현이 애매하거나, AI 판단이 빗나가면 계약 절차 전체가 막혔다.
// 핵심 판단을 AI 하나에 의존시키지 않도록 담당자가 직접 확정할 수 있게 한다.
// (AI가 이미 확정한 건은 그대로 두고, 되돌리기는 제공하지 않는다)
export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('채용 확정은 회사(고용) 측만 할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (!candidate) return jsonError('지원자가 아직 면접방에 참여하지 않았습니다.', 409)

  // 이미 확정되어 있으면 그대로 둔다 (AI가 남긴 근거 인용을 덮어쓰지 않는다).
  const claim = await env.DB.prepare(
    `INSERT INTO contract_terms (room_id, hire_confirmed, hire_confirmed_at, hire_confirmation_excerpt)
     VALUES (?, 1, datetime('now'), ?)
     ON CONFLICT(room_id) DO UPDATE SET
       hire_confirmed = 1,
       hire_confirmed_at = COALESCE(contract_terms.hire_confirmed_at, datetime('now')),
       hire_confirmation_excerpt =
         COALESCE(contract_terms.hire_confirmation_excerpt, excluded.hire_confirmation_excerpt)
     WHERE contract_terms.hire_confirmed = 0`
  )
    .bind(params.roomId, `${data.user.display_name}님이 담당자 확인으로 채용을 확정했습니다.`)
    .run()

  if (claim.meta.changes === 0) {
    return jsonResponse({ ok: true, alreadyConfirmed: true })
  }

  if (room.status !== 'signed') {
    await env.DB.prepare("UPDATE interview_rooms SET status = 'contract_pending' WHERE id = ?")
      .bind(params.roomId)
      .run()
  }

  await notifyUser(env, candidate.user_id, {
    type: 'hire_confirmed',
    message: '채용이 확정되었습니다! 전자근로계약서를 확인하고 서명해주세요.',
    link: `/rooms/${params.roomId}/contract`,
  })

  return jsonResponse({ ok: true, alreadyConfirmed: false }, 201)
}
