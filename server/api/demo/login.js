import { jsonResponse, jsonError } from '../../_lib/http.js'
import { createSession, hashPassword, sessionCookieHeader } from '../../_lib/auth.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { genId } from '../../_lib/db.js'
import { TRIAL_AUTH_METHOD, trialProfile } from '../../_lib/developerTrial.js'

export async function onRequestPost({ request, env, data = {} }) {
  if (data.user?.developer_trial) return jsonResponse(trialProfile(data.user))
  if (data.user) return jsonError('현재 계정에서 로그아웃한 뒤 체험을 시작해주세요.', 409)
  const body = await request.json().catch(() => null)
  if (body?.role !== 'developer' || body?.email) return jsonError('개발자 권한 체험 요청이 아닙니다.', 400)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (!await checkRateLimit(env, `developer-trial:${ip}`, 3, 3600)) {
    return jsonError('체험 시작 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.', 429)
  }
  const id = genId()
  const email = `${id}@trial.invalid`
  const { hash, salt } = await hashPassword(crypto.randomUUID() + crypto.randomUUID())
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, company_name,
                        is_admin, is_recruiter, is_developer)
     VALUES (?, ?, ?, ?, 'company', '개발자 권한 체험', '체험', 0, 0, 0)`
  ).bind(id, email, hash, salt).run()
  const { token, expiresAt } = await createSession(env.DB, id, {
    persistent: false, authMethod: TRIAL_AUTH_METHOD,
  })
  return jsonResponse({
    ...trialProfile({ id, email, display_name: '개발자 권한 체험', session_expires_at: expiresAt }),
    sessionToken: token, sessionExpiresAt: expiresAt, sessionPersistent: false,
  }, 200, { 'Set-Cookie': sessionCookieHeader(token, { persistent: false }) })
}
