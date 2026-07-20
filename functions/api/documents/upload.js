import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'

const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'hwp', 'hwpx']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (data.user.role !== 'candidate') return jsonError('구직자 계정만 업로드할 수 있습니다.', 403)

  const form = await request.formData().catch(() => null)
  if (!form) return jsonError('잘못된 요청입니다.', 400)

  const file = form.get('file')
  const docType = form.get('docType')
  if (!file || typeof file === 'string') return jsonError('파일을 선택해주세요.', 400)
  if (!['resume', 'cover_letter'].includes(docType)) {
    return jsonError('문서 종류가 올바르지 않습니다.', 400)
  }
  if (file.size > MAX_SIZE) return jsonError('파일 크기는 10MB 이하만 가능합니다.', 400)

  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) {
    return jsonError('PDF, DOC, DOCX, HWP 파일만 업로드할 수 있습니다.', 400)
  }

  const existing = await env.DB.prepare(
    'SELECT id, r2_key FROM documents WHERE user_id = ? AND doc_type = ?'
  )
    .bind(data.user.id, docType)
    .first()
  if (existing) {
    await env.DOCUMENTS.delete(existing.r2_key)
    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(existing.id).run()
  }

  const id = genId()
  const r2Key = `documents/${data.user.id}/${docType}-${Date.now()}.${ext}`
  const contentType = file.type || 'application/octet-stream'

  await env.DOCUMENTS.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
  })

  await env.DB.prepare(
    `INSERT INTO documents (id, user_id, doc_type, filename, r2_key, size_bytes, content_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, data.user.id, docType, file.name, r2Key, file.size, contentType)
    .run()

  return jsonResponse({ id, docType, filename: file.name, sizeBytes: file.size }, 201)
}
