import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { getRoomParticipant } from '../../../../_lib/rooms.js'
import { EDITABLE_FIELDS } from '../../../../_lib/contract.js'
import { FIELD_LABELS } from '../../../../_lib/contractCheck.js'
import { notifyUser } from '../../../../_lib/notify.js'
import { revokeSignaturesOnChange } from '../../../../_lib/signatureLock.js'
import { blockedWhenClosed } from '../../../../_lib/roomLifecycle.js'
import {
  parseWageItemsJson,
  alignWageItemsWithBase,
} from '../../../../_lib/wageItems.js'

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
  // 종료된 전형에서는 수정 요청을 새로 보내는 것만 막고 있었다. 이미 쌓여 있던
  // 요청을 수락하면 조건이 바뀌고 서명이 무효화된다 — 끝난 전형에서.
  const closedError = blockedWhenClosed(room, 'respond_change_request')
  if (closedError) return jsonError(closedError, 409)

  const column = EDITABLE_FIELDS[req.field]
  if (action === 'accept' && !column) {
    return jsonError('더 이상 수정할 수 없는 항목입니다.', 400)
  }

  const label = FIELD_LABELS[req.field] || req.field

  // 기본급이 두 곳에 있다 — wage_base_amount 컬럼과 wageItems 의 base 항목.
  // 컬럼만 고치면 지원자가 요청해 회사가 수락한 인상이 최저임금·통상임금
  // 계산에는 전혀 반영되지 않는다. 항목을 쓰는 계약이면 함께 맞춘다.
  const existingTerms =
    action === 'accept' && req.field === 'wageBaseAmount'
      ? await env.DB.prepare('SELECT wage_items_json FROM contract_terms WHERE room_id = ?')
          .bind(params.roomId)
          .first()
      : null

  const statements = [
    env.DB.prepare(
      `UPDATE contract_change_requests
       SET status = ?, response_note = ?, responded_by_user_id = ?, resolved_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    ).bind(action === 'accept' ? 'accepted' : 'declined', note || null, data.user.id, params.reqId),
  ]

  let value = req.requested_value
  if (action === 'accept' && req.field === 'wageBaseAmount') {
    // 숫자 항목은 숫자로 저장해 이후 계산(최저임금 등)이 그대로 동작하게 한다.
    //
    // 수정 요청의 값은 자유 입력이라 "300만원", "2500000 이상" 같은 것이 들어온다.
    // 예전에는 이런 값이 `|| null`을 타고 기본급을 조용히 지워 버렸고, 지원자에게는
    // "수정 요청이 반영되었습니다" 알림이 갔다. 임금이 비어 있는 계약서가 되는
    // 것보다, 수락을 거절하고 무엇이 문제인지 알려 주는 편이 낫다.
    const parsed = Number(String(req.requested_value).replace(/[,\s원]/g, ''))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return jsonError(
        `요청된 기본급 "${req.requested_value}"을(를) 금액으로 읽을 수 없어 반영할 수 없습니다. 숫자만 적힌 값으로 다시 요청해 달라고 안내해주세요.`,
        400
      )
    }
    value = parsed
  }

  if (action === 'accept') {
    statements.push(
      env.DB.prepare(
        `INSERT INTO contract_terms (room_id, ${column}, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(room_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = datetime('now')`
      ).bind(params.roomId, value),
      // 양측이 합의한 변경임을 남긴다 — 서명 전 점검이 이를 불일치로 보지 않도록.
      env.DB.prepare(
        "INSERT INTO contract_edit_history (room_id, editor_user_id, changes, source) VALUES (?, ?, ?, 'change_request')"
      ).bind(
        params.roomId,
        data.user.id,
        JSON.stringify([{ field: req.field, from: req.current_value, to: value }])
      )
    )

    const items = parseWageItemsJson(existingTerms?.wage_items_json)
    if (items.length > 0) {
      statements.push(
        env.DB.prepare('UPDATE contract_terms SET wage_items_json = ? WHERE room_id = ?').bind(
          JSON.stringify(alignWageItemsWithBase(items, value)),
          params.roomId
        )
      )
    }
  }

  await env.DB.batch(statements)

  // 양측이 합의한 변경이라도 내용이 바뀐 것은 마찬가지다. 이미 받아 둔 서명은
  // 바뀌기 전 내용에 대한 것이므로 무효화하고 다시 받는다.
  const revocation =
    action === 'accept'
      ? await revokeSignaturesOnChange(env, params.roomId, {
          actorUserId: data.user.id,
          reason: `수정 요청 수락 (${label})`,
        })
      : { revoked: 0 }

  await notifyUser(env, req.requested_by_user_id, {
    type: 'change_request_result',
    message:
      action === 'accept'
        ? `'${label}' 수정 요청이 반영되었습니다. 계약서를 확인해주세요.`
        : `'${label}' 수정 요청이 반려되었습니다.${note ? ` (${note})` : ''}`,
    link: `/rooms/${params.roomId}/contract`,
  })

  return jsonResponse({
    ok: true,
    status: action === 'accept' ? 'accepted' : 'declined',
    revokedSignatures: revocation.revoked,
  })
}
