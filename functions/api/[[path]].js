import { jsonError } from '../_lib/http.js'

// 없는 API 경로에 대한 답.
//
// Cloudflare Pages 는 어떤 Function 에도 걸리지 않는 요청을 SPA 의 index.html
// 로 넘긴다. 그래서 /api/무엇이든 을 부르면 200 과 함께 HTML 이 돌아왔다.
//
// 이것이 두 가지를 망친다.
//
//   API 를 부르는 쪽은 JSON 을 기대하고 파싱하다 깨진다. 상태 코드가 200 이라
//   실패로도 잡히지 않는다.
//
//   더 나쁜 것은 라우트가 사라진 것을 아무도 모른다는 점이다. 이 저장소는 그
//   함정을 이미 두 번 밟았다 — 대체된 경로를 지웠는데 스모크 테스트가 계속
//   통과했고, 확인하려던 기능이 사라졌는데 확인은 성공했다.
//
// 없는 경로에는 없다고 답한다. 이 파일은 대괄호 두 겹이라 가장 낮은 우선순위로
// 매칭되므로, 실제 경로가 있으면 그쪽이 먼저 잡힌다.
export async function onRequest({ request }) {
  const { pathname } = new URL(request.url)

  // HEAD 는 GET 과 같되 본문만 없는 요청이다.
  //
  // 라우트 파일들은 onRequestGet 만 내보낸다. Pages 는 HEAD 를 그것에 태우지
  // 않으므로, 살아 있는 경로인데도 여기까지 떨어져 404 가 됐다. 바깥에서 이
  // 사이트를 지켜보는 도구는 그것을 장애로 읽는다.
  //
  // 미들웨어에서 GET 으로 바꿔 태워 보려 했지만 그 방법으로는 메서드 분기가
  // 바뀌지 않았다. 그래서 여기서 같은 주소를 GET 으로 한 번 더 물어보고 본문만
  // 버린다. 요청이 하나 늘지만 이 갈래는 HEAD 일 때만 지나가고, 이 앱은 HEAD 를
  // 쓰지 않는다.
  //
  // 되풀이될 걱정은 없다. 다시 묻는 요청은 GET 이라, 정말 없는 경로면 아래
  // 404 로 끝난다.
  if (request.method === 'HEAD') {
    const res = await fetch(new Request(request.url, { method: 'GET', headers: request.headers }))
    return new Response(null, { status: res.status, headers: res.headers })
  }

  return jsonError(`${request.method} ${pathname} 경로는 없습니다.`, 404)
}
