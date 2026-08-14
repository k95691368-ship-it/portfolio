// 방문 기록을 구글 애널리틱스로 보낸다. 다만 주소를 그대로 보내지는 않는다.
//
// 이 사이트의 주소에는 사람을 특정하는 값이 들어 있다.
//
//   /jobs/<공고 id>/apply
//   /rooms/<면접방 id>/contract
//   /application-status?code=<접수번호>
//   /verify?code=<증명서 발급번호>
//
// 접수번호와 발급번호는 그 자체가 열쇠다. 접수번호 하나면 그 사람의 지원
// 내역이 열리고, 발급번호 하나면 근로계약 증명서가 열린다. 애널리틱스 보고서는
// 주소를 그대로 목록으로 보여 주므로, 손대지 않고 보내면 남의 지원서를 여는
// 열쇠가 구글 계정 화면에 줄줄이 쌓인다. 개인정보를 제3자에게 보내는 것이고,
// 이 앱이 지키자고 만든 것과 정면으로 어긋난다.
//
// 그래서 id 자리를 이름으로 바꿔 보낸다. "어느 화면을 몇 번 봤는가"는 그대로
// 남고 "누구인지"는 빠진다 -- 통계로 알고 싶은 것은 앞의 것이다.
//
// 물음표 뒤는 통째로 버린다. 지금 쓰는 값이 code 뿐이라 그것만 지워도 되지만,
// 나중에 누가 조회용 값을 하나 더 붙일 때 여기를 같이 고칠 것이라고 기대할 수
// 없다. 남기지 않는 쪽을 기본으로 둔다.
const MEASUREMENT_ID = 'G-PMJFB4GY8V'

// 주소의 한 토막이 사람이 읽는 이름인가, 기계가 만든 id 인가.
//
// 이 앱의 id 는 uuid(면접방·공고·지원서)와 숫자다. 둘 다 아래에서 걸린다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIGITS = /^\d+$/

function looksLikeId(segment) {
  return UUID.test(segment) || DIGITS.test(segment)
}

// 화면 이름표. 주소에서 id 를 뺀 모양이다.
//
//   /rooms/8f3a.../contract  ->  /rooms/:roomId/contract
//   /jobs/1/apply            ->  /jobs/:id/apply
//
// 알려진 화면은 이름을 정해 두고, 그 밖의 것은 id 로 보이는 토막만 :id 로
// 바꾼다. 새 화면이 생겨도 여기를 고치지 않아 id 가 새는 일이 없게 한다.
const KNOWN = [
  [/^\/rooms\/[^/]+\/contract$/, '/rooms/:roomId/contract'],
  [/^\/rooms\/[^/]+$/, '/rooms/:roomId'],
  [/^\/jobs\/[^/]+\/apply$/, '/jobs/:id/apply'],
  [/^\/jobs\/[^/]+$/, '/jobs/:id'],
]

export function redactPath(pathname) {
  const path = String(pathname || '/')
  for (const [pattern, label] of KNOWN) {
    if (pattern.test(path)) return label
  }
  return (
    path
      .split('/')
      .map((seg) => (looksLikeId(seg) ? ':id' : seg))
      .join('/') || '/'
  )
}

// 이 브라우저에서 태그가 살아 있는가.
//
// 광고 차단기가 gtag.js 를 막는 일이 흔하다. 그때 gtag 는 아예 없는 함수가
// 되므로, 부르기 전에 확인한다 -- 통계 때문에 화면이 죽으면 안 된다.
function ready() {
  return typeof window !== 'undefined' && typeof window.gtag === 'function'
}

export function trackPageView(pathname) {
  if (!ready()) return
  const page_path = redactPath(pathname)
  const fields = {
    page_path,
    // 주소창 그대로가 아니라 가린 주소를 보낸다. 비워 두면 태그가 현재 주소를
    // 스스로 채워 넣어 가린 의미가 없어진다.
    page_location: `${window.location.origin}${page_path}`,
    page_title: document.title,
  }

  // 먼저 덮어쓰고 나서 보낸다.
  //
  // set 을 건너뛰고 event 에만 실으면, 이 한 건만 가려지고 GA4 가 스스로 보내는
  // 나머지(세션 시작, 스크롤, 참여 시간)는 그때그때 주소 표시줄을 다시 읽어
  // 싣는다. 실제로 확인해 보니 방 화면을 열었을 때 uuid 가 그 경로로 나갔다.
  // set 은 이후 모든 신호에 적용되므로 여기서 한 번 덮어 둔다.
  window.gtag('set', fields)
  window.gtag('event', 'page_view', { ...fields, send_to: MEASUREMENT_ID })
}
