import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { createSession, roomSessionCookieHeader } from '../../_lib/auth.js'
import { blockedWhenArchived } from '../../_lib/roomLifecycle.js'
import { normalizeInviteCode } from '../../_lib/inviteCode.js'

// 공개: 면접방 입장 코드로 들어온다. 그 방 지원자로 로그인된다.
//
// 지원은 로그인 없이 하고 접수번호로 현황을 조회하는데, 정작 면접방만 계정을
// 요구하고 있었다. 게다가 첫 화면에서 로그인으로 가는 길은 '회사 · 채용
// 담당자 로그인' 하나뿐이라, 서류합격한 지원자가 그 버튼을 누를 이유가 없다.
// 면접방이 만들어져 있어도 들어갈 방법이 없었던 것이다.
//
// 처음에는 계정과 별개인 '방 출입증'으로 만들었다. 그것이 잘못이었다.
// 신원 판정이 미들웨어·rooms·messages 세 층에 흩어졌고, 회사 계정으로
// 로그인한 브라우저에서는 출입증이 조용히 무시되어 지원자가 친 말이 회사
// 발화로 저장됐다. 그러면 대화를 훑어 채용내정 성립을 판정하는 이 앱의 핵심이
// 거꾸로 돈다.
//
// 고친 방향은 '신원을 하나로'가 아니라 '판정을 한 곳으로'다. 한 컴퓨터에 두
// 신원이 함께 있는 것은 실제로 일어나는 일이기 때문이다 — 담당자가 회사
// 계정으로 일하다가 구직자 홈에서 코드를 넣어 본다. 계정 쿠키를 덮어 버리면
// 그 순간 회사 로그인이 죽는다.
//
// 그래서 코드 세션은 이름이 다른 쿠키(room_session)에 담고, 발급된 방
// id 를 세션에 박아 둔다. 어느 쪽을 쓸지는 미들웨어 한 곳에서만 고른다.
//   채용자 홈에서 방을 열면 -> 회사 계정
//   구직자 홈에서 코드로 들어오면 -> 그 방의 지원자
//
// 코드가 곧 비밀번호이므로 맞히려는 시도를 IP 단위로 막는다.
const ATTEMPTS_PER_HOUR = 10

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

  const allowed = await checkRateLimit(env, `room-enter:${ip}`, ATTEMPTS_PER_HOUR, 3600)
  if (!allowed) {
    return jsonError('입장 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)
  }

  // 메일에서 눈으로 읽어 손으로 치는 값이다. 하이픈째 붙여 넣거나 공백이
  // 섞이거나 소문자로 치는 것으로 막히면 회사에 다시 물어야 한다.
  const body = await request.json().catch(() => null)
  const code = normalizeInviteCode(body?.inviteCode)
  if (!code) return jsonError('입장 코드를 입력해주세요.', 400)

  const room = await env.DB.prepare(
    'SELECT id, title, status, archived_at FROM interview_rooms WHERE invite_code = ?'
  )
    .bind(code)
    .first()

  // 없는 코드와 틀린 코드를 구분해 말하지 않는다. 구분해 주면 맞히기 쉬워진다.
  if (!room) return jsonError('입장 코드가 올바르지 않습니다. 회사에서 받은 코드를 확인해주세요.', 404)

  const archived = blockedWhenArchived(room, 'join')
  if (archived) return jsonError(archived, 409)

  // 이 방의 지원자로 로그인한다.
  //
  // 서류합격 처리 때 계정과 참여자 행이 함께 만들어지므로, 코드를 받은 사람은
  // 이미 이 방의 지원자다. 회사가 직접 만든 방처럼 지원자가 아직 없는 방에는
  // 로그인할 대상 자체가 없다 — 그 방은 초대 흐름을 쓴다.
  const candidate = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.is_suspended
       FROM room_participants rp JOIN users u ON u.id = rp.user_id
      WHERE rp.room_id = ? AND rp.role_in_room = 'candidate' LIMIT 1`
  )
    .bind(room.id)
    .first()
  if (!candidate) {
    return jsonError(
      '이 면접방에는 아직 지원자가 등록되어 있지 않습니다. 회사에 문의해주세요.',
      409
    )
  }
  if (candidate.is_suspended) return jsonError('정지된 계정입니다. 관리자에게 문의해주세요.', 403)

  // 코드로 만든 세션이라는 사실과, 그 코드가 어느 방의 것인지를 남긴다.
  // 앞의 것은 서명 기록의 인증 방법에 그대로 적히고, 뒤의 것은 이 세션이
  // 다른 방이나 대시보드로 번지지 않게 막는다.
  const { token } = await createSession(env.DB, candidate.id, {
    persistent: true,
    authMethod: 'invite_code',
    scopedRoomId: room.id,
  })

  return jsonResponse(
    {
      ok: true,
      roomId: room.id,
      title: room.title,
      displayName: candidate.display_name,
    },
    200,
    { 'Set-Cookie': roomSessionCookieHeader(token) }
  )
}
