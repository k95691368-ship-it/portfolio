import { verifyPassword, hashPassword } from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const allowed = await checkRateLimit(env, `change-password:${data.user.id}`, 10, 600)
  if (!allowed) return jsonError('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const body = await request.json().catch(() => null)
  const { currentPassword, newPassword } = body || {}
  if (!currentPassword || !newPassword) {
    return jsonError('현재 비밀번호와 새 비밀번호를 입력해주세요.', 400)
  }
  if (newPassword.length < 8) {
    return jsonError('새 비밀번호는 8자 이상이어야 합니다.', 400)
  }

  const valid = await verifyPassword(currentPassword, data.user.password_hash, data.user.password_salt)
  if (!valid) return jsonError('현재 비밀번호가 올바르지 않습니다.', 401)

  const { hash, salt } = await hashPassword(newPassword)
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?'
  )
    .bind(hash, salt, data.user.id)
    .run()

  return jsonResponse({ ok: true })
}
