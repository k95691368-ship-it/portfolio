import { jsonResponse, jsonError } from '../../_lib/http.js'
import { blockedWhenArchived } from '../../_lib/roomLifecycle.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { notifyUser } from '../../_lib/notify.js'

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (data.user.role !== 'candidate') return jsonError('구직자 계정만 참여할 수 있습니다.', 403)

  const allowed = await checkRateLimit(env, `join:${data.user.id}`, 30, 600)
  if (!allowed) return jsonError('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const body = await request.json().catch(() => null)
  const inviteCode = body?.inviteCode?.trim()?.toUpperCase()
  if (!inviteCode) return jsonError('초대코드를 입력해주세요.', 400)

  const room = await env.DB.prepare('SELECT * FROM interview_rooms WHERE invite_code = ?')
    .bind(inviteCode)
    .first()
  if (!room) return jsonError('유효하지 않은 초대코드입니다.', 404)

  // 대화할 수 없는 방에 사람을 앉히지 않는다.
  //
  // 초대 이메일은 막아 놓고 정작 그 이메일이 안내하는 문은 열려 있었다.
  // 들어가 봐야 "보관된 면접방입니다. 대화는 잠겨 있습니다"만 보이고, 그
  // 참여로 방의 status 가 open→active 로 바뀐다 — 지금 상태 그대로 잠근다는
  // 보관의 약속이 깨진다. 지원자 자리(UNIQUE)까지 소모된다.
  const archived = blockedWhenArchived(room, 'join')
  if (archived) return jsonError(archived, 409)

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

    await notifyUser(env, room.company_user_id, {
      type: 'room_join',
      message: `${data.user.display_name}님이 '${room.title}' 면접방에 참여했습니다.`,
      link: `/rooms/${room.id}`,
    })
  }

  return jsonResponse({ id: room.id, title: room.title })
}
