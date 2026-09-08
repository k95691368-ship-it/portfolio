import { jsonResponse, jsonError } from '../../_lib/http.js'
import { vapidConfigured } from '../../_lib/webPush.js'

// 이 기기로 알림을 밀어 달라고 등록한다.
//
// 브라우저가 준 세 값을 그대로 받는다. 이 값이 있어야 창이 닫혀 있어도
// 그 사람에게 닿는다.
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (!vapidConfigured(env)) return jsonError('푸시 알림이 설정되지 않았습니다.', 503)

  const body = await request.json().catch(() => null)
  const endpoint = String(body?.endpoint ?? '').trim()
  const p256dh = String(body?.p256dh ?? '').trim()
  const auth = String(body?.auth ?? '').trim()
  if (!endpoint || !p256dh || !auth) return jsonError('구독 정보가 올바르지 않습니다.', 400)

  // 밀어 주는 주소는 브라우저 회사의 것이어야 한다. 아무 주소나 받으면 이
  // 서버가 남의 서버를 두드리는 도구가 된다.
  let host
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') return jsonError('구독 정보가 올바르지 않습니다.', 400)
    host = url.host
  } catch {
    return jsonError('구독 정보가 올바르지 않습니다.', 400)
  }
  const allowed = /(^|\.)(googleapis\.com|mozilla\.com|windows\.com|apple\.com)$/.test(host)
  if (!allowed) return jsonError('지원하지 않는 알림 주소입니다.', 400)

  // 같은 기기가 다시 등록하면 덮어쓴다. 브라우저는 열쇠를 갱신하기도 한다.
  //
  // 사람도 함께 덮는다 -- 한 컴퓨터를 담당자가 바꿔 쓰면 같은 주소가 다른
  // 사람의 것이 되는데, 그대로 두면 전임자에게 알림이 계속 간다.
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent`
  )
    .bind(
      endpoint,
      data.user.id,
      p256dh,
      auth,
      (request.headers.get('User-Agent') || '').slice(0, 200) || null
    )
    .run()

  return jsonResponse({ ok: true }, 201)
}

// 알림을 끈다. 구독을 지워야 서버가 죽은 주소로 계속 보내지 않는다.
export async function onRequestDelete({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const body = await request.json().catch(() => null)
  const endpoint = String(body?.endpoint ?? '').trim()
  if (!endpoint) return jsonError('구독 정보가 올바르지 않습니다.', 400)

  // 남의 구독을 지우지 못하게 사람까지 맞춘다.
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, data.user.id)
    .run()
  return jsonResponse({ ok: true })
}
