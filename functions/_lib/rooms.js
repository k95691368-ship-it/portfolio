export async function getRoomParticipant(env, roomId, userId) {
  return env.DB.prepare('SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first()
}
