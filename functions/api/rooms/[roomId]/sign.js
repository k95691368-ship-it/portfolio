import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { genId } from '../../../_lib/db.js'

const MAX_DATA_URL_LENGTH = 2_000_000

export async function onRequestPost({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await env.DB.prepare(
    'SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?'
  )
    .bind(params.roomId, data.user.id)
    .first()
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const contract = await env.DB.prepare('SELECT hire_confirmed FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  if (!contract?.hire_confirmed) return jsonError('아직 채용이 확정되지 않아 서명할 수 없습니다.', 400)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

  const imageDataUrl = body.imageDataUrl
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    return jsonError('서명 이미지가 올바르지 않습니다.', 400)
  }
  if (imageDataUrl.length > MAX_DATA_URL_LENGTH) {
    return jsonError('서명 이미지 용량이 너무 큽니다.', 400)
  }

  await env.DB.prepare(
    `INSERT INTO signatures (id, room_id, signer_user_id, signer_role, image_data_url, signed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(room_id, signer_role) DO UPDATE SET
       signer_user_id = excluded.signer_user_id,
       image_data_url = excluded.image_data_url,
       signed_at = datetime('now')`
  )
    .bind(genId(), params.roomId, data.user.id, participant.role_in_room, imageDataUrl)
    .run()

  const { results: sigs } = await env.DB.prepare('SELECT signer_role FROM signatures WHERE room_id = ?')
    .bind(params.roomId)
    .all()

  const roles = new Set(sigs.map((s) => s.signer_role))
  const bothSigned = roles.has('company') && roles.has('candidate')

  if (bothSigned) {
    await env.DB.prepare("UPDATE interview_rooms SET status = 'signed' WHERE id = ?")
      .bind(params.roomId)
      .run()
  }

  return jsonResponse({ ok: true, signerRole: participant.role_in_room, bothSigned })
}
