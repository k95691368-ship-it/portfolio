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
    try {
      await env.DB.prepare(
        'INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, ?)'
      )
        .bind(room.id, data.user.id, 'candidate')
        .run()
    } catch (err) {
      if (!String(err?.message || err).includes('UNIQUE')) throw err
      // A concurrent request either already seated this same user, or another
      // candidate won the single-candidate-per-room slot first.
      const nowJoined = await env.DB.prepare(
        'SELECT 1 FROM room_participants WHERE room_id = ? AND user_id = ?'
      )
        .bind(room.id, data.user.id)
        .first()
      if (!nowJoined) return jsonError('이미 다른 지원자가 참여한 면접방입니다.', 409)
    }

    if (room.status === 'open') {
      await env.DB.prepare("UPDATE interview_rooms SET status = 'active' WHERE id = ?")
        .bind(room.id)
        .run()
    }
  }

  return jsonResponse({ id: room.id, title: room.title })
}
