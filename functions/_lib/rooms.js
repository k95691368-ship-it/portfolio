export async function getRoomParticipant(env, roomId, userId) {
  return env.DB.prepare('SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first()
}

// 채용내정 판정에 쓸 회사 발화를 처음부터 읽는다.
//
// 화면에 뿌리는 메시지 목록을 그대로 판정에 넘기고 있었다. 그 목록은 최근
// 것부터 잘라 오는 창이라, 대화가 길어지면 확정을 성립시킨 문장이 창 밖으로
// 밀려난다. 그 순간 경고가 조용히 꺼진다 — 오래 협의한 방일수록, 그러니까
// 채용내정이 성립했을 가능성이 높은 방일수록 먼저 꺼진다.
//
// 그래서 판정은 화면과 다른 조회를 쓴다. 확정은 회사만 할 수 있으므로 회사
// 발화만 보고(대개 절반 이하다), 성립시킨 것은 처음 그렇게 말한 문장이므로
// 오래된 것부터 읽는다.
const OFFER_SCAN_LIMIT = 500

export async function loadCompanyMessages(env, roomId) {
  const { results } = await env.DB.prepare(
    `SELECT m.body, m.created_at, rp.role_in_room
       FROM chat_messages m
       JOIN room_participants rp ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
      WHERE m.room_id = ? AND rp.role_in_room = 'company'
      ORDER BY m.id ASC
      LIMIT ?`
  )
    .bind(roomId, OFFER_SCAN_LIMIT)
    .all()
  return results || []
}

// 참여 여부와 방 상태를 한 번에 읽는다.
//
// 보관 잠금을 넣으면서 대화 전송에 조회가 하나 늘었다 — 참여자 확인 한 번,
// 방 상태 한 번. 며칠 전 왕복 셋을 둘로 줄여 놓은 바로 그 자리다. 두 값은
// 같은 방에 대한 것이라 한 번에 읽을 수 있다.
//
// 참여하지 않았으면 role_in_room 이 NULL 로 온다. 방이 아예 없으면 행이 없다.
export async function getRoomParticipation(env, roomId, userId) {
  return env.DB.prepare(
    `SELECT r.id, r.title, r.status, r.archived_at, r.last_message_email_at, rp.role_in_room
       FROM interview_rooms r
       LEFT JOIN room_participants rp ON rp.room_id = r.id AND rp.user_id = ?
      WHERE r.id = ?`
  )
    .bind(userId, roomId)
    .first()
}

// 열람 권한: 참여자면 그 역할, 참여자가 아니어도 관리자면 'admin'(읽기 전용 열람).
// 쓰기(메시지 전송, 분석, 서명 등)에는 사용하지 말 것 — 그건 getRoomParticipant로 참여자만 허용.
export async function getRoomAccess(env, roomId, user) {
  if (!user) return null
  const participant = await getRoomParticipant(env, roomId, user.id)
  if (participant) return participant
  if (user.is_admin) return { role_in_room: 'admin' }
  return null
}
