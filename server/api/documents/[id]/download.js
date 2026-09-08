import { jsonError, contentDisposition, FILE_CACHE_HEADERS } from '../../../_lib/http.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(params.id).first()
  if (!doc) return jsonError('파일을 찾을 수 없습니다.', 404)

  // 소유자 또는 관리자는 항상 허용, 그 외에는 같은 면접방을 공유하는 경우에만 허용.
  let allowed = doc.user_id === data.user.id || !!data.user.is_admin
  if (!allowed) {
    const shared = await env.DB.prepare(
      `SELECT 1 FROM room_participants rp1
       JOIN room_participants rp2 ON rp1.room_id = rp2.room_id
       WHERE rp1.user_id = ? AND rp2.user_id = ?`
    )
      .bind(data.user.id, doc.user_id)
      .first()
    allowed = !!shared
  }
  if (!allowed) return jsonError('권한이 없습니다.', 403)

  const object = await env.DOCUMENTS.get(doc.r2_key)
  if (!object) return jsonError('파일을 찾을 수 없습니다.', 404)

  return new Response(object.body, {
    headers: {
      'Content-Type': doc.content_type,
      'Content-Disposition': contentDisposition(doc.filename),
      ...FILE_CACHE_HEADERS,
    },
  })
}
