import { jsonResponse, jsonError } from '../../_lib/http.js'

// 내 쪽지함 목록. 상대별로 마지막 한 줄과 안 읽은 개수.
//
// 화면이 20초마다 두드리는 자리라 질의를 하나로 합쳤다. 상대 목록을 뽑고
// 사람마다 마지막 줄을 다시 묻는 방식이면, 대화 상대가 열 명일 때 요청
// 하나에 질의가 열한 번 나간다.
export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  // 코드로 들어온 지원자는 여기 오지 않는다. 그 신원은 방 하나에만 유효한
  // 것이라 쪽지함이라는 개념 자체가 없다 -- 미들웨어가 /api/dm 에서는 방
  // 쿠키를 보지 않으므로 data.user 는 늘 계정 쪽이다.
  const me = data.user.id

  const { results } = await env.DB.prepare(
    `WITH mine AS (
       SELECT id, body, created_at, read_at, sender_id, recipient_id,
              CASE WHEN sender_id = ?1 THEN recipient_id ELSE sender_id END AS partner_id
         FROM direct_messages
        WHERE sender_id = ?1 OR recipient_id = ?1
     )
     SELECT m.partner_id,
            u.display_name, u.company_name, u.role, u.is_admin,
            (SELECT body FROM mine x WHERE x.partner_id = m.partner_id
              ORDER BY x.id DESC LIMIT 1) AS last_body,
            (SELECT sender_id FROM mine x WHERE x.partner_id = m.partner_id
              ORDER BY x.id DESC LIMIT 1) AS last_sender_id,
            MAX(m.id) AS last_id,
            MAX(m.created_at) AS last_at,
            SUM(CASE WHEN m.recipient_id = ?1 AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unread
       FROM mine m
       JOIN users u ON u.id = m.partner_id
      GROUP BY m.partner_id
      ORDER BY last_id DESC
      LIMIT 50`
  )
    .bind(me)
    .all()

  const threads = (results || []).map((t) => ({
    partner: {
      id: t.partner_id,
      displayName: t.display_name,
      companyName: t.company_name || null,
      role: t.role,
      isAdmin: !!t.is_admin,
    },
    lastBody: t.last_body,
    lastFromMe: t.last_sender_id === me,
    lastAt: t.last_at,
    unread: Number(t.unread || 0),
  }))

  return jsonResponse({
    threads,
    unreadTotal: threads.reduce((sum, t) => sum + t.unread, 0),
  })
}
