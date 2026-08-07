// 이 API 가 돌려주는 것은 대부분 한 사람에게만 보여야 하는 것이다 — 계약 조건,
// 임금, 지원서, 접수번호, 세션 사용자.
//
// 그런데 응답에 캐시 지시가 하나도 없었다. 지시가 없으면 브라우저와 중간
// 캐시는 스스로 판단해 저장할 수 있고, 공용 컴퓨터에서 로그아웃한 뒤 뒤로
// 가기를 누르면 앞사람의 계약서가 그대로 다시 그려진다. Vary: Cookie 도
// 없었으므로, 쿠키가 다른 두 사람의 요청이 같은 응답으로 묶일 여지도 남는다.
//
// 개인정보를 담은 응답은 저장하지 않는다고 명시한다.
const PRIVATE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  Vary: 'Cookie',
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...PRIVATE_HEADERS, ...extraHeaders },
  })
}

export function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, status)
}

// 내려받는 파일의 이름을 헤더에 안전하게 담는다.
//
// 예전에는 encodeURIComponent 한 값을 그대로 filename= 에 넣었다. 그러면
// 한글 이름이 "%EC%9D%B4%EB%A0%A5%EC%84%9C.pdf" 로 저장된다 — 자기 이력서를
// 내려받았는데 무슨 파일인지 알아볼 수 없다. RFC 6266/5987 은 이런 경우
// filename*= 를 쓰라고 정한다. 옛 브라우저를 위해 아스키 대체 이름을 함께 둔다.
export function contentDisposition(filename, disposition = 'attachment') {
  const name = String(filename ?? '').replace(/["\r\n\\]/g, '') || 'download'
  const ascii = name.replace(/[^\x20-\x7e]/g, '_')
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

// 파일 응답도 캐시에 남기지 않는다. 계약서와 이력서가 그 대상이다.
export const FILE_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
}

// 이 요청이 우리 화면이 부른 것인가, 주소창에 붙은 링크를 누른 것인가.
//
// 계약서 조회(GET)는 근로자가 계약서를 열어 본 사실을 남긴다. 전자문서법
// 제5조의 수신 기록이고, 교부가 실제로 닿았다는 증거다. 그런데 GET 이라
// 링크 한 번으로 만들어진다. 세션 쿠키가 SameSite=Lax 이므로 다른 사이트가
// 보낸 링크를 근로자가 누르기만 해도 쿠키가 함께 가고, 계약서를 본 적 없는
// 사람 앞으로 "열람함" 기록이 남는다. 증거가 위조되는 것이다.
//
// 화면이 fetch 로 부른 요청만 기록 대상으로 본다. 판단할 수 없으면 기록하지
// 않는다 — 없는 기록이 틀린 기록보다 낫다.
export function isAppFetch(request) {
  const mode = request.headers.get('Sec-Fetch-Mode')
  const site = request.headers.get('Sec-Fetch-Site')
  if (mode) {
    if (mode === 'navigate') return false
    return site === 'same-origin' || site === 'none'
  }
  // 이 헤더를 보내지 않는 브라우저에서는 Accept 로 가린다. 주소창 이동은
  // text/html 을 먼저 요구하고, fetch 는 그렇지 않다.
  const accept = request.headers.get('Accept') || ''
  return !accept.includes('text/html')
}
