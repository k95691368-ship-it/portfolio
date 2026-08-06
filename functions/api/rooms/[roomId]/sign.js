import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { genId } from '../../../_lib/db.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { checkContractDocument } from '../../../_lib/documentCheck.js'
import { findMissingFields, checkLegalCompliance } from '../../../_lib/contractCheck.js'
import { checkPeriodCompliance } from '../../../_lib/contractPeriod.js'
import { checkProbationCompliance } from '../../../_lib/probation.js'
import { contractFingerprint } from '../../../_lib/contractDocument.js'
import { recordDelivery } from '../../../_lib/delivery.js'

const MAX_DATA_URL_LENGTH = 2_000_000

export async function onRequestPost({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') return jsonError('이미 서명이 완료된 계약서입니다.', 409)

  const contract = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  if (!contract?.hire_confirmed) return jsonError('아직 채용이 확정되지 않아 서명할 수 없습니다.', 400)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

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

  await env.DB.prepare(
    `INSERT INTO signatures
       (id, room_id, signer_user_id, signer_role, image_data_url, signed_at,
        signer_ip, signer_user_agent, signer_country, document_sha256,
        verified_email, session_started_at, verification_method)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
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
      data.user.must_change_password ? 'temp_password' : 'account_password'
    )
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

    // 교부 의무(근로기준법 제17조 제2항)를 회사의 수동 클릭에 맡기지 않는다.
    // 체결이 끝나는 순간, 근로자가 계약서를 열람할 수 있게 된 사실을 교부로
    // 기록한다. 회사가 버튼을 누르지 않아도 교부물과 그 기록이 존재한다.
    const candidate = await env.DB.prepare(
      `SELECT u.id, u.email FROM room_participants rp JOIN users u ON u.id = rp.user_id
        WHERE rp.room_id = ? AND rp.role_in_room = 'candidate' LIMIT 1`
    )
      .bind(params.roomId)
      .first()
    if (candidate) {
      await recordDelivery(env, params.roomId, {
        channel: 'in_app',
        recipientUserId: candidate.id,
        recipientAddress: candidate.email,
      })
    }
  }

  // 상대방에게 알림 (모두 서명 완료 시에는 양측 모두)
  const { results: others } = await env.DB.prepare(
    'SELECT user_id FROM room_participants WHERE room_id = ? AND user_id != ?'
  )
    .bind(params.roomId, data.user.id)
    .all()
  for (const other of others) {
    await notifyUser(env, other.user_id, {
      type: bothSigned ? 'contract_signed' : 'signature',
      message: bothSigned
        ? '전자근로계약서 서명이 완료되었습니다. 계약서를 확인해보세요.'
        : `${data.user.display_name}님이 계약서에 서명했습니다. 내 서명을 진행해주세요.`,
      link: `/rooms/${params.roomId}/contract`,
    })
  }

  return jsonResponse({ ok: true, signerRole: participant.role_in_room, bothSigned })
}
