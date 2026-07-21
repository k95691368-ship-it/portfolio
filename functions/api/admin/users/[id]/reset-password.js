import { hashPassword, deleteAllUserSessions } from '../../../../_lib/auth.js'
import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { genTempPassword } from '../../../../_lib/tempPassword.js'

export async function onRequestPost({ env, data, params }) {
  if (params.id === data.user.id) {
    return jsonError('본인 계정의 비밀번호는 이 기능으로 재설정할 수 없습니다.', 403)
  }

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(params.id).first()
  if (!target) return jsonError('사용자를 찾을 수 없습니다.', 404)

  const tempPassword = genTempPassword()
  const { hash, salt } = await hashPassword(tempPassword)

  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?'
  )
    .bind(hash, salt, params.id)
    .run()
  await deleteAllUserSessions(env.DB, params.id)

  return jsonResponse({ ok: true, tempPassword })
}
