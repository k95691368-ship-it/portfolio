import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'
import { validateFileContent } from '../../_lib/uploads.js'

const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'hwp', 'hwpx']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const EXT_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
}

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
  const contentError = await validateFileContent(file)
  if (contentError) return jsonError(contentError, 400)

  // 이력서를 새로 올릴 때 기존 파일과 기록을 먼저 지우고 있었다. 그다음
  // 업로드가 실패하면 — 파일이 크거나 연결이 끊기거나 R2 가 잠깐 흔들리면 —
  // 새것은 없는데 옛것도 사라진다. 지원자는 "다시 올리면 되지"가 아니라
  // 원본 파일을 다시 찾아야 하고, 심사 중이던 지원서의 첨부가 비어 버린다.
  //
  // 새것을 먼저 올려 자리를 잡은 다음, 성공한 뒤에 옛것을 지운다.
  const existing = await env.DB.prepare(
    'SELECT id, r2_key FROM documents WHERE user_id = ? AND doc_type = ?'
  )
    .bind(data.user.id, docType)
    .first()

  const id = genId()
  // Concurrent uploads must never overwrite or clean up another request's file.
  const r2Key = `documents/${data.user.id}/${docType}-${id}.${ext}`
  const contentType = EXT_MIME[ext] || 'application/octet-stream'

  await env.DOCUMENTS.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
  })

  let saved
  try {
    // documents 에는 UNIQUE(user_id, doc_type) 가 있으므로 한 문장으로 바꾼다.
    saved = await env.DB.prepare(
      `INSERT INTO documents (id, user_id, doc_type, filename, r2_key, size_bytes, content_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, doc_type) DO UPDATE SET
         filename = excluded.filename,
         r2_key = excluded.r2_key,
         size_bytes = excluded.size_bytes,
         content_type = excluded.content_type,
         uploaded_at = datetime('now')
       RETURNING id`
    )
      .bind(id, data.user.id, docType, file.name, r2Key, file.size, contentType)
      .first()
    if (!saved?.id) throw new Error('Missing saved document')
  } catch {
    // A lost database response does not prove rollback. The write can already
    // have committed, so deleting this object could destroy the saved document.
    console.error('Document save result could not be confirmed')
    return jsonError('파일 저장 결과를 확인하지 못했습니다. 문서 목록을 다시 확인해주세요.', 503)
  }

  // 여기서 실패해도 남는 것은 아무도 가리키지 않는 옛 객체뿐이다.
  if (existing && existing.r2_key !== r2Key) {
    await env.DOCUMENTS.delete(existing.r2_key).catch(() => {})
  }

  return jsonResponse({ id: saved.id, docType, filename: file.name, sizeBytes: file.size }, 201)
}
