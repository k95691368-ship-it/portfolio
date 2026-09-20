import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireManageableApplication } from '../../../_lib/applications.js'
import { getApplicationResultEmail, sendApplicationResultNotification } from '../../../_lib/applicationResultEmail.js'
import { maskEmail } from '../../../_lib/email.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'

// Retry only a known unsent/failed result. The client cannot select the result,
// recipient, contents, or bypass uncertain delivery by using another endpoint.
export async function retryApplicationResultEmail(context, { passedOnly = false } = {}) {
  const { env, data, params } = context
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const application = access.application
  if (passedOnly && application.status !== 'passed') {
    return jsonError('서류합격 처리된 지원자에게만 입장 코드를 보낼 수 있습니다.', 409)
  }
  const previous = getApplicationResultEmail(application)
  if (!previous) return jsonError('서류 심사 결과가 확정된 지원서만 안내할 수 있습니다.', 409)
  if (!previous.canRetry) {
    return jsonResponse({ error: previous.message, resultEmail: previous }, 409)
  }
  const bucket = `application-result-email:${params.id}`
  const ticket = await checkRateLimit(env, bucket, 1, 60)
  if (!ticket) return jsonError('잠시 후 다시 시도해주세요. (60초에 한 번)', 429)

  const resultEmail = await sendApplicationResultNotification(env, params.id)
  if (resultEmail.canRetry) await releaseRateLimit(env, bucket, ticket).catch(() => {})
  return jsonResponse({
    ok: resultEmail.status === 'sent',
    emailStatus: resultEmail.status,
    resultEmail,
    sentTo: maskEmail(application.applicant_email),
  })
}

export function onRequestPost(context) {
  return retryApplicationResultEmail(context)
}
