import { hashPassword, deleteAllUserSessions } from '../../../../_lib/auth.js'
import { jsonResponse, jsonError } from '../../../../_lib/http.js'

// Excludes visually ambiguous characters (0/O, 1/I/l) since this is a
// credential a person needs to retype accurately.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const TEMP_PASSWORD_LENGTH = 16

function genTempPassword() {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length
  const chars = []
  while (chars.length < TEMP_PASSWORD_LENGTH) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]
    if (byte >= limit) continue
    chars.push(ALPHABET[byte % ALPHABET.length])
  }
  return chars.join('')
}

export async function onRequestPost({ env, data, params }) {
  if (params.id === data.user.id) {
    return jsonError('본인 계정의 비밀번호는 이 기능으로 재설정할 수 없습니다.', 403)
  }

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(params.id).first()
  if (!target) return jsonError('사용자를 찾을 수 없습니다.', 404)

  const tempPassword = genTempPassword()
  const { hash, salt } = await hashPassword(tempPassword)

  await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, params.id)
    .run()
  await deleteAllUserSessions(env.DB, params.id)

  return jsonResponse({ ok: true, tempPassword })
}
