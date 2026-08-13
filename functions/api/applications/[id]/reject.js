import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireManageableApplication } from '../../../_lib/applications.js'
import { offerStatusForApplication } from '../../../_lib/offerFromEmail.js'
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

  // 채용내정이 성립한 사람은 '탈락'시킬 수 없다.
  //
  // 이 시스템이 존재하는 이유가 여기다. 탈락은 채용내정이 서기 전의 개념이다.
  // 최종합격을 통보한 뒤에 그 사람을 탈락 처리하는 것은 심사 결과를 바꾸는
  // 일이 아니라 이미 성립한 근로계약을 끊는 일이고, 그것은 해고다
  // (근로기준법 제23조 제1항 — 정당한 이유 없이 해고하지 못한다).
  //
  // 담당자는 이것을 모른 채 누른다. "아직 최종 결재 전"이라고 생각하기
  // 때문이다. 그래서 경고만 띄우지 않고 이 경로 자체를 닫는다. 정말로
  // 끝내야 한다면 면접방의 채용내정 취소 절차를 밟아야 하고, 거기에는
  // 무엇이 걸리는지 보여 주고 확인을 받는 단계가 있다.
  const offer = await offerStatusForApplication(env, application)
  if (offer.established) {
    return jsonResponse(
      {
        error:
          '이 지원자는 이미 채용내정이 성립해 탈락 처리할 수 없습니다. 최종합격을 통보한 뒤의 취소는 탈락이 아니라 해고로 다뤄집니다(근로기준법 제23조 제1항).',
        blockedByOffer: true,
        offer,
        roomId: application.room_id ?? null,
      },
      409
    )
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
