import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess } from '../../../_lib/rooms.js'
import { rowToCamelTerms, buildArticlesFromTerms } from '../../../_lib/contract.js'
import { buildAuditEvents, describeSigningEnvironment } from '../../../_lib/auditTrail.js'
import { maskEmail, isEmailConfigured } from '../../../_lib/email.js'
import { mapRequestRow } from '../../../_lib/changeRequests.js'
import {
  checkLegalCompliance,
  findMissingFields,
  diffAgreedVsCurrent,
} from '../../../_lib/contractCheck.js'
import {
  describeContractPeriod,
  checkPeriodCompliance,
  describeContinuousEmployment,
  checkContinuityCompliance,
  describeRetention,
} from '../../../_lib/contractPeriod.js'
import { checkContractDocument } from '../../../_lib/documentCheck.js'

// 갱신 사슬을 거슬러 올라가는 최대 깊이 (link-previous의 제한과 같아야 한다)
const MAX_CHAIN_DEPTH = 10
import { findLanguage } from '../../../_lib/languages.js'

// 계약서 화면이 필요한 모든 정보를 한 번에 돌려준다.
//
// 이전에는 방 정보·계약 조건·서명·수정 이력·감사추적·서명 전 점검·보관 계약서를
// 각각 따로 요청했는데, 감사추적이 나머지가 읽는 표를 대부분 다시 읽는 데다
// 요청마다 세션 인증까지 반복돼 한 페이지에 D1 조회가 스무 번 넘게 발생했다.
// 여기서 한 번만 읽고 나눠서 돌려준다.
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const access = await getRoomAccess(env, params.roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const roomId = params.roomId
  const [
    room,
    participants,
    termsRow,
    historyRows,
    signatureRows,
    storedRow,
    finalOffer,
    changeRequestRows,
    translationRows,
  ] = await Promise.all([
      env.DB.prepare('SELECT id, title, invite_code, status, created_at FROM interview_rooms WHERE id = ?')
        .bind(roomId)
        .first(),
      env.DB.prepare(
        `SELECT u.id, u.display_name, u.company_name, u.email, rp.role_in_room, rp.joined_at
         FROM room_participants rp JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = ?`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
      env.DB.prepare(
        `SELECT h.id, h.created_at, h.changes, h.source, u.display_name, rp.role_in_room AS editor_role
         FROM contract_edit_history h
         JOIN users u ON u.id = h.editor_user_id
         LEFT JOIN room_participants rp ON rp.room_id = h.room_id AND rp.user_id = h.editor_user_id
         WHERE h.room_id = ? ORDER BY h.id ASC LIMIT 100`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        `SELECT s.signer_role, s.image_data_url, s.signed_at, s.signer_ip,
                s.signer_user_agent, s.signer_country, u.display_name
         FROM signatures s JOIN users u ON u.id = s.signer_user_id
         WHERE s.room_id = ?`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        `SELECT filename, size_bytes, sha256_hash, email_status, emailed_at, created_at
         FROM signed_contracts WHERE room_id = ?`
      )
        .bind(roomId)
        .first(),
      env.DB.prepare('SELECT sent_at, status FROM final_offer_emails WHERE room_id = ?')
        .bind(roomId)
        .first(),
      env.DB.prepare(
        `SELECT c.*, u.display_name AS requester_name
         FROM contract_change_requests c
         JOIN users u ON u.id = c.requested_by_user_id
         WHERE c.room_id = ? ORDER BY c.id DESC LIMIT 50`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        'SELECT language, articles_json, created_at FROM contract_translations WHERE room_id = ?'
      )
        .bind(roomId)
        .all(),
    ])

  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const participantRows = participants.results
  const history = historyRows.results
  const signatures = signatureRows.results
  const terms = rowToCamelTerms(termsRow)
  const isSigned = room.status === 'signed'

  // 수정 이력은 오래된 것부터라 그대로 합의값 비교에 쓸 수 있다.
  const parsedHistory = history.map((h) => {
    try {
      return { changes: JSON.parse(h.changes), source: h.source }
    } catch {
      return { changes: [], source: h.source }
    }
  })

  // 계약 기간 상태는 체결 전후 모두 필요하다 (체결 후에는 만료 관리에 쓰인다).
  const period = terms ? describeContractPeriod(terms) : null
  const candidateRow = participantRows.find((p) => p.role_in_room === 'candidate')

  // 갱신으로 이어진 계약이 있으면 계속근로기간을 합산해야 2년 상한을 제대로 본다.
  // 이어진 계약이 없을 때는 조회 자체를 하지 않는다.
  let continuity = { linked: false, count: termsRow ? 1 : 0 }
  if (termsRow?.previous_room_id) {
    const { results: chain } = await env.DB.prepare(
      `WITH RECURSIVE chain(room_id, previous_room_id, depth) AS (
         SELECT room_id, previous_room_id, 0 FROM contract_terms WHERE room_id = ?1
         UNION ALL
         SELECT ct.room_id, ct.previous_room_id, chain.depth + 1
           FROM contract_terms ct, chain
          WHERE ct.room_id = chain.previous_room_id AND chain.depth < ?2
       )
       SELECT chain.depth, ct.room_id, ct.contract_start_date, ct.contract_end_date, r.title
         FROM chain
         JOIN contract_terms ct ON ct.room_id = chain.room_id
         JOIN interview_rooms r ON r.id = chain.room_id
        ORDER BY chain.depth DESC`
    )
      .bind(roomId, MAX_CHAIN_DEPTH)
      .all()
    continuity = describeContinuousEmployment(
      chain.map((c) => ({
        roomId: c.room_id,
        title: c.title,
        startDate: c.contract_start_date,
        endDate: c.contract_end_date,
      }))
    )
    continuity.previousRoomId = termsRow.previous_room_id
    // 위 조회는 열 단계까지만 거슬러 올라간다. 거기서 끊겼다면 합산된 기간이
    // 실제보다 짧다는 뜻이므로, 그 사실을 감추지 않고 함께 알린다.
    continuity.truncated = chain.some((c) => c.depth >= MAX_CHAIN_DEPTH)
  }

  // 체결이 끝난 계약은 보존 의무 기간을 관리해야 한다 (근로기준법 제42조).
  const retention = isSigned && terms ? describeRetention(terms, storedRow?.created_at) : null

  // 회사가 이 계약을 어떤 계약의 갱신으로 이을지 고를 수 있게, 같은 근로자의
  // 이미 체결된 계약 목록을 함께 내려준다.
  let linkableRooms = []
  if (!isSigned && access.role_in_room === 'company' && candidateRow) {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.title, ct.contract_start_date, ct.contract_end_date
         FROM room_participants rp
         JOIN interview_rooms r ON r.id = rp.room_id
         LEFT JOIN contract_terms ct ON ct.room_id = r.id
        WHERE rp.user_id = ? AND rp.role_in_room = 'candidate'
          AND r.status = 'signed' AND r.id != ?
        ORDER BY ct.contract_start_date DESC LIMIT 20`
    )
      .bind(candidateRow.id, roomId)
      .all()
    linkableRooms = results.map((r) => ({
      id: r.id,
      title: r.title,
      startDate: r.contract_start_date,
      endDate: r.contract_end_date,
    }))
  }

  let preSignCheck = null
  if (!isSigned && terms) {
    const diffs = diffAgreedVsCurrent(parsedHistory, terms)
    const legalIssues = [
      ...checkLegalCompliance(terms),
      ...checkPeriodCompliance(terms),
      ...checkContinuityCompliance(continuity),
    ]
    const missingFields = findMissingFields(terms)
    // 서명 대상은 계약 조건이 아니라 계약서 본문이므로 본문도 함께 대조한다.
    const documentCheck = checkContractDocument(terms)
    preSignCheck = {
      ready: true,
      diffs,
      legalIssues,
      missingFields,
      documentCheck,
      hasBlocking:
        legalIssues.some((i) => i.severity === 'high') ||
        diffs.length > 0 ||
        documentCheck.issues.length > 0 ||
        documentCheck.missingArticles.length > 0,
    }
  }

  return jsonResponse({
    room: {
      id: room.id,
      title: room.title,
      inviteCode: room.invite_code,
      status: room.status,
      myRole: access.role_in_room,
      participants: participantRows.map((p) => ({
        id: p.id,
        displayName: p.display_name,
        companyName: p.company_name,
        role: p.role_in_room,
      })),
    },
    contract: {
      terms,
      hireConfirmed: !!termsRow?.hire_confirmed,
      hireConfirmedAt: termsRow?.hire_confirmed_at ?? null,
      confirmationExcerpt: termsRow?.hire_confirmation_excerpt ?? null,
    },
    signatures: signatures.map((s) => ({
      role: s.signer_role,
      imageDataUrl: s.image_data_url,
      signedAt: s.signed_at,
      displayName: s.display_name,
      environment: describeSigningEnvironment(s),
    })),
    history: history
      .slice()
      .reverse()
      .map((h) => ({
        id: h.id,
        editorName: h.display_name,
        editorRole: h.editor_role,
        changes: (() => {
          try {
            return JSON.parse(h.changes)
          } catch {
            return []
          }
        })(),
        createdAt: h.created_at,
      })),
    auditTrail: {
      roomTitle: room.title,
      documentHash: storedRow?.sha256_hash ?? null,
      events: buildAuditEvents({
        room,
        participants: participantRows,
        terms: termsRow,
        history: history.map((h) => ({ ...h, display_name: h.display_name })),
        signatures,
        signedContract: storedRow,
        finalOffer,
      }),
    },
    preSignCheck,
    period,
    continuity,
    retention,
    linkableRooms,
    // 번역과 나란히 대조할 원본 조항 (번역 시 쓰는 것과 같은 기준)
    sourceArticles:
      terms?.aiDocument && terms.aiDocument.length > 0
        ? terms.aiDocument
        : buildArticlesFromTerms(terms),
    translations: translationRows.results.map((t) => {
      const lang = findLanguage(t.language)
      let articles = []
      try {
        articles = JSON.parse(t.articles_json)
      } catch {
        articles = []
      }
      return {
        language: t.language,
        label: lang?.label ?? t.language,
        nativeLabel: lang?.nativeLabel ?? t.language,
        articles,
        createdAt: t.created_at,
      }
    }),
    changeRequests: changeRequestRows.results.map(mapRequestRow),
    signedContract: storedRow
      ? {
          stored: {
            filename: storedRow.filename,
            sizeBytes: storedRow.size_bytes,
            sha256Hash: storedRow.sha256_hash,
            emailStatus: storedRow.email_status,
            emailedAt: storedRow.emailed_at,
            createdAt: storedRow.created_at,
          },
          candidateEmailMasked: candidateRow ? maskEmail(candidateRow.email) : null,
          emailConfigured: isEmailConfigured(env),
        }
      : { stored: null, candidateEmailMasked: candidateRow ? maskEmail(candidateRow.email) : null, emailConfigured: isEmailConfigured(env) },
  })
}
