import {
  getRoomAccess,
  ROOM_ACCESS_COOKIE,
} from '../_lib/roomAccess.js'
import {
  getSessionUser,
  renewSessionIfStale,
  needsRenewal,
  parseCookie,
  sessionCookieHeader,
} from '../_lib/auth.js'
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

  // 코드만으로 들어온 사람의 출입증. 계정과 별개다.
  //
  // 로그인한 사람에게는 굳이 확인하지 않는다 — 계정 권한이 더 넓고, 요청마다
  // 조회를 하나 더 하는 것은 대화 화면처럼 자주 도는 곳에서 그대로 체감된다.
  context.data.roomAccess = context.data.user
    ? null
    : await getRoomAccess(context.env.DB, parseCookie(request, ROOM_ACCESS_COOKIE))

  // 쓰고 있는 동안에는 로그인이 끝나지 않게 만료를 미룬다.
  //
  // 조건을 SQL 에만 걸어 두어, 미룰 필요가 없는 요청에서도 UPDATE 가 한 번씩
  // 나갔다. 로그인한 사람의 모든 요청마다 쓰기가 한 번인 셈이다. 만료 시각은
  // 이미 세션을 읽을 때 함께 가져왔으므로, 미뤄야 할 때만 부른다.
  const renew = context.data.user ? needsRenewal(context.data.user) : false
  if (renew) {
    // 응답을 붙잡아 두지 않도록 뒤로 넘긴다 — 실패해도 이번 요청과는 상관없다.
    const renewal = renewSessionIfStale(context.env.DB, request)
    if (context.waitUntil) context.waitUntil(renewal)
    else await renewal.catch(() => {})
  }

  const response = await context.next()
  if (!renew) return response

  // 서버 쪽 만료만 미루고 쿠키는 그대로 두고 있었다.
  //
  // 브라우저의 쿠키는 로그인한 순간부터 30일짜리다. DB 의 expires_at 을 아무리
  // 미뤄도 그 쿠키가 사라지면 보낼 것이 없어 로그아웃된다. 매일 들어와도
  // 30일째에 끊기는 증상 — 고치겠다고 적어 놓고 절반만 고친 셈이었다.
  //
  // 미룰 때마다 쿠키도 새로 내려 두 시계를 함께 맞춘다.
  const token = parseCookie(request, 'session')
  if (!token) return response

  // 응답이 이미 세션 쿠키를 내보내고 있으면 손대지 않는다.
  //
  // 비밀번호 변경·로그인·로그아웃은 새 토큰(또는 삭제)을 내려보낸다. 거기에
  // 옛 토큰으로 만든 쿠키를 덧붙이면 브라우저에 같은 이름의 쿠키가 두 번
  // 도착한다. 뒤에 온 것이 이기므로 방금 만든 세션이 이미 지운 세션으로
  // 덮이고, 비밀번호를 바꾼 사람이 그 자리에서 로그아웃된다.
  const existing = response.headers.get('Set-Cookie')
  if (existing && existing.includes('session=')) return response

  const withCookie = new Response(response.body, response)
  withCookie.headers.append('Set-Cookie', sessionCookieHeader(token))
  return withCookie
}
