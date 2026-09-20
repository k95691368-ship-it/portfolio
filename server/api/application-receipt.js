import { jsonResponse, jsonError } from '../_lib/http.js'
import { submissionHash, applicationStatus } from '../_lib/applicationAccess.js'
import { checkRateLimit } from '../_lib/rateLimit.js'

export async function onRequestPost({ env, request }) {
  if (!await checkRateLimit(env, `application-receipt:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, 30, 600)) return jsonError('잠시 후 다시 시도해주세요.', 429)
  const body = await request.json().catch(() => null)
  const hash = await submissionHash(body?.postingId, body?.operationToken)
  if (!hash) return jsonError('접수 확인 정보가 올바르지 않습니다.', 400)
  const row = await env.DB.prepare('SELECT id, lookup_code, status, withdrawn_at FROM applications WHERE posting_id = ? AND submission_key_hash = ? AND purged_at IS NULL')
    .bind(body.postingId, hash).first()
  return row ? jsonResponse({ ok: true, applicationId: row.id, lookupCode: row.lookup_code, status: applicationStatus(row) }) : jsonError('아직 확인된 접수 내역이 없습니다.', 404)
}
