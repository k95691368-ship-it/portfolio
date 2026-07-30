import { genId } from '../_lib/db.js'
import { hashPassword, createSession, sessionCookieHeader, normalizeEmail } from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null)
  if (!body) return jsonError('잘못된 요청입니다.', 400)

  const { password, role, displayName, companyName } = body
  // 지원서 쪽과 같은 표기로 통일해 같은 사람이 두 계정으로 갈라지지 않게 한다.
  const email = normalizeEmail(body.email)
  if (!email || !password || !role || !displayName) {
    return jsonError('필수 항목이 누락되었습니다.', 400)
  }
  if (!['company', 'candidate'].includes(role)) {
    return jsonError('역할이 올바르지 않습니다.', 400)
  }
  if (password.length < 8) {
    return jsonError('비밀번호는 8자 이상이어야 합니다.', 400)
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `signup:${ip}`, 10, 3600)
  if (!allowed) return jsonError('잠시 후 다시 시도해주세요.', 429)

  const { hash, salt } = await hashPassword(password)
  const id = genId()
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, company_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, email, hash, salt, role, displayName, companyName || null)
      .run()
  } catch (err) {
    if (String(err?.message || err).includes('UNIQUE')) {
      return jsonError('이미 가입된 이메일입니다.', 409)
    }
    throw err
  }

  const { token } = await createSession(env.DB, id)

  return jsonResponse(
    { id, email, role, displayName, isAdmin: false, isRecruiter: false, isDeveloper: false, mustChangePassword: false },
    201,
    { 'Set-Cookie': sessionCookieHeader(token) }
  )
}
