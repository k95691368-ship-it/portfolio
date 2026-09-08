import { jsonResponse, jsonError } from '../../_lib/http.js'

// 내 알림 전체 읽음 처리
export async function onRequestPost({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .bind(data.user.id)
    .run()

  return jsonResponse({ ok: true })
}
