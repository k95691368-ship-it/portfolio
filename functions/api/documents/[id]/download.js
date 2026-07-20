import { jsonError } from '../../../_lib/http.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(params.id).first()
  if (!doc) return jsonError('파일을 찾을 수 없습니다.', 404)

  let allowed = doc.user_id === data.user.id
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
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.filename)}"`,
    },
  })
}
