import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess } from '../../../_lib/rooms.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomAccess(env, params.roomId, data.user)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const { results } = await env.DB.prepare(
    `SELECT h.id, h.changes, h.created_at, u.display_name AS editor_name, rp.role_in_room AS editor_role
     FROM contract_edit_history h
     JOIN users u ON u.id = h.editor_user_id
     LEFT JOIN room_participants rp ON rp.room_id = h.room_id AND rp.user_id = h.editor_user_id
     WHERE h.room_id = ?
     ORDER BY h.id DESC
     LIMIT 100`
  )
    .bind(params.roomId)
    .all()

  return jsonResponse({
    history: results.map((r) => ({
      id: r.id,
      editorName: r.editor_name,
      editorRole: r.editor_role,
      // 한 줄이 깨져 있다고 이력 전체를 못 보게 만들지 않는다.
      changes: (() => {
        try {
          return JSON.parse(r.changes)
        } catch {
          return []
        }
      })(),
      createdAt: r.created_at,
    })),
  })
}
