import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { isEmailConfigured } from '../../_lib/email.js'
import { sendTrackedEmail } from '../../_lib/emailOutbox.js'
import { buildBrandedEmailHtml } from '../../_lib/emailTemplate.js'
import { randomCapability, hashCapability } from '../../_lib/applicationAccess.js'

export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => null)
  const email = String(body?.email || '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('이메일 주소를 확인해주세요.', 400)
  if (!isEmailConfigured(env)) return jsonError('이메일 확인 기능을 현재 사용할 수 없습니다. 잠시 후 다시 시도해주세요.', 503)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (!await checkRateLimit(env, `application-access:ip:${ip}`, 5, 3600) ||
      !await checkRateLimit(env, `application-access:email:${await hashCapability(email)}`, 3, 3600)) {
    return jsonError('요청이 많습니다. 잠시 후 다시 시도해주세요.', 429)
  }
  // A link is sent for every valid mailbox, even if it has no applications.
  // The response never discloses whether an email or an application exists.
  const token = randomCapability()
  const hash = await hashCapability(token)
  await env.DB.prepare(`INSERT INTO application_access_tokens (token_hash, email, expires_at)
    VALUES (?, ?, ?)` ).bind(hash, email, new Date(Date.now() + 15 * 60_000).toISOString()).run()
  const link = `https://portfolio-epa.pages.dev/application-manage#token=${token}`
  const bodyText = `지원 내역 확인 요청을 받았습니다. 아래 링크는 15분 동안 한 번만 사용할 수 있습니다.\n\n${link}\n\n접수번호 확인, 제출 내용 확인, 심사 전 수정 및 지원 철회를 할 수 있습니다. 직접 요청하지 않았다면 이 메일을 무시해주세요.`
  const html = buildBrandedEmailHtml({ title: '지원 내역 확인', bodyText })
    .replaceAll(link, `<a href="${link}">${link}</a>`)
  try {
    await sendTrackedEmail(env, { to: email, subject: '지원 내역 확인 링크', text: bodyText, html,
      idempotencyKey: `application-access:${hash}` })
  } catch {
    return jsonError('확인 메일 전송을 완료하지 못했습니다. 메일함을 확인하고 잠시 후 다시 요청해주세요.', 502)
  }
  return jsonResponse({ ok: true, message: '확인 링크를 요청했습니다. 입력한 이메일의 받은편지함과 스팸함을 확인해주세요.' })
}
