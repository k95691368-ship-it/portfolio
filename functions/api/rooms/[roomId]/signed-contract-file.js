import { jsonError, contentDisposition, FILE_CACHE_HEADERS } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { markDownloaded } from '../../../_lib/delivery.js'

// 저장된 서명 완료 계약서 PDF 다운로드 (면접방 참여자 양측 모두 가능).
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const row = await env.DB.prepare(
    'SELECT r2_key, filename FROM signed_contracts WHERE room_id = ?'
  )
    .bind(params.roomId)
    .first()
  if (!row) return jsonError('저장된 계약서가 없습니다.', 404)

  const object = await env.DOCUMENTS.get(row.r2_key)
  if (!object) return jsonError('계약서 파일을 찾을 수 없습니다.', 404)

  // 근로자가 직접 내려받은 것은 교부가 닿았다는 가장 분명한 기록이다.
  if (participant.role_in_room === 'candidate') {
    await markDownloaded(env, params.roomId, data.user.id)
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(row.filename),
      ...FILE_CACHE_HEADERS,
    },
  })
}
