import { jsonResponse, jsonError } from '../../_lib/http.js'

// 내 알림 목록 (최근 30개) + 안 읽음 개수
export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const [{ results }, unread] = await Promise.all([
    env.DB.prepare(
      `SELECT id, type, message, link, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`
    )
      .bind(data.user.id)
      .all(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0')
      .bind(data.user.id)
      .first(),
  ])

  return jsonResponse({
    notifications: results.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      link: n.link,
      isRead: !!n.is_read,
      createdAt: n.created_at,
    })),
    // COUNT 는 늘 한 줄을 준다고 여기고 바로 읽었는데, first() 가 null 을
    // 돌려주면 여기서 터져 알림 목록 전체가 500 이 된다. 못 셌으면 0으로 둔다.
    unreadCount: Number(unread?.count ?? 0),
  })
}
