import {
  verifyPassword,
  hashPassword,
  deleteAllUserSessions,
  createSession,
  sessionCookieHeader,
} from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const allowed = await checkRateLimit(env, `change-password:${data.user.id}`, 10, 600)
  if (!allowed) return jsonError('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const body = await request.json().catch(() => null)
  const { currentPassword, newPassword } = body || {}
  // 타입을 확인하지 않으면 JSON 숫자가 그대로 지나간다. 숫자에는 length 가
  // 없어 undefined < 8 이 false 가 되고, 8자 검사가 통째로 건너뛰어진다.
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return jsonError('현재 비밀번호와 새 비밀번호를 입력해주세요.', 400)
  }
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

  // 비밀번호를 바꾸는 이유의 대부분은 "누가 알고 있을지 모른다"이다. 그런데
  // 세션은 그대로 살아 있었다. 관리자가 발급한 임시 비밀번호로 다른 사람이
  // 먼저 로그인해 두었다면, 본인이 비밀번호를 바꿔도 그 세션은 계속 열려 있다.
  //
  // 이 계정의 세션을 전부 지우고, 지금 바꾼 사람에게만 새 세션을 준다.
  await deleteAllUserSessions(env.DB, data.user.id)
  const { token } = await createSession(env.DB, data.user.id)

  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) })
}
