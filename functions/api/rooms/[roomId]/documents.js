import { jsonResponse, jsonError } from '../../../_lib/http.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await env.DB.prepare(
    'SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?'
  )
    .bind(params.roomId, data.user.id)
    .first()
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

  return jsonResponse({
    documents: results.map((d) => ({
      id: d.id,
      docType: d.doc_type,
      filename: d.filename,
      sizeBytes: d.size_bytes,
      uploadedAt: d.uploaded_at,
    })),
  })
}
