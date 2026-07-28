import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { genId } from '../../../_lib/db.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'

const MAX_DATA_URL_LENGTH = 2_000_000

export async function onRequestPost({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') return jsonError('이미 서명이 완료된 계약서입니다.', 409)

  const contract = await env.DB.prepare('SELECT hire_confirmed FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  if (!contract?.hire_confirmed) return jsonError('아직 채용이 확정되지 않아 서명할 수 없습니다.', 400)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

  const imageDataUrl = body.imageDataUrl
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    return jsonError('서명 이미지가 올바르지 않습니다.', 400)
  }
  if (imageDataUrl.length > MAX_DATA_URL_LENGTH) {
    return jsonError('서명 이미지 용량이 너무 큽니다.', 400)
  }

  // 서명이 이루어진 접속 환경을 함께 남긴다 (감사추적증명서의 증거 항목).
  const ip = request.headers.get('CF-Connecting-IP') || null
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 300) || null
  const country = request.headers.get('CF-IPCountry') || null

  await env.DB.prepare(
    `INSERT INTO signatures
       (id, room_id, signer_user_id, signer_role, image_data_url, signed_at,
        signer_ip, signer_user_agent, signer_country)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
     ON CONFLICT(room_id, signer_role) DO UPDATE SET
       signer_user_id = excluded.signer_user_id,
       image_data_url = excluded.image_data_url,
       signed_at = datetime('now'),
       signer_ip = excluded.signer_ip,
       signer_user_agent = excluded.signer_user_agent,
       signer_country = excluded.signer_country`
  )
    .bind(
      genId(),
      params.roomId,
      data.user.id,
      participant.role_in_room,
      imageDataUrl,
      ip,
      userAgent,
      country
    )
    .run()

  const { results: sigs } = await env.DB.prepare('SELECT signer_role FROM signatures WHERE room_id = ?')
    .bind(params.roomId)
    .all()

  const roles = new Set(sigs.map((s) => s.signer_role))
  const bothSigned = roles.has('company') && roles.has('candidate')

  if (bothSigned) {
    await env.DB.prepare("UPDATE interview_rooms SET status = 'signed' WHERE id = ?")
      .bind(params.roomId)
      .run()
  }

  // 상대방에게 알림 (모두 서명 완료 시에는 양측 모두)
  const { results: others } = await env.DB.prepare(
    'SELECT user_id FROM room_participants WHERE room_id = ? AND user_id != ?'
  )
    .bind(params.roomId, data.user.id)
    .all()
  for (const other of others) {
    await notifyUser(env, other.user_id, {
      type: bothSigned ? 'contract_signed' : 'signature',
      message: bothSigned
        ? '전자근로계약서 서명이 완료되었습니다. 계약서를 확인해보세요.'
        : `${data.user.display_name}님이 계약서에 서명했습니다. 내 서명을 진행해주세요.`,
      link: `/rooms/${params.roomId}/contract`,
    })
  }

  return jsonResponse({ ok: true, signerRole: participant.role_in_room, bothSigned })
}
