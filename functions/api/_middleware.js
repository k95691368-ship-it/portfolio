import {
  getSessionUser,
  getRoomSessionUser,
  roomIdFromApiPath,
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

  // 세션 조회 하나가 실패하면 전원이 로그아웃된다.
  //
  // 이 줄은 보호 없이 await 하고 있었다. D1 이 한 번 흔들리면 미들웨어가
  // 통째로 던져 500 + HTML 이 나가고, 그 경로는 /api/login 과 /api/me 도 탄다.
  // 화면은 그 실패를 "로그인 안 됨"으로 읽어 로그인 화면으로 보낸다 —
  // 쿠키는 멀쩡한데 로그인이 풀린 것처럼 보이는 자리다.
  //
  // 읽지 못한 것은 "세션 없음"으로 떨어뜨리되 조용히 넘기지는 않는다.
  try {
    context.data.user = await getSessionUser(context.env.DB, request)
  } catch (err) {
    console.error('session lookup failed:', err)
    context.data.user = null
  }

  // 방 안에서는 어느 문으로 들어왔느냐로 신원이 갈린다.
  //
  // 한 컴퓨터에 두 신원이 동시에 있을 수 있다 — 담당자가 회사 계정으로
  // 일하다가 구직자 홈에서 코드를 넣어 보는 경우다. 어느 하나를 덮으면
  // 다른 하나가 죽는다.
  //
  // 그래서 쿠키 두 개를 나란히 두고, 여기 한 곳에서만 고른다.
  //   채용자 홈에서 방을 열면 -> 계정(회사)
  //   구직자 홈에서 코드로 들어오면 -> 그 방의 지원자
  // 화면이 어느 문으로 들어왔는지 X-Room-Identity 로 알려 준다. 계정이 아예
  // 없는 브라우저(코드만 받은 지원자)는 알려 주지 않아도 코드 쪽으로 간다.
  //
  // 여기서 정해진 값이 곧 data.user 다. 이 아래 어느 코드도 신원을 다시
  // 판단하지 않는다 — 판정이 여러 층에 흩어졌던 것이 지난번 사고의 원인이다.
  const roomId = roomIdFromApiPath(new URL(request.url).pathname)
  const wantsCodeIdentity = request.headers.get('X-Room-Identity') === 'code'
  let viaRoomCookie = false
  if (roomId && (wantsCodeIdentity || !context.data.user)) {
    try {
      const roomUser = await getRoomSessionUser(context.env.DB, request, roomId)
      if (roomUser) {
        context.data.user = roomUser
        viaRoomCookie = true
      }
    } catch (err) {
      console.error('room session lookup failed:', err)
    }
  }

  // 쓰고 있는 동안에는 로그인이 끝나지 않게 만료를 미룬다.
  //
  // 조건을 SQL 에만 걸어 두어, 미룰 필요가 없는 요청에서도 UPDATE 가 한 번씩
  // 나갔다. 로그인한 사람의 모든 요청마다 쓰기가 한 번인 셈이다. 만료 시각은
  // 이미 세션을 읽을 때 함께 가져왔으므로, 미뤄야 할 때만 부른다.
  //
  // 코드 세션은 여기서 미루지 않는다. 아래 갱신은 'session' 쿠키를 다시
  // 내려보내는 일인데, 코드로 들어온 사람의 신원은 다른 쿠키에 들어 있다.
  const renew = context.data.user && !viaRoomCookie ? needsRenewal(context.data.user) : false
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
  //
  // 이름을 부분 문자열로 보면 안 된다. 'room_session=' 안에도 'session=' 이
  // 들어 있어서, 코드 입장 응답이 계정 쿠키 갱신을 통째로 건너뛰게 만든다.
  // 헤더를 한 줄씩 받아 이름이 정확히 session 인 것만 본다.
  const existing = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('Set-Cookie')].filter(Boolean)
  if (existing.some((c) => /^\s*session=/.test(c))) return response

  const withCookie = new Response(response.body, response)
  withCookie.headers.append('Set-Cookie', sessionCookieHeader(token))
  return withCookie
}
