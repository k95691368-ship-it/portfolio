// 코드만으로 들어온 사람의 출입증.
//
// 계정 세션과 이름을 나눠 둔다. 이것은 "이 사람이 누구인가"가 아니라
// "이 방 하나를 열 수 있는 코드를 가지고 있다"는 뜻이다. 그 차이가 무엇을
// 허용할지를 가른다.
//
//   볼 수 있다 — 방, 대화, 계약 조건, 이미 저장된 계약서.
//   할 수 있다 — 대화.
//   할 수 없다 — 서명.
//
// 서명을 막는 이유는 이 앱의 존재 이유와 같다. 서명 기록은 "누가 무엇에
// 동의했는가"를 증명하려고 만든 것이고, 그래서 서명할 때마다 계정 이메일과
// 로그인 시각과 인증 방법을 함께 남긴다. 코드는 그 셋 중 무엇도 말해 주지
// 않는다. 코드를 건네받은 사람이면 누구나 근로자 서명을 만들 수 있다면,
// 그 서명은 증거가 아니라 서명 모양의 그림일 뿐이다.
//
// 대신 서명 화면에서 "임시 비밀번호로 로그인해 주세요"로 이어 준다. 계정은
// 서류합격 처리 때 이미 만들어져 있다.

import { sha256Hex, toBase64Url } from './auth.js'

// 출입증 수명. 면접과 계약 협의가 며칠에 걸쳐 이어지므로 한 번 들어오면
// 그동안은 다시 코드를 넣지 않아도 되게 한다.
const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 14 // 14일

export const ROOM_ACCESS_COOKIE = 'room_access'

export function roomAccessCookieHeader(token) {
  return `${ROOM_ACCESS_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ACCESS_TTL_SECONDS}`
}

export function clearRoomAccessCookieHeader() {
  return `${ROOM_ACCESS_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export async function createRoomAccess(db, roomId, { ip, userAgent } = {}) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString()

  // 죽은 출입증은 아무도 치우지 않으면 영원히 쌓인다. 따로 도는 청소 작업이
  // 없는 환경이라 새로 만들 때 이 방의 만료된 것을 함께 치운다.
  await db
    .prepare("DELETE FROM room_access_sessions WHERE room_id = ? AND datetime(expires_at) <= datetime('now')")
    .bind(roomId)
    .run()
    .catch(() => {})

  await db
    .prepare(
      `INSERT INTO room_access_sessions (token_hash, room_id, entered_ip, entered_user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(tokenHash, roomId, ip ?? null, userAgent ?? null, expiresAt)
    .run()

  return { token, expiresAt }
}

// 이 요청이 어느 방의 출입증을 가지고 있는가. 없으면 null.
//
// 만료 비교를 datetime() 으로 감싼다. expires_at 은 JS 의 toISOString() 이라
// 'T' 가 들어 있고 datetime('now') 는 공백이라, 문자열로 비교하면 만료 당일에
// 몇 시간이 지나도 살아 있다 — 계정 세션에서 이미 한 번 겪은 자리다.
export async function getRoomAccess(db, token) {
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await db
    .prepare(
      `SELECT room_id, created_at FROM room_access_sessions
        WHERE token_hash = ? AND datetime(expires_at) > datetime('now')`
    )
    .bind(tokenHash)
    .first()
  if (!row) return null
  return { roomId: row.room_id, enteredAt: row.created_at }
}

// 이 요청이 그 방을 코드로 열 수 있는가.
export function hasRoomAccess(data, roomId) {
  return !!data?.roomAccess && data.roomAccess.roomId === roomId
}
