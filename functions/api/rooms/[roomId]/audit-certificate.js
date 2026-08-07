import { genId } from '../../../_lib/db.js'
import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess, getRoomParticipant } from '../../../_lib/rooms.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { mapRequestRow } from '../../../_lib/changeRequests.js'
import { findLanguage } from '../../../_lib/languages.js'
import { contractFingerprint } from '../../../_lib/contractDocument.js'
import { buildAuditEvents, describeSigningEnvironment } from '../../../_lib/auditTrail.js'
import { describeContractPeriod, describeRetention } from '../../../_lib/contractPeriod.js'
import { listDeliveries, describeDeliveryState } from '../../../_lib/delivery.js'
import {
  formatSerial,
  buildCertificate,
  canonicalizeCertificate,
  certificateFingerprint,
  resolveDocumentIdentity,
} from '../../../_lib/auditCertificate.js'

// 감사추적증명서 발급.
//
// 계약 이력을 계약서에서 떼어내 발급번호와 지문이 붙은 독립 문서로 만든다.
// 발급 시점의 사실을 그대로 동결해 보관하므로, 이후 계약 내용이 바뀌어도 발급된
// 증명서는 그대로 검증된다.
async function loadSource(env, roomId) {
  const [
    room,
    participants,
    termsRow,
    historyRows,
    signatureRows,
    storedRow,
    finalOffer,
    revocationRows,
    changeRequestRows,
    translationRows,
    certificateRows,
  ] = await Promise.all([
      env.DB.prepare('SELECT id, title, status, created_at FROM interview_rooms WHERE id = ?')
        .bind(roomId)
        .first(),
      env.DB.prepare(
        `SELECT u.display_name, u.company_name, rp.role_in_room, rp.joined_at
           FROM room_participants rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ?`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
      env.DB.prepare(
        `SELECT h.id, h.created_at, h.changes, u.display_name
           FROM contract_edit_history h JOIN users u ON u.id = h.editor_user_id
          -- 상한을 두면 그 뒤의 수정이 증명서에서 사라진 채로 해시된다.
          -- 이력을 증명한다면서 이력을 빠뜨리는 문서가 된다. 방 하나의 수정
          -- 이력은 room_id 인덱스로 읽히므로 전량을 읽어도 문제되지 않는다.
          WHERE h.room_id = ? ORDER BY h.id ASC`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        `SELECT signer_role, signed_at, signer_ip, signer_user_agent, signer_country,
                document_sha256, verified_email, session_started_at, verification_method
           FROM signatures WHERE room_id = ?`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        'SELECT sha256_hash, created_at FROM signed_contracts WHERE room_id = ?'
      )
        .bind(roomId)
        .first(),
      env.DB.prepare('SELECT sent_at, status FROM final_offer_emails WHERE room_id = ?')
        .bind(roomId)
        .first(),
      env.DB.prepare(
        `SELECT signer_role, signed_at, revoked_at, reason, document_sha256
           FROM signature_revocations WHERE room_id = ? ORDER BY id ASC`
      )
        .bind(roomId)
        .all(),
      // 이력에 함께 실어야 할 사건들. 각자의 표에만 남아 있어서 그동안
      // 증명서의 이력이 실제보다 성겼다.
      env.DB.prepare(
        `SELECT field, status, created_at, resolved_at
           FROM contract_change_requests WHERE room_id = ? ORDER BY id ASC`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        'SELECT language, created_at FROM contract_translations WHERE room_id = ?'
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        'SELECT serial, issued_at FROM audit_certificates WHERE room_id = ? ORDER BY issued_at ASC LIMIT 20'
      )
        .bind(roomId)
        .all(),
    ])

  return {
    room,
    participants: participants.results,
    termsRow,
    history: historyRows.results,
    signatures: signatureRows.results,
    storedRow,
    finalOffer,
    revocations: revocationRows.results,
    changeRequests: changeRequestRows.results.map(mapRequestRow),
    translations: translationRows.results.map((t) => {
      const lang = findLanguage(t.language)
      return {
        language: t.language,
        nativeLabel: lang?.nativeLabel ?? t.language,
        createdAt: t.created_at,
      }
    }),
    certificates: certificateRows.results.map((c) => ({ serial: c.serial, issuedAt: c.issued_at })),
  }
}

export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  // 발급은 열람과 다르다. 증명서에는 발급한 사람의 이름이 박히고, 그 문서가
  // 제3자에게 제시된다. getRoomAccess 는 참여하지 않은 관리자에게도 열람 권한을
  // 주므로, 발급까지 허용하면 계약 당사자가 아닌 사람이 발급자로 남는다.
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) {
    return jsonError('증명서는 계약 당사자만 발급할 수 있습니다.', 403)
  }

  const src = await loadSource(env, params.roomId)
  if (!src.room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (src.signatures.length === 0) {
    return jsonError('서명이 아직 없어 증명서를 발급할 수 없습니다.', 409)
  }

  const terms = rowToCamelTerms(src.termsRow)
  const currentSha256 = terms ? await contractFingerprint(terms) : null
  const deliveries = await listDeliveries(env, params.roomId)

  const document = resolveDocumentIdentity({
    signatures: src.signatures,
    storedPdfSha256: src.storedRow?.sha256_hash ?? null,
    currentSha256,
  })

  const lastSignedAt = src.signatures.map((s) => s.signed_at).filter(Boolean).sort().pop() ?? null

  const events = buildAuditEvents({
    room: src.room,
    participants: src.participants,
    terms: src.termsRow,
    history: src.history,
    signatures: src.signatures,
    signedContract: src.storedRow,
    finalOffer: src.finalOffer,
    revocations: src.revocations,
    changeRequests: src.changeRequests,
    deliveries,
    translations: src.translations,
    certificates: src.certificates,
  })

  // 발급 시각을 한 번만 만들어 증명서 본문과 저장 행이 같은 값을 쓰게 한다.
  const issuedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const serial = formatSerial(crypto.getRandomValues(new Uint8Array(12)))

  const certificate = buildCertificate({
    serial,
    issuedAt,
    issuedByName: data.user.display_name,
    room: src.room,
    participants: src.participants,
    signatures: src.signatures.map((s) => ({ ...s, environment: describeSigningEnvironment(s) })),
    revokedSignatures: src.revocations,
    deliveries,
    deliveryState: describeDeliveryState(deliveries),
    events,
    document,
    period: terms ? describeContractPeriod(terms) : null,
    // 보존 기간의 기산일은 근로관계가 끝난 날이다 (제42조·시행령 제22조 제2항).
    // 재직 중이면 기산일이 없는 것이 정상이고, 증명서는 그 사실을 그대로 적는다.
    retention: terms
      ? describeRetention(
          terms,
          lastSignedAt || src.storedRow?.created_at,
          new Date(),
          terms.employmentEndedAt
        )
      : null,
  })

  const canonicalText = canonicalizeCertificate(certificate)
  const certificateSha256 = await certificateFingerprint(canonicalText)

  await env.DB.prepare(
    `INSERT INTO audit_certificates
       (id, room_id, serial, issued_by_user_id, issued_at, document_sha256,
        certificate_sha256, canonical_text, snapshot_json, event_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      genId(),
      params.roomId,
      serial,
      data.user.id,
      issuedAt,
      document.signedSha256,
      certificateSha256,
      canonicalText,
      JSON.stringify(certificate),
      events.length
    )
    .run()

  return jsonResponse({ serial, issuedAt, certificateSha256, certificate, canonicalText }, 201)
}

// 이 면접방에서 발급된 증명서 목록
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const access = await getRoomAccess(env, params.roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const { results } = await env.DB.prepare(
    `SELECT serial, issued_at, certificate_sha256, document_sha256, event_count, revoked_at
       FROM audit_certificates WHERE room_id = ? ORDER BY issued_at DESC LIMIT 20`
  )
    .bind(params.roomId)
    .all()

  return jsonResponse({
    certificates: results.map((r) => ({
      serial: r.serial,
      issuedAt: r.issued_at,
      certificateSha256: r.certificate_sha256,
      documentSha256: r.document_sha256,
      eventCount: r.event_count,
      revokedAt: r.revoked_at,
    })),
  })
}
