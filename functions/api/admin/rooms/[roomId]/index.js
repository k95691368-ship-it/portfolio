import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { logAdminAction } from '../../../../_lib/auditLog.js'

export async function onRequestDelete({ env, data, params }) {
  const room = await env.DB.prepare('SELECT id, title FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  // documents belong to the user, not the room (a candidate's resume can be shared
  // across rooms), so they're intentionally left untouched here.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM chat_messages WHERE room_id = ?').bind(params.roomId),
    env.DB.prepare('DELETE FROM signatures WHERE room_id = ?').bind(params.roomId),
    env.DB.prepare('DELETE FROM contract_terms WHERE room_id = ?').bind(params.roomId),
    env.DB.prepare('DELETE FROM room_participants WHERE room_id = ?').bind(params.roomId),
    env.DB.prepare('DELETE FROM interview_rooms WHERE id = ?').bind(params.roomId),
  ])

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'delete_room',
    detail: `title=${room.title}`,
  })

  return jsonResponse({ ok: true, deleted: true })
}
