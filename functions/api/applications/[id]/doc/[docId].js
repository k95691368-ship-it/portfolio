import { jsonError } from '../../../../_lib/http.js'
import { requireManageableApplication } from '../../../../_lib/applications.js'

// 관리: 지원서 첨부파일(이력서/포트폴리오) 다운로드.
export async function onRequestGet({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error

  const doc = await env.DB.prepare(
    `SELECT filename, r2_key, content_type FROM application_documents
     WHERE id = ? AND application_id = ?`
  )
    .bind(params.docId, params.id)
    .first()
  if (!doc) return jsonError('파일을 찾을 수 없습니다.', 404)

  const object = await env.DOCUMENTS.get(doc.r2_key)
  if (!object) return jsonError('파일을 찾을 수 없습니다.', 404)

  return new Response(object.body, {
    headers: {
      'Content-Type': doc.content_type,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
