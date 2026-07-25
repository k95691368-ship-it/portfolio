import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireManageableApplication } from '../../../_lib/applications.js'
import { logAdminAction } from '../../../_lib/auditLog.js'
import { isEmailConfigured, sendApplicationResultEmail } from '../../../_lib/email.js'

// 관리: 서류 불합격 처리. 결과 안내 이메일(설정 시) + 감사 로그.
export async function onRequestPost({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const application = access.application

  if (application.status !== 'submitted') {
    return jsonError('이미 심사가 완료된 지원서입니다.', 409)
  }

  const claim = await env.DB.prepare(
    `UPDATE applications
     SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = datetime('now')
     WHERE id = ? AND status = 'submitted'`
  )
    .bind(data.user.id, params.id)
    .run()
  if (claim.meta.changes === 0) {
    return jsonError('이미 심사가 완료된 지원서입니다.', 409)
  }

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'application_reject',
    detail: `${application.applicant_email} · ${application.posting_title}`,
  }).catch(() => {})

  const companyName = data.user.company_name || data.user.display_name
  let emailStatus = 'not_sent'
  let emailError = null
  if (isEmailConfigured(env)) {
    try {
      await sendApplicationResultEmail(env, {
        to: application.applicant_email,
        applicantName: application.applicant_name,
        companyName,
        result: 'rejected',
      })
      emailStatus = 'sent'
    } catch (err) {
      emailStatus = 'failed'
      emailError = String(err?.message || err).slice(0, 300)
      console.error(`Reject result email failed (application ${params.id}):`, emailError)
    }
  }

  return jsonResponse({ ok: true, status: 'rejected', emailStatus, emailError })
}
