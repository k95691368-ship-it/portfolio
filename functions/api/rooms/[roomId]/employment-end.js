import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'
import { parseContractDate } from '../../../_lib/contractPeriod.js'

// 근로관계가 실제로 끝난 날을 기록한다.
//
// 근로기준법 제42조의 3년 보존 기간은 시행령 제22조 제2항에 따라 "근로관계가
// 끝난 날"부터 센다. 그 날짜를 담을 자리가 없으면 보존 기한을 계산할 수 없고,
// 계산할 수 없으면 지켜지는지 확인할 수도 없다.
//
// 이 값은 계약 조건이 아니다. 계약서에 적힌 약속을 고치는 것이 아니라 그
// 계약이 언제 끝났는지를 나중에 적는 것이므로, 서명을 무효화하지 않고 계약
// 조건 수정 이력에도 남기지 않는다. 대신 상대방에게 알린다.
const MAX_REASON = 200

export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('근로관계 종료 기록은 회사(고용) 측만 남길 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status !== 'signed') {
    return jsonError('체결이 완료된 계약에만 근로관계 종료를 기록할 수 있습니다.', 409)
  }

  const body = await request.json().catch(() => null)
  const ended = parseContractDate(body?.endedOn)
  if (!ended) {
    return jsonError('근로관계가 끝난 날을 YYYY-MM-DD 형식으로 입력해주세요.', 400)
  }

  const terms = await env.DB.prepare(
    'SELECT contract_start_date FROM contract_terms WHERE room_id = ?'
  )
    .bind(params.roomId)
    .first()
  const start = parseContractDate(terms?.contract_start_date)
  if (start && ended.getTime() < start.getTime()) {
    return jsonError('근로관계 종료일이 근로개시일보다 앞설 수 없습니다.', 400)
  }

  // 미래 날짜를 기산일로 쓰면 아직 오지 않은 날부터 보존 기간이 시작된 것처럼
  // 계산된다. 종료 "예정"은 계약 종료일이 이미 담고 있으므로, 여기에는 이미
  // 일어난 사실만 적는다.
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (ended.getTime() > todayUtc) {
    return jsonError('아직 오지 않은 날짜는 기록할 수 없습니다. 실제로 끝난 뒤에 기록해주세요.', 400)
  }

  const endedOn = ended.toISOString().slice(0, 10)
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : null

  await env.DB.prepare(
    `INSERT INTO contract_terms
       (room_id, employment_ended_at, employment_end_reason,
        employment_end_recorded_at, employment_end_recorded_by_user_id)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(room_id) DO UPDATE SET
       employment_ended_at = excluded.employment_ended_at,
       employment_end_reason = excluded.employment_end_reason,
       employment_end_recorded_at = datetime('now'),
       employment_end_recorded_by_user_id = excluded.employment_end_recorded_by_user_id,
       updated_at = datetime('now')`
  )
    .bind(params.roomId, endedOn, reason || null, data.user.id)
    .run()

  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (candidate) {
    await notifyUser(env, candidate.user_id, {
      type: 'employment_ended',
      message: `근로관계 종료가 ${endedOn}자로 기록되었습니다. 계약서는 근로기준법 제42조에 따라 그 날부터 3년간 보존됩니다.`,
      link: `/rooms/${params.roomId}/contract`,
    })
  }

  return jsonResponse({ ok: true, endedOn, reason: reason || null })
}

// 잘못 적은 날짜를 지운다. 지우면 다시 "재직 중"으로 돌아가 보존 의무가 계속된다.
export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('근로관계 종료 기록은 회사(고용) 측만 남길 수 있습니다.', 403)
  }

  await env.DB.prepare(
    `UPDATE contract_terms SET employment_ended_at = NULL, employment_end_reason = NULL,
       employment_end_recorded_at = NULL, employment_end_recorded_by_user_id = NULL,
       updated_at = datetime('now')
     WHERE room_id = ?`
  )
    .bind(params.roomId)
    .run()

  return jsonResponse({ ok: true })
}
