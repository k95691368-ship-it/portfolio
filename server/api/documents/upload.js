import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'
import { validateFileContent } from '../../_lib/uploads.js'
import { storageCleanupIntent, finishStorageCleanup } from '../../_lib/storageCleanup.js'

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

  const id = genId()
  // Concurrent uploads must never overwrite or clean up another request's file.
  const r2Key = `documents/${data.user.id}/${docType}-${id}.${ext}`
  const contentType = EXT_MIME[ext] || 'application/octet-stream'
  const operationId = genId()

  try {
    // Record the immutable key before storage can accept any bytes. Uncertain
    // PUT/DB responses retain an exact retry target without deleting a file
    // that may already be referenced by a committed save.
    const queued = await storageCleanupIntent(env.DB, 'documents', operationId,
      'SELECT ? AS storage_key', [r2Key], { defer: true }).run()
    if (!queued?.meta?.changes) throw new Error('Missing document cleanup receipt')
  } catch {
    return jsonError('파일 보관을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.', 503)
  }
  try {
    await env.DOCUMENTS.put(r2Key, file.stream(), { httpMetadata: { contentType } })
  } catch {
    return jsonError('파일 업로드 결과를 확인하지 못했습니다. 문서 목록을 다시 확인해주세요.', 503)
  }

  let saved
  try {
    const results = await env.DB.batch([
      // The parent lock also serializes first uploads when no document row
      // exists yet. Capture the actual preceding key inside this transaction,
      // rather than a snapshot read before another upload finishes.
      env.DB.prepare('UPDATE users SET id = id WHERE id = ?').bind(data.user.id),
      env.DB.prepare('UPDATE documents SET r2_key = r2_key WHERE user_id = ? AND doc_type = ?')
        .bind(data.user.id, docType),
      storageCleanupIntent(env.DB, 'documents', operationId,
        'SELECT r2_key AS storage_key FROM documents WHERE user_id = ? AND doc_type = ?',
        [data.user.id, docType], { defer: true }),
      env.DB.prepare(
        `INSERT INTO documents (id, user_id, doc_type, filename, r2_key, size_bytes, content_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, doc_type) DO UPDATE SET
           filename = excluded.filename,
           r2_key = excluded.r2_key,
           size_bytes = excluded.size_bytes,
           content_type = excluded.content_type,
           uploaded_at = datetime('now')
         RETURNING id`
      ).bind(id, data.user.id, docType, file.name, r2Key, file.size, contentType),
    ])
    if (!results?.[3]?.meta?.changes) throw new Error('Missing document save acknowledgement')
    // A later delete/reupload can create another row. Keep this transaction's
    // exact ID rather than reading whichever row exists after it commits.
    saved = results[3].results?.[0]
    if (!saved?.id) throw new Error('Missing saved document')
  } catch {
    console.error('Document save result could not be confirmed')
    return jsonError('파일 저장 결과를 확인하지 못했습니다. 문서 목록을 다시 확인해주세요.', 503)
  }

  // A later replacement can reassign this key's receipt. Acknowledge only our
  // operation, then let the existing processor protect all live/archive uses.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM storage_cleanup_intents WHERE bucket = ? AND storage_key = ? AND operation_id = ?')
      .bind('documents', r2Key, operationId),
    env.DB.prepare("UPDATE storage_cleanup_intents SET not_before = datetime('now'), next_attempt_at = datetime('now') WHERE operation_id = ?")
      .bind(operationId),
  ]).catch(() => {})
  const cleanup = await finishStorageCleanup(env, operationId)

  return jsonResponse(
    { id: saved.id, docType, filename: file.name, sizeBytes: file.size, ...cleanup },
    201
  )
}
