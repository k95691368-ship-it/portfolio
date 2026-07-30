import { verifyPassword, createSession, sessionCookieHeader, normalizeEmail } from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null)
  if (!body?.email || !body?.password) {
    return jsonError('이메일과 비밀번호를 입력해주세요.', 400)
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `login:${ip}`, 20, 600)
  if (!allowed) return jsonError('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  // 저장된 표기와 대소문자가 달라 로그인이 막히지 않도록 같은 규칙으로 맞춘다.
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(normalizeEmail(body.email))
    .first()
  if (!user) return jsonError('이메일 또는 비밀번호가 올바르지 않습니다.', 401)

  const valid = await verifyPassword(body.password, user.password_hash, user.password_salt)
  if (!valid) return jsonError('이메일 또는 비밀번호가 올바르지 않습니다.', 401)

  if (user.is_suspended) return jsonError('정지된 계정입니다. 관리자에게 문의해주세요.', 403)

  const { token } = await createSession(env.DB, user.id)

  return jsonResponse(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      isAdmin: !!user.is_admin,
      isRecruiter: !!user.is_recruiter,
      isDeveloper: !!user.is_developer,
      mustChangePassword: !!user.must_change_password,
    },
    200,
    { 'Set-Cookie': sessionCookieHeader(token) }
  )
}
