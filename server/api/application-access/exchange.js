import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { randomCapability, hashCapability } from '../../_lib/applicationAccess.js'

export async function onRequestPost({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (!await checkRateLimit(env, `application-access:exchange:${ip}`, 20, 600)) return jsonError('잠시 후 다시 시도해주세요.', 429)
  const body = await request.json().catch(() => null)
  if (!/^[a-f0-9]{64}$/.test(body?.token || '')) return jsonError('확인 링크가 유효하지 않습니다.', 400)
  const consumed = await env.DB.prepare(`UPDATE application_access_tokens SET used_at = datetime('now')
    WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now') RETURNING email`)
    .bind(await hashCapability(body.token)).first()
  if (!consumed) return jsonError('확인 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해주세요.', 401)
  const token = randomCapability()
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
  await env.DB.prepare('INSERT INTO application_access_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await hashCapability(token), consumed.email, expiresAt).run()
  return jsonResponse({ token, expiresAt })
}
