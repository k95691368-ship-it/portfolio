import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant, loadCompanyMessages } from '../../../_lib/rooms.js'
import { logLifecycle } from '../../../_lib/roomLifecycleLog.js'
import { canArchive, canUnarchive, ROOM_SIGNED } from '../../../_lib/roomLifecycle.js'
import { describeOfferStatus } from '../../../_lib/jobOffer.js'
import { notifyUser } from '../../../_lib/notify.js'

// 면접방을 보관한다 — 지금 상태 그대로 잠근다.
//
// 대화도 계약 조건 수정도 서명도 계약서 파일 저장도 막힌다. 읽기와 이미
// 저장된 파일의 내려받기는 그대로 둔다. 보관은 없애는 것이 아니라 굳히는
// 것이고, 무슨 일이 있었는지 확인할 길까지 없애면 보관의 뜻이 사라진다.
export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('보관은 회사(고용) 측만 할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare(
    'SELECT id, title, status, archived_at FROM interview_rooms WHERE id = ?'
  )
    .bind(params.roomId)
    .first()
  const allowed = canArchive(room)
  if (!allowed.ok) return jsonError(allowed.error, room ? 409 : 404)

  const body = await request.json().catch(() => null)

  // 보관은 서명을 막는다. 그래서 아직 서명하지 않은 채용내정 위에서 누르면,
  // 그것은 정리가 아니라 지원자가 받아야 할 계약서를 잠그는 일이 된다.
  //
  // 채용내정 통지로 근로계약은 이미 성립한 것으로 다뤄진다. 그 상태에서 계약을
  // 마무리하지 못하게 막는 것은 실질적으로 내정 취소와 같은 자리에 선다.
  // 막지는 않되, 종료할 때와 같은 절차를 밟게 한다 — 무엇을 하는 것인지
  // 모른 채 누르는 일이 없도록.
  if (room.status !== ROOM_SIGNED) {
    const [termsRow, companyMessages] = await Promise.all([
      env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(params.roomId).first(),
      loadCompanyMessages(env, params.roomId),
    ])
    const offer = describeOfferStatus({ terms: termsRow, messages: companyMessages })
    if (offer.established && body?.acknowledgedDismissal !== true) {
      return jsonResponse(
        {
          error:
            '채용이 확정된 전형입니다. 지금 보관하면 지원자는 계약서에 서명할 수 없게 됩니다. 아래 내용을 확인한 뒤 다시 진행해주세요.',
          requiresAcknowledgement: true,
          offer,
        },
        409
      )
    }
  }

  // 그 사이 다른 사람이 먼저 보관했으면 두 번 적지 않는다.
  const claimed = await env.DB.prepare(
    `UPDATE interview_rooms
        SET archived_at = datetime('now'), archived_by_name = ?
      WHERE id = ? AND archived_at IS NULL`
  )
    .bind(data.user.display_name ?? null, params.roomId)
    .run()
  if (claimed.meta.changes === 0) {
    return jsonError('그 사이 상태가 바뀌었습니다. 화면을 새로 고쳐 확인해주세요.', 409)
  }

  await logLifecycle(env, params.roomId, {
    action: 'archived',
    actorName: data.user.display_name,
    detail: null,
  })

  // 대화가 막히는 것은 상대에게도 일어나는 일이다. 알리지 않으면 지원자는
  // 메시지를 보내려다 거절당하고 나서야 안다.
  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (candidate) {
    await notifyUser(env, candidate.user_id, {
      type: 'room_archived',
      message: `"${room.title}" 면접방이 보관되었습니다. 기록은 그대로 볼 수 있지만 대화와 계약서 수정은 잠깁니다.`,
      link: `/rooms/${params.roomId}`,
    })
  }

  return jsonResponse({ ok: true, archived: true })
}

// 보관을 해제한다.
//
// 잠그는 기능에는 푸는 길이 함께 있어야 한다. 잘못 눌렀거나 다시 이야기할
// 일이 생겼는데 되돌릴 수 없으면, 그 방은 새로 만드는 수밖에 없고 그러면
// 지금까지의 기록이 끊긴다. 다만 잠갔다 풀었다는 사실은 이력에 남는다.
export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('보관 해제는 회사(고용) 측만 할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare(
    'SELECT id, title, status, archived_at FROM interview_rooms WHERE id = ?'
  )
    .bind(params.roomId)
    .first()
  const allowed = canUnarchive(room)
  if (!allowed.ok) return jsonError(allowed.error, room ? 409 : 404)

  const claimed = await env.DB.prepare(
    `UPDATE interview_rooms
        SET archived_at = NULL, archived_by_name = NULL
      WHERE id = ? AND archived_at IS NOT NULL`
  )
    .bind(params.roomId)
    .run()
  if (claimed.meta.changes === 0) {
    return jsonError('그 사이 상태가 바뀌었습니다. 화면을 새로 고쳐 확인해주세요.', 409)
  }

  await logLifecycle(env, params.roomId, {
    action: 'unarchived',
    actorName: data.user.display_name,
    detail: null,
  })

  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (candidate) {
    await notifyUser(env, candidate.user_id, {
      type: 'room_unarchived',
      message: `"${room.title}" 면접방의 보관이 해제되었습니다. 다시 대화할 수 있습니다.`,
      link: `/rooms/${params.roomId}`,
    })
  }

  return jsonResponse({ ok: true, archived: false })
}
