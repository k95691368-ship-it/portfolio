import { jsonResponse, jsonError } from '../../../../_lib/http.js'

// 열람용 상한. 대화가 길어지면 응답과 화면이 함께 무거워지므로 최근 것부터
// 이만큼만 싣는다. 참여자용 채팅 조회도 한 번에 200건씩 받아 간다.
const MAX_MESSAGES = 300

export async function onRequestGet({ env, params }) {
  const room = await env.DB.prepare('SELECT id, title, status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  // 최근 것부터 잘라 낸 뒤 시간순으로 되돌려, 대화의 끝(가장 최근)이 잘리지 않게 한다.
  const { results } = await env.DB.prepare(
    `SELECT * FROM (
       SELECT m.id, m.sender_user_id, m.body, m.created_at, u.display_name AS sender_name, rp.role_in_room
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_user_id
       LEFT JOIN room_participants rp ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
       WHERE m.room_id = ?
       ORDER BY m.id DESC
       LIMIT ?
     ) ORDER BY id ASC`
  )
    .bind(params.roomId, MAX_MESSAGES)
    .all()

  return jsonResponse({
    room: { id: room.id, title: room.title, status: room.status },
    truncated: results.length >= MAX_MESSAGES,
    limit: MAX_MESSAGES,
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
