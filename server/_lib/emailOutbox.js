import { sendGmailEmail, isGmailConfigured, EmailDeliveryError } from './gmail.js'
import { checkRateLimit } from './rateLimit.js'

export async function sendTrackedEmail(env, message) {
  if (!isGmailConfigured(env)) throw new EmailDeliveryError('Gmail 발송 설정이 완료되지 않았습니다.')
  if (!env.DB) throw new EmailDeliveryError('발송 기록 저장소가 연결되지 않았습니다.')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
    env.FINAL_OFFER_FROM_EMAIL, message.idempotencyKey || 'legacy', message.to, message.subject, message.text, message.attachments || [],
  ])))
  const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const claim = await env.DB.prepare(`INSERT INTO email_outbox (id, status) VALUES (?, 'sending')
    ON CONFLICT(id) DO UPDATE SET status = 'sending', updated_at = datetime('now')
      WHERE email_outbox.status = 'failed'`).bind(id).run()
  if (!claim.meta?.changes) {
    const previous = await env.DB.prepare('SELECT status, provider_id FROM email_outbox WHERE id = ?').bind(id).first()
    if (previous?.status === 'accepted' && previous.provider_id) return { id: previous.provider_id }
    throw new EmailDeliveryError('동일한 메일의 발송 결과를 확인 중입니다. 중복 발송을 막기 위해 보낸메일함 확인 전 재전송하지 않습니다.', 'unknown')
  }
  let accepted = false
  try {
    // Shared limits cover every mail route, including one-hour trials.
    if (!await checkRateLimit(env, 'email:global', 100, 86400) ||
        !await checkRateLimit(env, `email:recipient:${String(message.to).toLowerCase()}`, 5, 3600)) {
      throw new EmailDeliveryError('이메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해주세요.')
    }
    const result = await sendGmailEmail(env, { ...message, messageId: id })
    accepted = true
    await env.DB.prepare("UPDATE email_outbox SET status = 'accepted', provider_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(result.id, id).run()
    return result
  } catch (error) {
    const state = accepted || error.deliveryState === 'unknown' ? 'unknown' : 'failed'
    // A failed persistence attempt stays 'sending', which is also non-retryable.
    await env.DB.prepare("UPDATE email_outbox SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sending'")
      .bind(state, id).run().catch(() => {})
    throw new EmailDeliveryError(state === 'unknown' ? '메일이 발송되었을 수 있습니다. 보낸메일함과 발송 기록 확인 전 재전송하지 마세요.' : error.message, state)
  }
}
