import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { logAdminAction } from '../../../../_lib/auditLog.js'

export async function onRequestDelete({ env, data, params }) {
  const room = await env.DB.prepare('SELECT id, title FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  // 보관된 서명 계약서 PDF가 있으면 R2 객체도 함께 정리
  const signedContract = await env.DB.prepare(
    'SELECT r2_key FROM signed_contracts WHERE room_id = ?'
  )
    .bind(params.roomId)
    .first()
  if (signedContract) {
    await env.DOCUMENTS.delete(signedContract.r2_key).catch(() => {})
  }

  // documents belong to the user, not the room (a candidate's resume can be shared
  // across rooms), so they're intentionally left untouched here.
  // D1은 외래키를 강제하므로 이 방을 참조하는 모든 행을 함께 정리해야 한다.
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE applications SET room_id = NULL WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('UPDATE admin_audit_log SET target_room_id = NULL WHERE target_room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM signed_contracts WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM contract_change_requests WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM contract_edit_history WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM final_offer_emails WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM chat_messages WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM signatures WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM contract_terms WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM room_participants WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM interview_rooms WHERE id = ?').bind(params.roomId),
    ])
  } catch (err) {
    console.error(`Room delete failed (${params.roomId}):`, err)
    return jsonError('면접방 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 500)
  }

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'delete_room',
    detail: `title=${room.title}`,
  })

  return jsonResponse({ ok: true, deleted: true })
}
