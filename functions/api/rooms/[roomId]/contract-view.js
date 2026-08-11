import { jsonResponse, jsonError, isAppFetch } from '../../../_lib/http.js'
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
  checkContinuityCompliance,
  describeRetention,
} from '../../../_lib/contractPeriod.js'
import { checkContractDocument } from '../../../_lib/documentCheck.js'
import { checkProbationCompliance } from '../../../_lib/probation.js'
import { describeWageComposition } from '../../../_lib/wageItems.js'
import { listLifecycle, lifecycleEvents } from '../../../_lib/roomLifecycleLog.js'
import { describeWorkerRights } from '../../../_lib/workerRights.js'

import { contractFingerprint } from '../../../_lib/contractDocument.js'
import { markFirstViewed, listDeliveries, describeDeliveryState } from '../../../_lib/delivery.js'
import { explainContract } from '../../../_lib/contractExplainer.js'
import { comparePostingToContract } from '../../../_lib/postingMatch.js'
import { postingConditionsFromRow } from '../../../_lib/postingConditions.js'

// 갱신 사슬을 거슬러 올라가는 최대 깊이 (link-previous의 제한과 같아야 한다)
import { findLanguage, SUPPORTED_LANGUAGES } from '../../../_lib/languages.js'

// 계약서 화면이 필요한 모든 정보를 한 번에 돌려준다.
//
// 이전에는 방 정보·계약 조건·서명·수정 이력·감사추적·서명 전 점검·보관 계약서를
// 각각 따로 요청했는데, 감사추적이 나머지가 읽는 표를 대부분 다시 읽는 데다
// 요청마다 세션 인증까지 반복돼 한 페이지에 D1 조회가 스무 번 넘게 발생했다.
// 여기서 한 번만 읽고 나눠서 돌려준다.
export async function onRequestGet({ env, data, params, request }) {
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
    revocationRows,
    certificateRows,
    lifecycleRows,
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
         -- 상한을 두면 그 뒤에 승인된 수정 요청이 읽히지 않아, 폐기된 최초
         -- 금액이 "대화에서 합의한 값"으로 남고 서명이 잠긴다. 같은 계산을
         -- 하는 pre-sign-check 는 상한이 없어 두 경로 판정이 갈리기까지 했다.
         -- 계산은 전량으로 하고, 화면 표시만 아래에서 최근 것으로 자른다.
         WHERE h.room_id = ? ORDER BY h.id ASC`
      )
        .bind(roomId)
        .all(),
      env.DB.prepare(
        `SELECT s.signer_role, s.image_data_url, s.signed_at, s.signer_ip,
                s.signer_user_agent, s.signer_country, s.document_sha256, u.display_name
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
        'SELECT language, articles_json, created_at, updated_at, source_sha256 FROM contract_translations WHERE room_id = ?'
      )
        .bind(roomId)
        .all(),
      // 서명 후 내용이 바뀌어 무효가 된 서명. 왜 다시 서명해야 하는지 알리는 근거다.
      env.DB.prepare(
        `SELECT signer_role, signed_at, revoked_at, reason
           FROM signature_revocations WHERE room_id = ? ORDER BY id DESC LIMIT 20`
      )
        .bind(roomId)
        .all(),
      // 이미 발급된 증명서 — 감사추적에 함께 싣고, 화면에도 그대로 내려준다.
      env.DB.prepare(
        `SELECT serial, issued_at, certificate_sha256, document_sha256, event_count, revoked_at
           FROM audit_certificates WHERE room_id = ? ORDER BY issued_at ASC LIMIT 20`
      )
        .bind(roomId)
        .all(),
      // 전형 종료·근로관계 종료 같은 사건은 상태 컬럼이 지워지면 함께 사라진다.
      listLifecycle(env, roomId),
    ])

  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  // 근로자가 체결된 계약서를 처음 열어 본 시각을 남긴다. 전자문서법 제5조가
  // 요구하는 수신 기록이면서, 교부가 실제로 닿았다는 증거다.
  // 링크를 눌러 들어온 요청으로는 기록하지 않는다. 그렇게 두면 계약서를 본
  // 적 없는 근로자 앞으로 열람 기록이 남는다.
  if (room.status === 'signed' && access.role_in_room === 'candidate' && isAppFetch(request)) {
    await markFirstViewed(env, roomId)
  }

  const participantRows = participants.results
  const history = historyRows.results
  // 화면에는 최근 것부터 100건만 보여 준다. 계산(parsedHistory)은 전량을 쓴다.
  const HISTORY_DISPLAY = 100
  const historyForDisplay = history.slice(-HISTORY_DISPLAY)
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
  const continuity = await loadContinuity(env, roomId, termsRow)

  // 체결이 끝난 계약은 보존 의무 기간을 관리해야 한다 (근로기준법 제42조).
  //
  // 체결 시점은 서명 시각으로 잡는다. 예전에는 회사가 PDF를 저장한 시각을 썼는데,
  // 그 버튼을 누르지 않으면 체결된 계약에 체결 시점이 없는 것으로 취급됐다.
  const lastSignedAt = signatures.map((s) => s.signed_at).filter(Boolean).sort().pop() ?? null
  const retention =
    isSigned && terms
      ? describeRetention(terms, lastSignedAt || storedRow?.created_at, new Date(), terms.employmentEndedAt)
      : null

  // 이 면접방이 어느 공고에서 왔는지 찾아, 공고에 제시된 조건과 계약서를 대조한다.
  // 채용절차법 제4조 제3항은 채용광고에 제시한 근로조건을 구직자에게 불리하게
  // 변경하는 것을 금지한다. 비교할 값이 없으면 그 위반을 알아차릴 수 없다.
  let postingComparison = null
  if (terms) {
    const posting = await env.DB.prepare(
      `SELECT p.title, p.employment_type, p.location,
              p.wage_type, p.wage_min, p.wage_max,
              p.work_hours_start, p.work_hours_end, p.work_days
         FROM applications a JOIN job_postings p ON p.id = a.posting_id
        WHERE a.room_id = ? LIMIT 1`
    )
      .bind(roomId)
      .first()
    if (posting) {
      const compared = comparePostingToContract(
        {
          ...postingConditionsFromRow(posting),
          employmentType: posting.employment_type,
          location: posting.location,
        },
        terms
      )
      postingComparison = { postingTitle: posting.title, ...compared }
    }
  }

  // 근로자용 계약 해설. 계약서에 적힌 값만으로는 알 수 없는 것(환산 시급, 하루
  // 실근로시간, 무기계약 전환 여부)을 계산해 문장으로 돌려준다. AI를 쓰지 않으므로
  // 같은 계약이면 언제나 같은 설명이 나온다.
  const explanation = terms ? explainContract(terms) : null

  // 교부 이력 (근로기준법 제17조 제2항 · 전자문서법 제5조)
  const deliveries = isSigned ? await listDeliveries(env, roomId) : []
  const deliveryState = isSigned ? describeDeliveryState(deliveries) : null

  // 회사가 이 계약을 어떤 계약의 갱신으로 이을지 고를 수 있게, 같은 근로자의
  // 이미 체결된 계약 목록을 함께 내려준다.
  let linkableRooms = []
  if (!isSigned && access.role_in_room === 'company' && candidateRow) {
    // 요청자도 그 방의 참여자여야 한다.
    //
    // 예전에는 "이 근로자가 참여한 체결 계약"만으로 목록을 만들어서, 같은
    // 사람을 채용한 다른 회사의 계약 제목과 기간이 그대로 보였다. 실제로
    // 연결이 허용되는 범위(link-previous.js 의 참여자 검사)와 목록이
    // 어긋나 있었던 것이라, 고를 수도 없는 것을 보여 주면서 남의 계약을
    // 알려 주고 있었다.
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.title, ct.contract_start_date, ct.contract_end_date
         FROM room_participants rp
         JOIN interview_rooms r ON r.id = rp.room_id
         LEFT JOIN contract_terms ct ON ct.room_id = r.id
        WHERE rp.user_id = ?1 AND rp.role_in_room = 'candidate'
          AND r.status = 'signed' AND r.id != ?2
          AND EXISTS (
            SELECT 1 FROM room_participants me
             WHERE me.room_id = r.id AND me.user_id = ?3
          )
        ORDER BY ct.contract_start_date DESC LIMIT 20`
    )
      .bind(candidateRow.id, roomId, data.user.id)
      .all()
    linkableRooms = results.map((r) => ({
      id: r.id,
      title: r.title,
      startDate: r.contract_start_date,
      endDate: r.contract_end_date,
    }))
  }

  // 감사추적과 응답이 같은 목록을 쓰도록 먼저 만들어 둔다. 예전에는 응답을
  // 조립하는 자리에서만 변환해서, 이력에는 이 사건들이 들어가지 못했다.
  const mappedRequests = changeRequestRows.results.map(mapRequestRow)
  // 지금 계약 내용의 지문. 번역본이 이것과 다른 내용을 옮긴 것인지 가린다.
  const currentSha256 = terms ? await contractFingerprint(terms) : null
  const mappedTranslations = translationRows.results.map((t) => {
    const lang = findLanguage(t.language)
    let articles = []
    try {
      articles = JSON.parse(t.articles_json)
    } catch {
      articles = []
    }
    // 번역한 시점의 내용과 지금 내용이 다르면, 이 번역본은 지금 계약서의
    // 번역이 아니다. 한국어를 읽지 못하는 사람에게는 그 사실을 말해 주지
    // 않으면 확인할 방법이 없다.
    const stale = t.source_sha256 ? t.source_sha256 !== currentSha256 : null
    return {
      language: t.language,
      label: lang?.label ?? t.language,
      nativeLabel: lang?.nativeLabel ?? t.language,
      articles,
      createdAt: t.created_at,
      updatedAt: t.updated_at ?? null,
      sourceSha256: t.source_sha256 ?? null,
      // true = 옛 내용의 번역, false = 지금 내용의 번역, null = 확인할 수 없음
      stale,
    }
  })
  const revokedSignatures = revocationRows.results.map((r) => ({
    role: r.signer_role,
    signer_role: r.signer_role,
    signedAt: r.signed_at,
    revokedAt: r.revoked_at,
    revoked_at: r.revoked_at,
    reason: r.reason,
  }))
  // 감사추적은 오래된 순으로 읽지만, 화면 목록은 최근 발급이 위로 온다.
  const certificates = certificateRows.results.map((c) => ({
    serial: c.serial,
    issuedAt: c.issued_at,
    certificateSha256: c.certificate_sha256,
    documentSha256: c.document_sha256,
    eventCount: c.event_count,
    revokedAt: c.revoked_at,
  }))

  let preSignCheck = null
  if (!isSigned && terms) {
    const diffs = diffAgreedVsCurrent(parsedHistory, terms)
    const legalIssues = [
      ...checkLegalCompliance(terms),
      ...checkProbationCompliance(terms),
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
        // 제17조 명시사항이 비어 있는 계약은 확인 절차 없이 서명될 수 없다.
        // 예전에는 임금·휴일이 비어도 확인 체크박스조차 뜨지 않았다.
        missingFields.length > 0 ||
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
      // 화면이 이 내용을 읽은 시각. 서명할 때 함께 보내 대조한다.
      //
      // 아래 documentSha256 만으로는 부족하다. 정본 직렬화의 항목 목록에 임금
      // 구성항목이 없어서, 기본급을 그대로 두고 식대만 낮추면 인쇄되는 내용은
      // 달라지는데 지문은 같다. 목록에 줄을 더하면 이미 서명된 계약서의 지문이
      // 소급해 바뀌므로, 대신 저장 시각을 함께 본다.
      updatedAt: termsRow?.updated_at ?? null,
    },
    signatures: signatures.map((s) => ({
      role: s.signer_role,
      imageDataUrl: s.image_data_url,
      signedAt: s.signed_at,
      displayName: s.display_name,
      environment: describeSigningEnvironment(s),
      // 이 서명이 어떤 내용에 붙었는지를 나타내는 지문
      documentSha256: s.document_sha256,
    })),
    // 지금 화면에 보이는 내용의 지문. 서명할 때 함께 보내, 화면과 저장된 내용이
    // 어긋난 상태로 서명되는 것을 막는다.
    documentSha256: currentSha256,
    historyTotal: history.length,
    history: historyForDisplay
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
        revocations: revokedSignatures,
        changeRequests: mappedRequests,
        deliveries,
        translations: mappedTranslations,
        certificates,
        lifecycle: lifecycleEvents(lifecycleRows),
      }),
    },
    // 서명 후 내용이 바뀌어 무효가 된 서명 (다시 서명해야 하는 이유)
    revokedSignatures,
    // 이 화면은 필요한 것을 한 번에 받는다는 원칙으로 만들어져 있는데,
    // 증명서 목록만 화면이 따로 한 번 더 요청하고 있었다. 이미 여기서 읽으므로
    // 함께 내려준다. (최근 발급이 위로 오게 뒤집어서)
    certificates: [...certificates].reverse(),
    explanation,
    // 임금이 무엇으로 이루어져 있고 그중 무엇이 최저임금에 산입되는지.
    wageComposition: terms ? describeWageComposition(terms) : null,
    // 연차·퇴직금·가산수당을 날짜와 금액으로 (제60조·퇴직급여법 제4조·제56조)
    workerRights: describeWorkerRights(terms),
    postingComparison,
    deliveries,
    deliveryState,
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
    translations: mappedTranslations,
    // 번역 가능한 언어 목록. 화면이 같은 목록을 따로 적어 두면, 언어를 늘려도
    // 드롭다운에 나오지 않고 줄이면 서버가 거절하는 언어를 고르게 된다.
    languages: SUPPORTED_LANGUAGES,
    changeRequests: mappedRequests,
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
