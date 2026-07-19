import { verifyPassword, createSession, sessionCookieHeader } from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null)
  if (!body?.email || !body?.password) {
    return jsonError('이메일과 비밀번호를 입력해주세요.', 400)
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(body.email).first()
  if (!user) return jsonError('이메일 또는 비밀번호가 올바르지 않습니다.', 401)

  const valid = await verifyPassword(body.password, user.password_hash, user.password_salt)
  if (!valid) return jsonError('이메일 또는 비밀번호가 올바르지 않습니다.', 401)

  const { token } = await createSession(env.DB, user.id)

  return jsonResponse(
    { id: user.id, email: user.email, role: user.role, displayName: user.display_name },
    200,
    { 'Set-Cookie': sessionCookieHeader(token) }
  )
}
