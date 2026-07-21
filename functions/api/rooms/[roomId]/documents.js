import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { mapDocumentRow } from '../../../_lib/documents.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  if (!candidate) return jsonResponse({ documents: [] })

  const { results } = await env.DB.prepare(
    'SELECT id, doc_type, filename, size_bytes, uploaded_at FROM documents WHERE user_id = ?'
  )
    .bind(candidate.user_id)
    .all()

  return jsonResponse({ documents: results.map(mapDocumentRow) })
}
