import { genId } from '../_lib/db.js'
import { hashPassword, createSession, sessionCookieHeader } from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null)
  if (!body) return jsonError('잘못된 요청입니다.', 400)

  const { email, password, role, displayName, companyName } = body
  if (!email || !password || !role || !displayName) {
    return jsonError('필수 항목이 누락되었습니다.', 400)
  }
  if (!['company', 'candidate'].includes(role)) {
    return jsonError('역할이 올바르지 않습니다.', 400)
  }
  if (password.length < 8) {
    return jsonError('비밀번호는 8자 이상이어야 합니다.', 400)
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return jsonError('이미 가입된 이메일입니다.', 409)

  const { hash, salt } = await hashPassword(password)
  const id = genId()
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, company_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, email, hash, salt, role, displayName, companyName || null)
    .run()

  const { token } = await createSession(env.DB, id)

  return jsonResponse(
    { id, email, role, displayName },
    201,
    { 'Set-Cookie': sessionCookieHeader(token) }
  )
}
