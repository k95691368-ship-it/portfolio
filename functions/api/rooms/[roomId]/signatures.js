import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const { results } = await env.DB.prepare(
    `SELECT s.signer_role, s.image_data_url, s.signed_at, u.display_name
     FROM signatures s
     JOIN users u ON u.id = s.signer_user_id
     WHERE s.room_id = ?`
  )
    .bind(params.roomId)
    .all()

  return jsonResponse({
    signatures: results.map((r) => ({
      role: r.signer_role,
      imageDataUrl: r.image_data_url,
      signedAt: r.signed_at,
      displayName: r.display_name,
    })),
  })
}
