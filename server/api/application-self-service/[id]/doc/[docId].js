import { jsonError, contentDisposition, FILE_CACHE_HEADERS } from '../../../../_lib/http.js'
import { requireApplicationAccess } from '../../../../_lib/applicationAccess.js'

export async function onRequestGet(context) {
  const access = await requireApplicationAccess(context, context.params.id)
  if (access.error) return access.error
  const doc = await context.env.DB.prepare(`SELECT filename, r2_key, content_type FROM application_documents
    WHERE id = ? AND application_id = ? AND superseded_at IS NULL`).bind(context.params.docId, context.params.id).first()
  if (!doc) return jsonError('파일을 찾을 수 없습니다.', 404)
  const object = await context.env.DOCUMENTS.get(doc.r2_key)
  if (!object) return jsonError('파일을 찾을 수 없습니다.', 404)
  return new Response(object.body, { headers: { 'Content-Type': doc.content_type,
    'Content-Disposition': contentDisposition(doc.filename), ...FILE_CACHE_HEADERS } })
}
