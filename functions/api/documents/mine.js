import { jsonResponse, jsonError } from '../../_lib/http.js'

export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const { results } = await env.DB.prepare(
    'SELECT id, doc_type, filename, size_bytes, uploaded_at FROM documents WHERE user_id = ? ORDER BY doc_type'
  )
    .bind(data.user.id)
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
