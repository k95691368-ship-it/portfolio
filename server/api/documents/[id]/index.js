import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { storageCleanupIntent, finishStorageCleanup } from '../../../_lib/storageCleanup.js'

export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(params.id).first()
  if (!doc) return jsonError('문서를 찾을 수 없습니다.', 404)
  if (doc.user_id !== data.user.id) return jsonError('권한이 없습니다.', 403)

  const operationId = crypto.randomUUID()
  try {
    const results = await env.DB.batch([
      // Lock the exact version so a concurrent replacement keeps its own file.
      env.DB.prepare('UPDATE documents SET r2_key = r2_key WHERE id = ? AND user_id = ? AND r2_key = ?')
        .bind(doc.id, data.user.id, doc.r2_key),
      storageCleanupIntent(env.DB, 'documents', operationId,
        'SELECT r2_key AS storage_key FROM documents WHERE id = ? AND user_id = ? AND r2_key = ?',
        [doc.id, data.user.id, doc.r2_key]),
      env.DB.prepare('DELETE FROM documents WHERE id = ? AND user_id = ? AND r2_key = ?')
        .bind(doc.id, data.user.id, doc.r2_key),
    ])
    if (!results[2].meta?.changes) return jsonError('문서가 변경되었습니다. 문서 목록을 다시 확인해주세요.', 409)
  } catch {
    return jsonError('문서 삭제 결과를 확인하지 못했습니다. 문서 목록을 다시 확인해주세요.', 503)
  }

  return jsonResponse({ ok: true, ...await finishStorageCleanup(env, operationId) })
}
