import { jsonResponse, jsonError } from '../../../_lib/http.js'

async function requireParticipant(env, roomId, userId) {
  return env.DB.prepare('SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first()
}

export async function onRequestGet({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await requireParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const url = new URL(request.url)
  const after = Number(url.searchParams.get('after') || 0)

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.sender_user_id, m.body, m.created_at, u.display_name AS sender_name
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_user_id
     WHERE m.room_id = ? AND m.id > ?
     ORDER BY m.id ASC
     LIMIT 200`
  )
    .bind(params.roomId, after)
    .all()

  return jsonResponse({
    messages: results.map((m) => ({
      id: m.id,
      senderId: m.sender_user_id,
      senderName: m.sender_name,
      body: m.body,
      createdAt: m.created_at,
    })),
  })
}

export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await requireParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const body = await request.json().catch(() => null)
  const text = body?.body?.trim()
  if (!text) return jsonError('메시지 내용을 입력해주세요.', 400)
  if (text.length > 2000) return jsonError('메시지가 너무 깁니다.', 400)

  const result = await env.DB.prepare(
    'INSERT INTO chat_messages (room_id, sender_user_id, body) VALUES (?, ?, ?) RETURNING id, created_at'
  )
    .bind(params.roomId, data.user.id, text)
    .first()

  return jsonResponse(
    {
      id: result.id,
      senderId: data.user.id,
      senderName: data.user.display_name,
      body: text,
      createdAt: result.created_at,
    },
    201
  )
}
