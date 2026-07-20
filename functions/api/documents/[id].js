import { jsonResponse, jsonError } from '../../_lib/http.js'

export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(params.id).first()
  if (!doc) return jsonError('문서를 찾을 수 없습니다.', 404)
  if (doc.user_id !== data.user.id) return jsonError('권한이 없습니다.', 403)

  await env.DOCUMENTS.delete(doc.r2_key)
  await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(doc.id).run()

  return jsonResponse({ ok: true })
}
