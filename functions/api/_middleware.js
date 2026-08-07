import { getSessionUser } from '../_lib/auth.js'
import { jsonError } from '../_lib/http.js'

// 다른 사이트가 이 API 를 대신 부르는 것을 막는다.
//
// 세션 쿠키는 SameSite=Lax 다. Lax 는 다른 사이트에서 시작된 POST 에는 쿠키를
// 붙이지 않으므로 대부분의 요청 위조는 여기서 막힌다. 그런데 이 코드는 요청이
// 어디서 왔는지 한 번도 보지 않았고, Content-Type 도 확인하지 않은 채
// request.json() 으로 본문을 읽는다. 브라우저 정책 하나에만 기대는 셈이다.
//
// 상태를 바꾸는 요청에 Origin 이 붙어 있으면 우리 호스트인지 본다. Origin 이
// 아예 없는 요청은 브라우저가 아닌 곳(검증 스크립트, curl)에서 온 것이므로
// 그대로 통과시킨다 — 그것들은 세션 쿠키를 스스로 들고 오는 요청이고, 남의
// 쿠키를 빌려 쓰는 위조와는 다르다.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function crossSite(request) {
  const origin = request.headers.get('Origin')
  if (!origin) return false
  try {
    return new URL(origin).host !== new URL(request.url).host
  } catch {
    // 읽을 수 없는 Origin 은 우리 것이 아니다.
    return true
  }
}

export async function onRequest(context) {
  const { request } = context

  if (STATE_CHANGING.has(request.method) && crossSite(request)) {
    return jsonError('다른 사이트에서 보낸 요청은 처리하지 않습니다.', 403)
  }

  context.data.user = await getSessionUser(context.env.DB, request)
  return context.next()
}
