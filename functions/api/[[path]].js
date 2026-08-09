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
export function onRequest({ request }) {
  const { pathname } = new URL(request.url)
  return jsonError(`${request.method} ${pathname} 경로는 없습니다.`, 404)
}
