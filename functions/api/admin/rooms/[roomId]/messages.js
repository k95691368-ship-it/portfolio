import { jsonResponse, jsonError } from '../../../../_lib/http.js'

export async function onRequestGet({ env, params }) {
  const room = await env.DB.prepare('SELECT id, title, status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.sender_user_id, m.body, m.created_at, u.display_name AS sender_name, rp.role_in_room
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_user_id
     LEFT JOIN room_participants rp ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
     WHERE m.room_id = ?
     ORDER BY m.id ASC`
  )
    .bind(params.roomId)
    .all()

  return jsonResponse({
    room: { id: room.id, title: room.title, status: room.status },
    messages: results.map((m) => ({
      id: m.id,
      senderId: m.sender_user_id,
      senderName: m.sender_name,
      role: m.role_in_room,
      body: m.body,
      createdAt: m.created_at,
    })),
  })
}
