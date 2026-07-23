import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireManageableApplication } from '../../../_lib/applications.js'

// 관리: 서류 불합격 처리.
export async function onRequestPost({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const application = access.application

  if (application.status !== 'submitted') {
    return jsonError('이미 심사가 완료된 지원서입니다.', 409)
  }

  await env.DB.prepare(
    `UPDATE applications
     SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = datetime('now')
     WHERE id = ? AND status = 'submitted'`
  )
    .bind(data.user.id, params.id)
    .run()

  return jsonResponse({ ok: true, status: 'rejected' })
}
