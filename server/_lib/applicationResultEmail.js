import { isEmailConfigured, sendApplicationResultEmail } from './email.js'

const RETRYABLE = new Set(['pending', 'not_sent', 'failed'])
const KNOWN = new Set([...RETRYABLE, 'sending', 'sent', 'unknown'])
const MESSAGES = {
  pending: '결과 안내 이메일 발송을 기다리고 있습니다.',
  not_sent: 'Gmail 발송 설정이 완료되지 않아 발송하지 않았습니다. 설정 후 다시 시도해주세요.',
  sending: '발송을 처리 중이거나 결과 확인이 필요합니다. 중복 발송을 막기 위해 다시 보내지 않습니다.',
  sent: 'Gmail이 발송 요청을 접수했습니다. 수신함 도착이나 열람을 보장하는 상태는 아닙니다.',
  failed: '이메일을 발송하지 못했습니다. 연결이나 발송 설정을 확인한 뒤 다시 시도해주세요.',
  unknown: '메일이 발송되었을 수 있습니다. 보낸메일함과 발송 기록 확인 전 재전송하지 않습니다.',
  legacy_unknown: '이전 심사 결과의 발송 기록을 확인할 수 없습니다. 중복 발송을 막기 위해 다시 보내지 않습니다.',
}

export function getApplicationResultEmail(application) {
  if (!application || application.withdrawn_at || !['passed', 'rejected'].includes(application.status)) return null
  const status = KNOWN.has(application.result_email_status)
    ? application.result_email_status : 'legacy_unknown'
  return {
    status,
    sentAt: application.result_email_sent_at || null,
    attemptedAt: application.result_email_attempted_at || null,
    canRetry: RETRYABLE.has(status) && !application.purged_at &&
      !!application.applicant_email && (application.status !== 'passed' || !!application.room_id),
    // Never expose upstream errors, credentials or internal screening notes.
    message: MESSAGES[status],
  }
}

const readApplication = (env, id) => env.DB.prepare(
  `SELECT a.*, p.title AS posting_title,
          COALESCE(NULLIF(u.company_name, ''), NULLIF(u.display_name, ''), '회사') AS company_name,
          r.invite_code
   FROM applications a JOIN job_postings p ON p.id = a.posting_id
   LEFT JOIN users u ON u.id = p.created_by_user_id
   LEFT JOIN interview_rooms r ON r.id = a.room_id WHERE a.id = ?`
).bind(id).first()

async function deliver(env, id) {
  const application = await readApplication(env, id)
  const previous = getApplicationResultEmail(application)
  if (!previous?.canRetry) return previous || {
    status: 'unknown', sentAt: null, attemptedAt: null, canRetry: false, message: MESSAGES.unknown,
  }

  const attemptedAt = new Date().toISOString()
  // Unlike the content hash in email_outbox, this claim cannot change when an
  // administrator retries or a company renames itself. Never reclaim sending.
  const claim = await env.DB.prepare(
    `UPDATE applications SET result_email_status = 'sending', result_email_attempted_at = ?,
       result_email_sent_at = NULL, result_email_error = NULL
     WHERE id = ? AND status = ? AND purged_at IS NULL AND withdrawn_at IS NULL
       AND result_email_status IN ('pending', 'not_sent', 'failed')`
  ).bind(attemptedAt, id, application.status).run()
  if (!claim.meta?.changes) return getApplicationResultEmail(await readApplication(env, id)) || previous

  const finish = async (status, sentAt = null) => {
    const error = ['failed', 'not_sent', 'unknown'].includes(status) ? MESSAGES[status] : null
    const written = await env.DB.prepare(
      `UPDATE applications SET result_email_status = ?, result_email_sent_at = ?, result_email_error = ?
       WHERE id = ? AND status = ? AND result_email_status = 'sending'`
    ).bind(status, sentAt, error, id, application.status).run()
    if (!written.meta?.changes) throw new Error('Result email status changed during delivery')
    return getApplicationResultEmail({ ...application,
      result_email_status: status, result_email_attempted_at: attemptedAt, result_email_sent_at: sentAt,
    })
  }

  let accepted = false
  try {
    if (!isEmailConfigured(env)) return await finish('not_sent')
    if (application.status === 'passed' && !application.invite_code) return await finish('failed')
    await sendApplicationResultEmail(env, {
      idempotencyKey: `application:${id}:${application.status}`,
      to: application.applicant_email,
      applicantName: application.applicant_name,
      companyName: application.company_name,
      postingTitle: application.posting_title,
      result: application.status,
      inviteCode: application.status === 'passed' ? application.invite_code : undefined,
    })
    accepted = true
    return await finish('sent', new Date().toISOString())
  } catch (error) {
    const status = accepted || error?.deliveryState === 'unknown' ? 'unknown' : 'failed'
    try {
      return await finish(status)
    } catch {
      // If persistence is unavailable the durable claim stays sending. Do not
      // turn a possibly accepted mail into a retryable failure in the response.
      return { status: 'unknown', sentAt: null, attemptedAt, canRetry: false, message: MESSAGES.unknown }
    }
  }
}

// The review decision stays committed even if mail storage/provider is down.
export async function sendApplicationResultNotification(env, id) {
  try {
    return await deliver(env, id)
  } catch {
    return { status: 'unknown', sentAt: null, attemptedAt: null, canRetry: false, message: MESSAGES.unknown }
  }
}
