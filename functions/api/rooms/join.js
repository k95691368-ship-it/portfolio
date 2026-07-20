import { jsonResponse, jsonError } from '../../_lib/http.js'

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (data.user.role !== 'candidate') return jsonError('구직자 계정만 참여할 수 있습니다.', 403)

  const body = await request.json().catch(() => null)
  const inviteCode = body?.inviteCode?.trim()?.toUpperCase()
  if (!inviteCode) return jsonError('초대코드를 입력해주세요.', 400)

  const room = await env.DB.prepare('SELECT * FROM interview_rooms WHERE invite_code = ?')
    .bind(inviteCode)
    .first()
  if (!room) return jsonError('유효하지 않은 초대코드입니다.', 404)

  const alreadyJoined = await env.DB.prepare(
    'SELECT 1 FROM room_participants WHERE room_id = ? AND user_id = ?'
  )
    .bind(room.id, data.user.id)
    .first()

  if (!alreadyJoined) {
    const existingCandidate = await env.DB.prepare(
      "SELECT 1 FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
    )
      .bind(room.id)
      .first()
    if (existingCandidate) return jsonError('이미 다른 지원자가 참여한 면접방입니다.', 409)

    await env.DB.prepare(
      'INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, ?)'
    )
      .bind(room.id, data.user.id, 'candidate')
      .run()

    if (room.status === 'open') {
      await env.DB.prepare("UPDATE interview_rooms SET status = 'active' WHERE id = ?")
        .bind(room.id)
        .run()
    }
  }

  return jsonResponse({ id: room.id, title: room.title })
}
