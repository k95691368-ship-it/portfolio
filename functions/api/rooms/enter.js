import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { createRoomAccess, roomAccessCookieHeader } from '../../_lib/roomAccess.js'
import { blockedWhenArchived } from '../../_lib/roomLifecycle.js'

// 공개: 초대코드만으로 면접방에 들어온다. 로그인 불필요.
//
// 지원은 로그인 없이 하고 접수번호로 현황을 조회하는데, 정작 면접방만
// 계정을 요구하고 있었다. 그리고 첫 화면에서 로그인으로 가는 길은 '회사 ·
// 채용 담당자 로그인' 하나뿐이라, 서류합격해서 임시 비밀번호를 받은 사람은
// 그 버튼이 자기 것이 아니라고 여겨 누르지 않는다. 면접방이 만들어져 있어도
// 들어갈 방법이 없었다.
//
// 코드는 6자리다(혼동 문자를 뺀 32자 알파벳). 조합이 10억 남짓이라 시간을
// 들이면 맞힐 수 있는 크기이므로, 맞히려는 시도 자체를 막는다.
const ATTEMPTS_PER_HOUR = 10

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

  // 코드를 찍어 맞히려는 시도를 막는다. 한도는 IP 단위로 건다.
  const allowed = await checkRateLimit(env, `room-enter:${ip}`, ATTEMPTS_PER_HOUR, 3600)
  if (!allowed) {
    return jsonError('입장 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  const body = await request.json().catch(() => null)
  const code = String(body?.inviteCode ?? '').trim().toUpperCase()
  if (!code) return jsonError('입장 코드를 입력해주세요.', 400)

  const room = await env.DB.prepare(
    'SELECT id, title, status, archived_at FROM interview_rooms WHERE invite_code = ?'
  )
    .bind(code)
    .first()

  // 없는 코드와 틀린 코드를 구분해 말하지 않는다. 구분해 주면 맞히는 일이
  // 쉬워진다.
  if (!room) return jsonError('입장 코드가 올바르지 않습니다. 회사에서 받은 코드를 확인해주세요.', 404)

  const archived = blockedWhenArchived(room, 'join')
  if (archived) return jsonError(archived, 409)

  const { token } = await createRoomAccess(env.DB, room.id, {
    ip,
    userAgent: (request.headers.get('User-Agent') || '').slice(0, 300) || null,
  })

  return jsonResponse(
    { ok: true, roomId: room.id, title: room.title },
    200,
    { 'Set-Cookie': roomAccessCookieHeader(token) }
  )
}
