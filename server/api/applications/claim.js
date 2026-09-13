import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'

export async function onRequestPost({ request, env, data }) {
  const user = data.user
  if (!user) return jsonError('지원자 계정으로 로그인해주세요.', 401)
  if (user.role !== 'candidate' || user.developer_trial || user.session_scoped_room_id) return jsonError('지원자 계정만 연결할 수 있습니다.', 403)
  if (!await checkRateLimit(env, `claim:${user.id}`, 10, 3600)) return jsonError('잠시 후 다시 시도해주세요.', 429)
  const body = await request.json().catch(() => null)
  const code = String(body?.code || '').trim().toUpperCase()
  if (!/^[A-Z2-9]{10}$/.test(code)) return jsonError('접수번호를 확인해주세요.', 400)
  const result = await env.DB.prepare(`UPDATE applications SET created_user_id = ?
    WHERE lookup_code = ? AND applicant_email = ? AND status = 'submitted'
      AND (created_user_id IS NULL OR created_user_id = ?)`)
    .bind(user.id, code, user.email, user.id).run()
  if (!result.meta?.changes) return jsonError('계정 이메일과 접수번호를 확인해주세요. 심사가 완료된 지원서는 새로 연결할 수 없습니다.', 409)
  return jsonResponse({ ok: true })
}
