const API_BASE = '/api'

// 어느 문으로 방에 들어왔는가.
//
// 한 컴퓨터에 회사 계정과 면접방 코드가 함께 있을 수 있다 — 담당자가 회사
// 계정으로 일하다가 구직자 홈에서 코드를 넣어 보는 경우다. 쿠키는 둘 다
// 브라우저에 남으므로, 서버는 어느 쪽으로 들어온 사람인지 스스로 알 수 없다.
//
// 그래서 마지막으로 연 문을 여기서 기억해 두고 방 요청에 붙여 보낸다.
//   구직자 홈에서 코드로 들어가면 -> 그 방은 지원자로
//   채용자 홈에서 방을 열면      -> 그 방은 회사 계정으로
// 새로고침하고 브라우저를 닫았다 열어도 유지되어야 하므로 localStorage 에 둔다.
// 신원 자체가 아니라 '어느 문'인지만 담는다 — 여기 값을 바꿔도 서버가 주는
// 권한은 달라지지 않는다. 쿠키가 없으면 아무것도 열리지 않는다.
const DOOR_KEY = 'roomDoor'

function readDoor() {
  try {
    const raw = localStorage.getItem(DOOR_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function markRoomDoor(roomId, door) {
  try {
    if (!roomId) return
    localStorage.setItem(DOOR_KEY, JSON.stringify({ roomId, door }))
  } catch {
    /* 저장이 막힌 브라우저에서도 방은 열려야 한다 */
  }
}

export function roomDoorFor(roomId) {
  const saved = readDoor()
  return saved && saved.roomId === roomId ? saved.door : null
}

// 이 요청이 코드로 들어간 그 방에 대한 것인가.
function codeIdentityHeader(path) {
  const match = path.match(/^\/rooms\/([^/]+)\/.+/)
  if (!match) return null
  return roomDoorFor(decodeURIComponent(match[1])) === 'code'
    ? { 'X-Room-Identity': 'code' }
    : null
}

// 서버 응답을 사용자에게 보여줄 오류로 변환한다.
// 권한 거부(403)는 항상 "권한 없음"으로 시작하게 맞춰, 어떤 화면에서 막히든
// 같은 문구로 인지되도록 한다. 상태 코드 자체는 절대 노출하지 않는다.
function toUserError(res, data) {
  let message = data?.error || '요청에 실패했습니다.'
  if (res.status === 403 && !message.startsWith('권한 없음')) {
    message = `권한 없음 — ${message}`
  }
  const error = new Error(message)
  error.status = res.status
  // 서버가 함께 보낸 내용을 버리고 있었다. 그래서 화면은 같은 409 를 모두
  // 같은 뜻으로 읽을 수밖에 없었고, "확인이 필요하다"와 "이미 처리되었다"가
  // 구별되지 않아 사실이 아닌 경고창이 떴다.
  error.data = data ?? null
  return error
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...codeIdentityHeader(path),
      ...(options.headers || {}),
    },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw toUserError(res, data)
  return data
}

async function upload(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...codeIdentityHeader(path) },
    body: formData,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw toUserError(res, data)
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // DELETE에도 본문을 실을 수 있어야 한다 — 보존 의무처럼 "알고도 지운다"는
  // 확인을 서버가 받아야 하는 경우가 있다.
  delete: (path, body) =>
    request(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) }),
  upload,
}
