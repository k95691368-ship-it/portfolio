import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess } from '../../../_lib/rooms.js'
import { buildAuditEvents } from '../../../_lib/auditTrail.js'
import { mapRequestRow } from '../../../_lib/changeRequests.js'
import { findLanguage } from '../../../_lib/languages.js'
import { listDeliveries } from '../../../_lib/delivery.js'

// 감사추적: 면접방 생성부터 서명·보관·발송까지의 전 과정을 시간순으로 반환.
// 참여자 양측 + 관리자(열람)가 볼 수 있다.
// (계약서 화면은 contract-view 통합 조회로 같은 내용을 함께 받는다)
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const access = await getRoomAccess(env, params.roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const [
    room,
    participants,
    terms,
    history,
    signatures,
    signedContract,
    finalOffer,
    revocations,
    changeRequests,
    translations,
    certificates,
  ] = await Promise.all([
      env.DB.prepare('SELECT title, created_at FROM interview_rooms WHERE id = ?')
        .bind(params.roomId)
        .first(),
      env.DB.prepare(
        `SELECT u.display_name, rp.role_in_room, rp.joined_at
         FROM room_participants rp JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = ?`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        `SELECT hire_confirmed_at, last_analyzed_at,
                employment_ended_at, employment_end_reason, employment_end_recorded_at
           FROM contract_terms WHERE room_id = ?`
      )
        .bind(params.roomId)
        .first(),
      env.DB.prepare(
        `SELECT h.created_at, u.display_name, h.changes
         FROM contract_edit_history h JOIN users u ON u.id = h.editor_user_id
         WHERE h.room_id = ? ORDER BY h.id ASC`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        `SELECT s.signer_role, s.signed_at, s.signer_ip, s.signer_user_agent, s.signer_country,
                u.display_name
         FROM signatures s JOIN users u ON u.id = s.signer_user_id
         WHERE s.room_id = ?`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        'SELECT created_at, emailed_at, sha256_hash, filename FROM signed_contracts WHERE room_id = ?'
      )
        .bind(params.roomId)
        .first(),
      env.DB.prepare('SELECT sent_at, status FROM final_offer_emails WHERE room_id = ?')
        .bind(params.roomId)
        .first(),
      env.DB.prepare(
        `SELECT signer_role, revoked_at, reason FROM signature_revocations
          WHERE room_id = ? ORDER BY id ASC`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        `SELECT field, status, created_at, resolved_at FROM contract_change_requests
          WHERE room_id = ? ORDER BY id ASC`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare('SELECT language, created_at FROM contract_translations WHERE room_id = ?')
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        'SELECT serial, issued_at FROM audit_certificates WHERE room_id = ? ORDER BY issued_at ASC LIMIT 20'
      )
        .bind(params.roomId)
        .all(),
    ])

  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  // 이 화면과 증명서가 같은 이력을 보여야 한다. 한쪽에만 사건이 실리면
  // "화면에는 있는데 증명서에는 없는" 이력이 생긴다.
  const deliveries = await listDeliveries(env, params.roomId)

  return jsonResponse({
    roomTitle: room.title,
    documentHash: signedContract?.sha256_hash ?? null,
    events: buildAuditEvents({
      room,
      participants: participants.results,
      terms,
      history: history.results,
      signatures: signatures.results,
      signedContract,
      finalOffer,
      revocations: revocations.results,
      changeRequests: changeRequests.results.map(mapRequestRow),
      deliveries,
      translations: translations.results.map((t) => ({
        language: t.language,
        nativeLabel: findLanguage(t.language)?.nativeLabel ?? t.language,
        createdAt: t.created_at,
      })),
      certificates: certificates.results.map((c) => ({ serial: c.serial, issuedAt: c.issued_at })),
    }),
  })
}
