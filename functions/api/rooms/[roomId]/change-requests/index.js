import { genId } from '../../../../_lib/db.js'
import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { blockedWhenClosed } from '../../../../_lib/roomLifecycle.js'
import { getRoomParticipant, getRoomAccess } from '../../../../_lib/rooms.js'
import { EDITABLE_FIELDS } from '../../../../_lib/contract.js'
import { FIELD_LABELS } from '../../../../_lib/contractCheck.js'
import { checkRateLimit } from '../../../../_lib/rateLimit.js'
import { notifyUser } from '../../../../_lib/notify.js'
import { mapRequestRow } from '../../../../_lib/changeRequests.js'

const VALUE_MAX = 500
const REASON_MAX = 500

// 목록: 참여자 양측과 관리자가 볼 수 있다.
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const access = await getRoomAccess(env, params.roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const { results } = await env.DB.prepare(
    `SELECT c.*, u.display_name AS requester_name
     FROM contract_change_requests c
     JOIN users u ON u.id = c.requested_by_user_id
     WHERE c.room_id = ? ORDER BY c.id DESC LIMIT 50`
  )
    .bind(params.roomId)
    .all()

  return jsonResponse({ requests: results.map(mapRequestRow) })
}

// 생성: 지원자만. 회사는 계약서를 직접 고칠 수 있으므로 요청할 필요가 없다.
export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'candidate') {
    return jsonError('수정 요청은 지원자만 보낼 수 있습니다. 회사 측은 계약서를 직접 수정하세요.', 403)
  }

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') {
    return jsonError('이미 서명이 완료된 계약서는 수정을 요청할 수 없습니다.', 409)
  }
  const closedBlock = blockedWhenClosed(room, 'change_request')
  if (closedBlock) return jsonError(closedBlock, 409)


  const allowed = await checkRateLimit(env, `change-req:${data.user.id}`, 10, 600)
  if (!allowed) return jsonError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const body = await request.json().catch(() => null)
  const field = body?.field
  const requestedValue = (body?.requestedValue ?? '').toString().trim().slice(0, VALUE_MAX)
  const reason = (body?.reason ?? '').toString().trim().slice(0, REASON_MAX)

  if (!field || !EDITABLE_FIELDS[field]) return jsonError('수정을 요청할 수 없는 항목입니다.', 400)
  if (!requestedValue) return jsonError('요청할 값을 입력해주세요.', 400)

  const column = EDITABLE_FIELDS[field]
  const terms = await env.DB.prepare(`SELECT ${column} AS value FROM contract_terms WHERE room_id = ?`)
    .bind(params.roomId)
    .first()
  const currentValue = terms?.value ?? null

  // 같은 항목에 대한 대기 중인 요청이 이미 있으면 중복 생성하지 않는다.
  const pending = await env.DB.prepare(
    "SELECT id FROM contract_change_requests WHERE room_id = ? AND field = ? AND status = 'pending'"
  )
    .bind(params.roomId, field)
    .first()
  if (pending) return jsonError('이 항목은 이미 수정 요청이 접수되어 검토 중입니다.', 409)

  const id = genId()
  await env.DB.prepare(
    `INSERT INTO contract_change_requests
       (id, room_id, requested_by_user_id, field, current_value, requested_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      params.roomId,
      data.user.id,
      field,
      currentValue === null ? null : String(currentValue),
      requestedValue,
      reason || null
    )
    .run()

  const company = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'company'"
  )
    .bind(params.roomId)
    .first()
  await notifyUser(env, company?.user_id, {
    type: 'change_request',
    message: `${data.user.display_name}님이 '${FIELD_LABELS[field] || field}' 조건 수정을 요청했습니다.`,
    link: `/rooms/${params.roomId}/contract`,
  })

  return jsonResponse({ ok: true, id }, 201)
}
