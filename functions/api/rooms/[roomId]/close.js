import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'
import { canClose, normalizeCloseReason, isClosed } from '../../../_lib/roomLifecycle.js'

// 전형을 종료한다.
//
// 지금까지는 끝난 전형을 끝났다고 표시할 방법이 없어서, 다른 사람을 뽑아
// 종료된 자리가 지원자의 대시보드에 "진행중"으로 남아 있었다. 지원자는 아직
// 검토 중이라고 믿고 기다린다.
//
// 종료해도 기록은 그대로 둔다. 대화·계약 조건·이력은 모두 볼 수 있고, 막는 것은
// 계약을 앞으로 진행하는 행동뿐이다. 전형이 끝났다고 무슨 일이 있었는지 확인할
// 길까지 없애면 나중에 다툼이 생겼을 때 아무것도 남지 않는다.
export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('전형 종료는 회사(고용) 측만 할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT id, title, status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  const allowed = canClose(room)
  if (!allowed.ok) return jsonError(allowed.error, room ? 409 : 404)

  const body = await request.json().catch(() => null)
  const reason = normalizeCloseReason(body?.reason, body?.note)

  // 그 사이에 서명이 끝났으면 닫지 않는다.
  const claimed = await env.DB.prepare(
    `UPDATE interview_rooms
        SET status = 'closed', closed_at = datetime('now'), close_reason = ?
      WHERE id = ? AND status IN ('open', 'active', 'contract_pending')`
  )
    .bind(reason.text, params.roomId)
    .run()

  if (claimed.meta.changes === 0) {
    return jsonError('그 사이에 상태가 바뀌었습니다. 화면을 새로 고쳐 확인해주세요.', 409)
  }

  // 채용절차법 제10조는 구직자에게 채용 여부를 알리도록 한다. 상태만 바꾸고
  // 알리지 않으면 지원자는 여전히 기다린다.
  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (candidate) {
    await notifyUser(env, candidate.user_id, {
      type: 'room_closed',
      message: `"${room.title}" 전형이 종료되었습니다. 사유: ${reason.text}`,
      link: `/rooms/${params.roomId}`,
    })
  }

  return jsonResponse({ ok: true, status: 'closed', reason: reason.text })
}

// 잘못 닫았을 때 되돌린다.
export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('전형 종료는 회사(고용) 측만 할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT id, title, status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (!isClosed(room)) return jsonError('종료되지 않은 전형입니다.', 409)

  // 어느 상태로 되돌릴지는 채용이 확정돼 있었는지로 정한다.
  //
  // 예전에는 contract_terms 행이 있는지만 보았다. 그런데 'AI로 조건 정리'는
  // 쿨다운을 선점하려고 빈 행을 먼저 만든다. 그래서 조건을 한 번 정리해 본
  // 적만 있어도 — 합의된 것이 하나도 없어도 — 종료를 취소하면 방이
  // contract_pending 이 되고 지원자에게 '계약서를 확인하고 서명해주세요'가
  // 뜬다. 서명할 계약서가 없는데.
  const terms = await env.DB.prepare(
    'SELECT hire_confirmed FROM contract_terms WHERE room_id = ?'
  )
    .bind(params.roomId)
    .first()
  const restored = terms?.hire_confirmed ? 'contract_pending' : 'active'

  await env.DB.prepare(
    "UPDATE interview_rooms SET status = ?, closed_at = NULL, close_reason = NULL WHERE id = ?"
  )
    .bind(restored, params.roomId)
    .run()

  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (candidate) {
    await notifyUser(env, candidate.user_id, {
      type: 'room_reopened',
      message: `"${room.title}" 전형이 다시 진행됩니다.`,
      link: `/rooms/${params.roomId}`,
    })
  }

  return jsonResponse({ ok: true, status: restored })
}
