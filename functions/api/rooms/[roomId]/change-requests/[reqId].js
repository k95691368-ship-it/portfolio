import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { getRoomParticipant } from '../../../../_lib/rooms.js'
import { EDITABLE_FIELDS } from '../../../../_lib/contract.js'
import { FIELD_LABELS } from '../../../../_lib/contractCheck.js'
import { notifyUser } from '../../../../_lib/notify.js'

const NOTE_MAX = 500

// 응답: 회사만. 수락하면 계약서에 실제로 반영되고 수정 이력에도 남는다.
export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('수정 요청에는 회사(고용) 측만 응답할 수 있습니다.', 403)
  }

  const body = await request.json().catch(() => null)
  const action = body?.action
  const note = (body?.note ?? '').toString().trim().slice(0, NOTE_MAX)
  if (!['accept', 'decline'].includes(action)) {
    return jsonError('수락 또는 거절만 선택할 수 있습니다.', 400)
  }

  const req = await env.DB.prepare(
    'SELECT * FROM contract_change_requests WHERE id = ? AND room_id = ?'
  )
    .bind(params.reqId, params.roomId)
    .first()
  if (!req) return jsonError('수정 요청을 찾을 수 없습니다.', 404)
  if (req.status !== 'pending') return jsonError('이미 처리된 요청입니다.', 409)

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (room?.status === 'signed') {
    return jsonError('이미 서명이 완료된 계약서는 변경할 수 없습니다.', 409)
  }

  const column = EDITABLE_FIELDS[req.field]
  if (action === 'accept' && !column) {
    return jsonError('더 이상 수정할 수 없는 항목입니다.', 400)
  }

  const label = FIELD_LABELS[req.field] || req.field
  const statements = [
    env.DB.prepare(
      `UPDATE contract_change_requests
       SET status = ?, response_note = ?, responded_by_user_id = ?, resolved_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    ).bind(action === 'accept' ? 'accepted' : 'declined', note || null, data.user.id, params.reqId),
  ]

  if (action === 'accept') {
    // 숫자 항목은 숫자로 저장해 이후 계산(최저임금 등)이 그대로 동작하게 한다.
    const value =
      req.field === 'wageBaseAmount'
        ? Number(String(req.requested_value).replace(/[,\s원]/g, '')) || null
        : req.requested_value

    statements.push(
      env.DB.prepare(
        `INSERT INTO contract_terms (room_id, ${column}, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(room_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = datetime('now')`
      ).bind(params.roomId, value),
      env.DB.prepare(
        'INSERT INTO contract_edit_history (room_id, editor_user_id, changes) VALUES (?, ?, ?)'
      ).bind(
        params.roomId,
        data.user.id,
        JSON.stringify([{ field: req.field, from: req.current_value, to: value }])
      )
    )
  }

  await env.DB.batch(statements)

  await notifyUser(env, req.requested_by_user_id, {
    type: 'change_request_result',
    message:
      action === 'accept'
        ? `'${label}' 수정 요청이 반영되었습니다. 계약서를 확인해주세요.`
        : `'${label}' 수정 요청이 반려되었습니다.${note ? ` (${note})` : ''}`,
    link: `/rooms/${params.roomId}/contract`,
  })

  return jsonResponse({ ok: true, status: action === 'accept' ? 'accepted' : 'declined' })
}
