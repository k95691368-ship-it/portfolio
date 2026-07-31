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
      // 번역본도 방을 참조한다. 빠뜨리면 번역한 적 있는 방은 삭제가 실패한다.
      env.DB.prepare('DELETE FROM contract_translations WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM interview_summaries WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM signature_revocations WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM contract_deliveries WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM audit_certificates WHERE room_id = ?').bind(params.roomId),
      // 알림은 방을 외래키로 참조하지 않지만 링크로 가리킨다. 남겨두면 사용자
      // 알림함에 눌러도 404가 나는 항목이 영영 남는다.
      env.DB.prepare("DELETE FROM notifications WHERE link LIKE ?").bind(`/rooms/${params.roomId}%`),
      // 이 방을 이전 계약으로 삼은 갱신 계약이 있으면 연결부터 끊어야 한다.
      env.DB.prepare('UPDATE contract_terms SET previous_room_id = NULL WHERE previous_room_id = ?').bind(params.roomId),
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
