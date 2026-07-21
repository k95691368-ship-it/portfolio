import { jsonResponse, jsonError } from '../../_lib/http.js'
import { mapDocumentRow } from '../../_lib/documents.js'

export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const { results } = await env.DB.prepare(
    'SELECT id, doc_type, filename, size_bytes, uploaded_at FROM documents WHERE user_id = ? ORDER BY doc_type'
  )
    .bind(data.user.id)
    .all()

  return jsonResponse({ documents: results.map(mapDocumentRow) })
}
