import { jsonResponse, jsonError } from '../../../_lib/http.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const room = await env.DB.prepare('SELECT * FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const participant = await env.DB.prepare(
    'SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?'
  )
    .bind(room.id, data.user.id)
    .first()
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const { results: participants } = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.company_name, rp.role_in_room
     FROM room_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.room_id = ?`
  )
    .bind(room.id)
    .all()

  return jsonResponse({
    id: room.id,
    title: room.title,
    inviteCode: room.invite_code,
    status: room.status,
    myRole: participant.role_in_room,
    participants: participants.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      companyName: p.company_name,
      role: p.role_in_room,
    })),
  })
}
