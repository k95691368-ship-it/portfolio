import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { blockedWhenFrozen } from '../../../_lib/roomLifecycle.js'
import { genId } from '../../../_lib/db.js'
import { getRoomParticipation } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { checkContractDocument } from '../../../_lib/documentCheck.js'
import { findMissingFields, checkLegalCompliance } from '../../../_lib/contractCheck.js'
import { checkPeriodCompliance } from '../../../_lib/contractPeriod.js'
import { checkProbationCompliance } from '../../../_lib/probation.js'
import { contractFingerprint } from '../../../_lib/contractDocument.js'
import { recordDelivery } from '../../../_lib/delivery.js'
import { signerVerificationMethod } from '../../../_lib/auditCertificate.js'

const MAX_DATA_URL_LENGTH = 2_000_000

export async function onRequestPost({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  // 참여 여부와 방 상태는 같은 방에 대한 두 값이다. 한 번에 읽는다.
  const room = await getRoomParticipation(env, params.roomId, data.user.id)
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (!room.role_in_room) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  const participant = { role_in_room: room.role_in_room }
  if (room.status === 'signed') return jsonError('이미 서명이 완료된 계약서입니다.', 409)
  const signBlock = blockedWhenFrozen(room, 'sign')
  if (signBlock) return jsonError(signBlock, 409)

  // 조건을 읽기 전에 본문부터 받는다.
  //
  // 서명 이미지는 최대 2MB 라 본문을 받는 데 실제로 시간이 걸린다. 조건을 먼저
  // 읽어 두고 그동안 본문을 기다리면, 그 사이 회사가 조건을 고쳐도 이 요청은
  // 낡은 조건으로 모든 검사를 통과한 뒤 서명을 남긴다. 조건 변경 경로는 그
  // 시점에 있던 서명만 지우므로 뒤늦게 도착한 이 서명은 살아남는다.
  //
  // 읽는 순서를 바꿔 그 창을 없앤다. 남는 것은 아래 검사에 드는 짧은 시간뿐이고,
  // 그것은 INSERT 에 건 조건이 막는다.
  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

  // 계약 조건과 '내 직전 서명'은 서로 다른 표이고 서로를 기다릴 이유가 없다.
  // 서명은 사람이 버튼을 누르고 기다리는 자리다.
  const [contract, previousSignature] = await Promise.all([
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(params.roomId).first(),
    // 이미 이 역할의 서명이 있으면 아래 INSERT 가 덮어쓴다. 덮어쓰기 전에
    // 읽어 두어야 앞선 서명을 무효 기록으로 옮길 수 있다.
    env.DB.prepare(
      `SELECT signer_role, signer_user_id, signed_at, signer_ip, signer_user_agent,
              signer_country, document_sha256
         FROM signatures WHERE room_id = ? AND signer_role = ?`
    )
      .bind(params.roomId, room.role_in_room)
      .first(),
  ])
  if (!contract?.hire_confirmed) return jsonError('아직 채용이 확정되지 않아 서명할 수 없습니다.', 400)

  // 서명하는 문서는 계약 조건이 아니라 계약서 본문이다. 조건을 고친 뒤 본문을
  // 다시 작성하지 않으면 본문에 옛 금액이 남는데, 여기서 서로 다른 금액이
  // 확실하게 확인되면 확인 절차로 넘기지 않고 서명 자체를 막는다.
  const terms = rowToCamelTerms(contract)
  const docCheck = checkContractDocument(terms)
  if (docCheck.hasConflict) {
    const conflict = docCheck.issues.find((i) => i.conflict)
    return jsonError(
      `계약서 본문이 계약 조건과 다릅니다. ${conflict.message} (AI 계약서 다시 작성하기)`,
      409
    )
  }

  // 서명 전 점검은 지금까지 화면에만 있었다. API를 직접 호출하면 필수 항목이 빈
  // 계약과 최저임금 미달 계약이 그대로 서명됐다. 서면 명시사항 누락은
  // 근로기준법 제114조 벌금 대상이고 최저임금 미달도 형사 대상이라, 계산은 이미
  // 하고 있으면서 강제하지 않는 것은 점검이 없는 것과 같다.
  const missingFields = findMissingFields(terms)
  if (missingFields.length > 0) {
    return jsonError(
      `근로기준법 제17조 명시사항이 비어 있어 서명할 수 없습니다: ${missingFields
        .map((m) => m.label)
        .join(', ')}`,
      409
    )
  }

  // 최저임금 미달·주 52시간 초과 같은 높은 등급 문제는, 당사자가 화면에서 그
  // 내용을 확인했다고 밝힌 경우에만 서명을 허용한다.
  const highIssues = [
    ...checkLegalCompliance(terms),
    ...checkPeriodCompliance(terms),
    ...checkProbationCompliance(terms),
  ].filter(
    (i) => i.severity === 'high'
  )
  if (highIssues.length > 0 && body.acknowledgedIssues !== true) {
    return jsonError(
      `법적 검토에서 확인이 필요한 사항이 있습니다: ${highIssues
        .map((i) => i.title)
        .join(', ')}. 계약서 화면에서 내용을 확인한 뒤 서명해주세요.`,
      409
    )
  }

  const imageDataUrl = body.imageDataUrl
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    return jsonError('서명 이미지가 올바르지 않습니다.', 400)
  }
  if (imageDataUrl.length > MAX_DATA_URL_LENGTH) {
    return jsonError('서명 이미지 용량이 너무 큽니다.', 400)
  }

  // 서명이 이루어진 접속 환경을 함께 남긴다 (감사추적증명서의 증거 항목).
  const ip = request.headers.get('CF-Connecting-IP') || null
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 300) || null
  const country = request.headers.get('CF-IPCountry') || null

  // 서명하는 순간의 계약 내용 지문. 서명과 문서를 묶어, 나중에 "무엇에
  // 동의했는가"를 서명 기록만으로 특정할 수 있게 한다.
  const documentSha256 = await contractFingerprint(terms)


  // 화면이 보여 준 내용과 지금 저장된 내용이 다르면, 사용자는 자기가 본 것과
  // 다른 문서에 서명하게 된다. 화면이 보낸 지문과 다르면 새로 고치게 한다.
  if (typeof body.documentSha256 === 'string' && body.documentSha256 !== documentSha256) {
    return jsonError(
      '계약 내용이 변경되었습니다. 화면을 새로 고쳐 바뀐 내용을 확인한 뒤 서명해주세요.',
      409
    )
  }

  // 지문만으로는 부족하다.
  //
  // 정본 직렬화(TERM_ORDER)는 항목 목록이 고정되어 있고, 임금 구성항목은 거기
  // 없다. 그런데 계약서 본문에는 그 항목들이 그대로 인쇄된다. 그래서 기본급을
  // 그대로 두고 식대만 25만원에서 5만원으로 낮추면, 인쇄되는 내용은 달라지는데
  // 지문은 같아 위 검사가 서지 않는다. 근로자는 20만원 적은 계약서에 서명하고,
  // 서명 기록의 '문서 지문'은 '지금 내용과 같음'으로 표시된다.
  //
  // TERM_ORDER 에 줄을 더하면 이미 서명된 계약서의 지문이 소급해 바뀌므로 그
  // 방향은 막혀 있다. 대신 화면이 읽은 시각을 함께 받아 대조한다 — 무엇이
  // 바뀌었든 저장이 있었으면 걸린다.
  if (
    body.termsUpdatedAt !== undefined &&
    body.termsUpdatedAt !== null &&
    body.termsUpdatedAt !== contract.updated_at
  ) {
    return jsonError(
      '계약 내용이 변경되었습니다. 화면을 새로 고쳐 바뀐 내용을 확인한 뒤 서명해주세요.',
      409
    )
  }

  // 여기까지의 모든 검사는 위에서 한 번 읽은 조건 스냅샷으로 했다. 그 사이
  // 회사가 조건을 고치면, 조건 변경 경로는 그 시점에 존재하는 서명만 지우므로
  // 지금 들어가는 이 서명은 지울 대상이 아니어서 살아남는다. 근로자는 자기가
  // 본 적 없는 계약에 서명한 것이 되고, 최저임금·제17조 검사도 옛 값으로만
  // 돌아 새 값은 서버에서 한 번도 확인되지 않는다.
  //
  // D1 에는 트랜잭션이 없으므로 문장 하나로 조건을 건다. 읽었을 때의
  // updated_at 과 지금이 같을 때만 INSERT 가 성립한다. IS 는 NULL 도 비교한다.
  const inserted = await env.DB.prepare(
    `INSERT INTO signatures
       (id, room_id, signer_user_id, signer_role, image_data_url, signed_at,
        signer_ip, signer_user_agent, signer_country, document_sha256,
        verified_email, session_started_at, verification_method)
     SELECT ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT updated_at FROM contract_terms WHERE room_id = ?) IS ?
     ON CONFLICT(room_id, signer_role) DO UPDATE SET
       signer_user_id = excluded.signer_user_id,
       image_data_url = excluded.image_data_url,
       signed_at = datetime('now'),
       signer_ip = excluded.signer_ip,
       signer_user_agent = excluded.signer_user_agent,
       signer_country = excluded.signer_country,
       document_sha256 = excluded.document_sha256,
       verified_email = excluded.verified_email,
       session_started_at = excluded.session_started_at,
       verification_method = excluded.verification_method`
  )
    .bind(
      genId(),
      params.roomId,
      data.user.id,
      participant.role_in_room,
      imageDataUrl,
      ip,
      userAgent,
      country,
      documentSha256,
      // 어느 계정으로, 언제 로그인한 세션에서 서명했는지. 접속 환경만으로는
      // "내가 서명하지 않았다"는 주장에 답할 수 없다.
      data.user.email ?? null,
      data.user.session_started_at ?? null,
      // 무엇으로 본인을 확인했는가.
      //
      // 코드로 들어온 세션을 '계정 비밀번호로 확인된 서명'이라고 적으면 안 된다.
      // 그 코드는 회사 담당자도 볼 수 있는 값이라(발급 화면·지원서 상세·재발송)
      // 담당자가 근로자 서명을 대신 만들 수 있고, 그것을 비밀번호 확인이라고
      // 부르면 이 앱이 만들려는 증명서 자체가 거짓이 된다.
      //
      // 막지는 않는다 — 코드로 서명까지 되는 것이 정해진 방향이다. 대신 무엇으로
      // 들어왔는지를 그대로 남겨, 나중에 다투는 자리에서 구분되게 한다.
      signerVerificationMethod(data.user),
      params.roomId,
      contract.updated_at ?? null
    )
    .run()

  if (inserted.meta.changes === 0) {
    return jsonError(
      '서명하는 사이에 계약 조건이 바뀌었습니다. 화면을 새로 고쳐 바뀐 내용을 확인한 뒤 다시 서명해주세요.',
      409
    )
  }

  // 다시 서명하면 앞선 서명이 흔적 없이 사라지고 있었다.
  //
  // 위 문장은 (room_id, signer_role) 충돌 시 덮어쓴다. 상대가 아직 서명하지
  // 않은 동안에는 다시 그릴 수 있어야 하니 덮어쓰는 것 자체는 맞다. 그런데
  // 덮어쓰면 먼저 한 서명의 시각·접속 환경이 지워진다.
  //
  // 이 앱은 "언제 무엇에 동의했는가"를 다투기 위해 만든 것이고, 그래서 조건이
  // 바뀌어 무효가 된 서명도 지우지 않고 signature_revocations 에 옮겨 둔다
  // (0032 마이그레이션). 본인이 다시 서명한 경우만 예외로 두면 그 원칙에
  // 구멍이 난다. 같은 자리에 같은 방식으로 남긴다.
  if (previousSignature) {
    await env.DB.prepare(
      `INSERT INTO signature_revocations
         (room_id, signer_role, signer_user_id, signed_at, signer_ip,
          signer_user_agent, signer_country, revoked_by_user_id, reason, document_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        params.roomId,
        previousSignature.signer_role,
        previousSignature.signer_user_id,
        previousSignature.signed_at,
        previousSignature.signer_ip,
        previousSignature.signer_user_agent,
        previousSignature.signer_country,
        data.user.id,
        '본인이 다시 서명함',
        previousSignature.document_sha256
      )
      .run()
      .catch((err) => {
        // 기록이 실패해도 서명까지 되돌리지는 않는다. 다만 조용히 넘기지 않는다.
        console.error(`signature replace log failed (${params.roomId}):`, err)
      })
  }

  // 역할만 세고 있었다.
  //
  // 서명이 둘 있다는 것과 그 둘이 같은 문서에 붙어 있다는 것은 다른 말이다.
  // 지원자가 서명한 뒤 조건이 바뀌고(무효화가 어떤 이유로든 돌지 않아) 옛
  // 서명이 남은 채 회사가 서명하면, 서로 다른 내용에 붙은 서명 두 개로 계약이
  // '체결 완료'가 되고 교부까지 기록된다. 감사추적증명서는 나중에 그 사실을
  // "서명자마다 서로 다른 문서에 서명했다"고 설명할 줄 아는데, 정작 체결되는
  // 순간에는 아무도 보지 않았다.
  const { results: sigs } = await env.DB.prepare(
    'SELECT signer_role, document_sha256 FROM signatures WHERE room_id = ?'
  )
    .bind(params.roomId)
    .all()

  const roles = new Set(sigs.map((s) => s.signer_role))
  const haveBoth = roles.has('company') && roles.has('candidate')
  // 지문이 남지 않은 옛 서명은 대조할 수 없다. 없는 것을 다르다고 하지 않는다.
  const sameDocument = sigs
    .filter((s) => s.document_sha256)
    .every((s) => s.document_sha256 === documentSha256)
  const bothSigned = haveBoth && sameDocument

  if (haveBoth && !sameDocument) {
    // 여기서 조용히 넘어가면 '서명이 하나 더 필요한 상태'로 남아 화면이
    // 이유를 말하지 못한다. 무엇이 어긋났는지 알리고 다시 받게 한다.
    console.error(`signature document mismatch (${params.roomId})`)
    return jsonError(
      '상대방이 서명한 계약 내용과 지금 내용이 다릅니다. 서명은 저장되었지만 체결로 넘기지 않았습니다. 계약 조건을 확인하고 상대방에게 다시 서명을 요청해주세요.',
      409
    )
  }

  // 참여자를 한 번만 읽는다.
  //
  // 교부 기록에 쓸 근로자와 알림을 보낼 상대를 각각 따로 조회하고 있었다.
  // 같은 요청에서 같은 표를 두 번 읽는 셈이라, 체결이 끝나는 그 순간에만
  // 왕복이 하나 더 붙었다.
  const { results: members } = await env.DB.prepare(
    `SELECT u.id, u.email, rp.role_in_room
       FROM room_participants rp JOIN users u ON u.id = rp.user_id
      WHERE rp.room_id = ?`
  )
    .bind(params.roomId)
    .all()

  if (bothSigned) {
    // 상태를 무조건 덮어쓰면, 그 사이에 성립한 전형 종료를 되돌릴 수 없는
    // 형태로 지운다(close_reason·closed_at 은 남고 상태만 signed 가 된다).
    // 서명 가능한 상태였을 때만 체결로 넘긴다.
    await env.DB.prepare(
      `UPDATE interview_rooms SET status = 'signed'
        WHERE id = ? AND status IN ('open', 'active', 'contract_pending')`
    )
      .bind(params.roomId)
      .run()

    // 교부 의무(근로기준법 제17조 제2항)를 회사의 수동 클릭에 맡기지 않는다.
    // 체결이 끝나는 순간, 근로자가 계약서를 열람할 수 있게 된 사실을 교부로
    // 기록한다. 회사가 버튼을 누르지 않아도 교부물과 그 기록이 존재한다.
    const candidate = (members || []).find((m) => m.role_in_room === 'candidate')
    if (candidate) {
      await recordDelivery(env, params.roomId, {
        channel: 'in_app',
        recipientUserId: candidate.id,
        recipientAddress: candidate.email,
      })
    }
  }

  // 상대방에게 알림 (모두 서명 완료 시에는 양측 모두).
  // 서로 다른 사람에게 가는 알림이라 순서대로 기다릴 이유가 없다.
  const others = (members || []).filter((m) => m.id !== data.user.id)
  await Promise.all(
    others.map((other) =>
      notifyUser(env, other.id, {
        type: bothSigned ? 'contract_signed' : 'signature',
        message: bothSigned
          ? '전자근로계약서 서명이 완료되었습니다. 계약서를 확인해보세요.'
          : `${data.user.display_name}님이 계약서에 서명했습니다. 내 서명을 진행해주세요.`,
        link: `/rooms/${params.roomId}/contract`,
      })
    )
  )

  return jsonResponse({ ok: true, signerRole: participant.role_in_room, bothSigned })
}
