export async function getRoomParticipant(env, roomId, userId) {
  return env.DB.prepare('SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
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
