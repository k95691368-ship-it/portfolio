import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireManageableApplication } from '../../../_lib/applications.js'
import { isEmailConfigured, sendApplicationResultEmail } from '../../../_lib/email.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'

// 관리: 1차 서류합격 안내와 면접방 입장 코드를 지원자에게 보낸다.
//
// 서류합격 처리를 할 때 한 번 자동으로 나가지만, 그것뿐이었다. 메일 공급자가
// 막혀 있거나 지원자가 못 받았거나 주소를 잘못 적었으면 다시 보낼 방법이
// 없었다. 담당자가 할 수 있는 것은 화면에 뜬 코드를 손으로 복사해 다른
// 경로로 전하는 것뿐인데, 그러면 무엇이 언제 나갔는지 이 시스템에는 남지
// 않는다.
//
// 코드가 없으면 지원자는 면접방에 들어올 수 없다. 들어오지 못하면 계약도
// 서명도 시작되지 않는다. 한 번 실패하면 끝나는 경로 위에 이 서비스 전체가
// 서 있었던 셈이다.
const RESEND_COOLDOWN_SECONDS = 60

export async function onRequestPost({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const application = access.application

  if (application.status !== 'passed') {
    return jsonError('서류합격 처리된 지원자에게만 입장 코드를 보낼 수 있습니다.', 409)
  }
  if (!application.room_id) {
    return jsonError('연결된 면접방이 없습니다.', 409)
  }
  if (!isEmailConfigured(env)) {
    return jsonError('이메일 발송 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.', 503)
  }

  // 같은 사람에게 연달아 보내지 않는다. 다만 실패한 시도는 한도를 소모하지
  // 않는다 — 한 번 실패했다고 다음 시도가 막히면 코드를 전할 길이 사라진다.
  const bucket = `send-code:${params.id}`
  const ticket = await checkRateLimit(env, bucket, 1, RESEND_COOLDOWN_SECONDS)
  if (!ticket) {
    return jsonError(`잠시 후 다시 시도해주세요. (${RESEND_COOLDOWN_SECONDS}초에 한 번)`, 429)
  }

  const room = await env.DB.prepare('SELECT invite_code FROM interview_rooms WHERE id = ?')
    .bind(application.room_id)
    .first()
  if (!room?.invite_code) {
    await releaseRateLimit(env, bucket, ticket)
    return jsonError('면접방 입장 코드를 찾을 수 없습니다.', 409)
  }

  const companyName = data.user.company_name || data.user.display_name
  try {
    await sendApplicationResultEmail(env, {
      to: application.applicant_email,
      applicantName: application.applicant_name,
      companyName,
      result: 'passed',
      inviteCode: room.invite_code,
    })
  } catch (err) {
    await releaseRateLimit(env, bucket, ticket)
    const detail = String(err?.message || err).slice(0, 300)
    console.error(`Send code email failed (application ${params.id}):`, detail)
    return jsonError(
      '이메일 발송에 실패했습니다. 아래 코드를 지원자에게 직접 전달해주세요.',
      502
    )
  }

  return jsonResponse({
    ok: true,
    sentTo: application.applicant_email,
    inviteCode: room.invite_code,
  })
}
