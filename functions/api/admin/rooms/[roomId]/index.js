import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { logAdminAction } from '../../../../_lib/auditLog.js'
import { rowToCamelTerms } from '../../../../_lib/contract.js'
import { describeRetention, describeRetentionHold } from '../../../../_lib/contractPeriod.js'
import {
  InterviewDeletionError,
  acquireInterviewRoomDeletionLocks,
  inspectInterviewRoomDeletion,
  prepareInterviewRoomDeletion,
  releaseInterviewRoomDeletionLocks,
} from '../../../../_lib/interviewDeletion.js'

export async function onRequestDelete({ request, env, data, params }) {
  const room = await env.DB.prepare('SELECT id, title, status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  // 체결된 근로계약서는 근로관계가 끝난 날부터 3년간 보존해야 한다
  // (근로기준법 제42조, 시행령 제22조 제2항). 지금까지 이 삭제에는 그 검사가
  // 없어서, 보존 의무가 남은 계약서도 클릭 한 번에 사라졌다.
  //
  // 완전히 막지는 않는다 — 잘못 만들어진 방, 시험용 데이터처럼 지워야 하는
  // 경우가 실제로 있다. 대신 무엇을 지우는지 알린 뒤 명시적으로 다시 요청하게
  // 하고, 그 사실을 감사 로그에 남긴다.
  const termsRow = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  const lastSignature = await env.DB.prepare(
    'SELECT signed_at FROM signatures WHERE room_id = ? ORDER BY signed_at DESC LIMIT 1'
  )
    .bind(params.roomId)
    .first()
  const terms = rowToCamelTerms(termsRow)
  const retention = terms
    ? describeRetention(terms, lastSignature?.signed_at, new Date(), terms.employmentEndedAt)
    : null
  const hold = describeRetentionHold(retention, room.status === 'signed')

  const body = await request.json().catch(() => null)
  const acknowledged = body?.acknowledgeRetention === true
  if (hold.held && !acknowledged) {
    return jsonError(
      `보존 의무가 남아 있는 계약서입니다. ${hold.reason} 체결된 근로계약서 정본은 영구 보관소에 남아 삭제되지 않습니다. 그래도 이 면접방(대화·지원서 연결)을 지우려면 보존 의무를 확인했음을 함께 보내주세요.`,
      409
    )
  }

  // 화상 면접 정리 가능 여부와 R2 삭제를 첫 mutation보다 먼저 확정한다.
  // 이 검사가 뒤에 있으면 차단 응답인데도 계약 보관 기록이나 PDF가 먼저
  // 변경되는 부분 삭제가 발생할 수 있다.
  let deletionLock = null
  try {
    // 첫 검사는 mutation 없이 현재 상태를 확인한다. 이어 D1 잠금을 잡고 다시
    // 검사하므로, 검사와 삭제 사이에 시작된 세션도 놓치지 않는다.
    await inspectInterviewRoomDeletion(env, [params.roomId])
    deletionLock = await acquireInterviewRoomDeletionLocks(
      env,
      [params.roomId],
      crypto.randomUUID()
    )
    await prepareInterviewRoomDeletion(env, [params.roomId])
  } catch (error) {
    if (deletionLock) {
      await releaseInterviewRoomDeletionLocks(env, deletionLock).catch((releaseError) => {
        console.error(`Interview room deletion lock release failed (${params.roomId}):`, releaseError)
      })
    }
    if (error instanceof InterviewDeletionError) return jsonError(error.message, error.status)
    throw error
  }

  // 영구 보관소는 건드리지 않는다.
  //
  // 보존 의무의 대상은 '면접방' 이 아니라 '계약서' 다. 방은 대화하던 자리일
  // 뿐이고, 그 자리를 치웠다고 해서 맺은 계약이 없던 일이 되지는 않는다
  // (근로기준법 제42조). contract_archive 는 방을 외래키로 참조하지 않으므로
  // 아래 삭제가 이 표에 닿지 않는다 -- 참조했다면 함께 지우거나(보관이 아니다)
  // 삭제가 실패하거나(방을 못 지운다) 둘 중 하나였을 것이다.
  //
  // 방이 사라졌다는 사실만 적어 둔다. 나중에 "이 계약서는 왜 방이 없는가" 에
  // 답할 수 있어야 한다.
  await env.DB.prepare(
    "UPDATE contract_archive SET source_deleted_at = datetime('now'), updated_at = datetime('now') WHERE room_id = ?"
  )
    .bind(params.roomId)
    .run()
    .catch((err) => console.error('archive stamp failed:', err))

  // 회사가 올린 PDF 사본만 정리한다. 영구 보관소의 정본은 다른 자리
  // (archive/ 로 시작하는 키)에 있고 여기서 지우지 않는다.
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
      // 방 수명 기록(0044)도 방을 외래키로 참조한다.
      env.DB.prepare('DELETE FROM room_lifecycle_log WHERE room_id = ?').bind(params.roomId),
      // 알림은 방을 외래키로 참조하지 않지만 링크로 가리킨다. 남겨두면 사용자
      // 알림함에 눌러도 404가 나는 항목이 영영 남는다.
      env.DB.prepare("DELETE FROM notifications WHERE link LIKE ?").bind(`/rooms/${params.roomId}%`),
      // 이 방을 이전 계약으로 삼은 갱신 계약이 있으면 연결부터 끊어야 한다.
      env.DB.prepare('UPDATE contract_terms SET previous_room_id = NULL WHERE previous_room_id = ?').bind(params.roomId),
      // 화상 면접 표는 세션 아래에 여러 단계로 매달린다. 가장 아래의 열람
      // 기록부터 지워야 D1 외래키 검사에 걸리지 않는다.
      env.DB.prepare(
        `DELETE FROM recording_access_logs
          WHERE recording_id IN (
            SELECT r.id FROM interview_recordings r
            JOIN interview_sessions s ON s.id = r.session_id
            WHERE s.room_id = ?
          )`
      ).bind(params.roomId),
      env.DB.prepare(
        'DELETE FROM interview_events WHERE session_id IN (SELECT id FROM interview_sessions WHERE room_id = ?)'
      ).bind(params.roomId),
      env.DB.prepare(
        'DELETE FROM interview_recording_consents WHERE session_id IN (SELECT id FROM interview_sessions WHERE room_id = ?)'
      ).bind(params.roomId),
      env.DB.prepare(
        'DELETE FROM interview_recordings WHERE session_id IN (SELECT id FROM interview_sessions WHERE room_id = ?)'
      ).bind(params.roomId),
      env.DB.prepare(
        'DELETE FROM interview_session_members WHERE session_id IN (SELECT id FROM interview_sessions WHERE room_id = ?)'
      ).bind(params.roomId),
      env.DB.prepare('DELETE FROM interview_sessions WHERE room_id = ?').bind(params.roomId),
      // 0050의 옛 코드 입장 세션도 방을 참조한다. 지금은 발급하지 않지만
      // 남아 있는 기록 하나만으로도 방 삭제가 실패할 수 있다.
      env.DB.prepare('DELETE FROM room_access_sessions WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM contract_edit_history WHERE room_id = ?').bind(params.roomId),
      // 처우 협의 이력(0047)도 방을 외래키로 참조한다.
      env.DB.prepare('DELETE FROM negotiation_log WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM final_offer_emails WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM chat_messages WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM signatures WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM contract_terms WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM room_participants WHERE room_id = ?').bind(params.roomId),
      env.DB.prepare('DELETE FROM interview_rooms WHERE id = ?').bind(params.roomId),
    ])
  } catch (err) {
    console.error(`Room delete failed (${params.roomId}):`, err)
    if (deletionLock) {
      await releaseInterviewRoomDeletionLocks(env, deletionLock).catch((releaseError) => {
        console.error(`Interview room deletion lock release failed (${params.roomId}):`, releaseError)
      })
    }
    return jsonError('면접방 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 500)
  }

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'delete_room',
    // 보존 의무를 넘겨 지운 사실은 반드시 남긴다. 남지 않으면 나중에
    // "왜 그 계약서가 없는가"에 답할 수 없다.
    detail: hold.held
      ? `title=${room.title} · 보존의무 확인 후 삭제 (보존기한 ${retention?.until ?? '미정'})`
      : `title=${room.title}`,
  })

  return jsonResponse({ ok: true, deleted: true })
}
