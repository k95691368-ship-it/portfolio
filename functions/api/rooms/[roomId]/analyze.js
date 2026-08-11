import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { analyzeConversation } from '../../../_lib/claude.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { mergeValue, mergeSocialInsurance } from '../../../_lib/merge.js'
import { notifyUser } from '../../../_lib/notify.js'
import { buildTranscript } from '../../../_lib/transcript.js'
import { blockedWhenFrozen } from '../../../_lib/roomLifecycle.js'

const COOLDOWN_SECONDS = 45
const TRANSCRIPT_LIMIT = 300 // AI에 넘길 최근 대화 수 상한

export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  // 조건을 저장하는 다른 경로(contract, contract-draft, confirm-hire, translate,
  // link-previous, interview-summary)와 마찬가지로 회사 측만 실행할 수 있다.
  // 화면에서만 막고 있었고 서버에는 검사가 없었다.
  if (participant.role_in_room !== 'company') {
    return jsonError('채용 조건 정리는 회사(고용) 측만 실행할 수 있습니다.', 403)
  }

  // 체결이 끝난 계약의 조건을 다시 덮어쓰지 못하게 한다.
  // 이 경로만 status 검사가 없어서, 서명·보관까지 끝난 뒤에도 화면의 버튼 한
  // 번으로 근로자가 보는 근로조건과 계약 기간·보존 기한이 바뀔 수 있었다.
  const room = await env.DB.prepare('SELECT status, archived_at FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') {
    return jsonError('이미 서명이 완료된 계약은 조건을 다시 정리할 수 없습니다.', 409)
  }
  // 종료된 전형도 막는다. 이 경로는 조건을 덮어쓸 뿐 아니라 방을
  // contract_pending 으로 되살리므로, 끝난 전형이 다시 '서명하세요'가 된다.
  const closed = blockedWhenFrozen(room, 'analyze')
  if (closed) return jsonError(closed, 409)

  // 대화 전체를 매번 읽어 AI에 넘기면 면접이 길어질수록 읽기량·토큰·응답 시간이
  // 계속 늘어난다. 이전에 확정된 조건은 previousTerms로 함께 전달되므로,
  // 최근 대화만 보면 충분하다.
  const { results: messages } = await env.DB.prepare(
    `SELECT * FROM (
       SELECT m.id, m.body, rp.role_in_room, u.display_name
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_user_id
       JOIN room_participants rp ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
       WHERE m.room_id = ?
       ORDER BY m.id DESC
       LIMIT ?
     ) ORDER BY id ASC`
  )
    .bind(params.roomId, TRANSCRIPT_LIMIT)
    .all()

  if (messages.length === 0) return jsonError('분석할 대화 내용이 없습니다.', 400)

  // Ensure a row exists, then atomically claim the cooldown slot in one statement
  // so concurrent requests can't all read the same "expired" timestamp and race
  // past the check before any of them writes (unlike reading updated_at, this
  // column is never touched by the manual contract-edit PATCH route either).
  await env.DB.prepare('INSERT INTO contract_terms (room_id) VALUES (?) ON CONFLICT(room_id) DO NOTHING')
    .bind(params.roomId)
    .run()

  // 쿨다운 선점 이전의 상태를 미리 읽어 둔다. AI 호출이 실패하면 이 값으로
  // last_analyzed_at을 되돌려, 실패한 시도는 쿨다운을 소모하지 않게 한다.
  const existing = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  const prevAnalyzedAt = existing?.last_analyzed_at ?? null

  const claim = await env.DB.prepare(
    `UPDATE contract_terms SET last_analyzed_at = datetime('now')
     WHERE room_id = ? AND (last_analyzed_at IS NULL OR last_analyzed_at < datetime('now', '-' || ? || ' seconds'))`
  )
    .bind(params.roomId, COOLDOWN_SECONDS)
    .run()

  if (claim.meta.changes === 0) {
    const row = await env.DB.prepare('SELECT last_analyzed_at FROM contract_terms WHERE room_id = ?')
      .bind(params.roomId)
      .first()
    const secondsSince = (Date.now() - new Date(`${row.last_analyzed_at}Z`).getTime()) / 1000
    const remaining = Math.max(1, Math.ceil(COOLDOWN_SECONDS - secondsSince))
    return jsonError(`너무 잦은 요청입니다. ${remaining}초 후 다시 시도해주세요.`, 429)
  }

  // 한 메시지가 한 줄을 넘지 못하게 해, 본문에 줄바꿈을 넣어 상대방 발언을
  // 위조하는 것을 막는다.
  const transcript = buildTranscript(messages)

  const previousTerms = rowToCamelTerms(existing)
  if (previousTerms) {
    // 경고는 분석 결과물이지 조건이 아니므로 AI 입력에서 제외
    delete previousTerms.analysisWarnings
    delete previousTerms.aiDocument
  }

  let analysis
  try {
    analysis = await analyzeConversation(env, transcript, previousTerms)
  } catch (err) {
    // 실패한 시도는 쿨다운을 소모하지 않도록 이전 값으로 되돌린다 (즉시 재시도 허용).
    await env.DB.prepare('UPDATE contract_terms SET last_analyzed_at = ? WHERE room_id = ?')
      .bind(prevAnalyzedAt, params.roomId)
      .run()
      .catch(() => {})
    return jsonError(err.message, 502)
  }

  const t = analysis.terms || {}

  const merged = {
    work_location: mergeValue(t.work_location, existing?.work_location),
    job_description: mergeValue(t.job_description, existing?.job_description),
    contract_start_date: mergeValue(t.contract_start_date, existing?.contract_start_date),
    contract_end_date: mergeValue(t.contract_end_date, existing?.contract_end_date),
    work_hours_start: mergeValue(t.work_hours_start, existing?.work_hours_start),
    work_hours_end: mergeValue(t.work_hours_end, existing?.work_hours_end),
    work_days: mergeValue(t.work_days, existing?.work_days),
    rest_days: mergeValue(t.rest_days, existing?.rest_days),
    wage_base_amount: mergeValue(t.wage_base_amount, existing?.wage_base_amount),
    wage_pay_method: mergeValue(t.wage_pay_method, existing?.wage_pay_method),
    wage_pay_date: mergeValue(t.wage_pay_date, existing?.wage_pay_date),
    annual_leave: mergeValue(t.annual_leave, existing?.annual_leave),
    uniform_size: mergeValue(t.uniform_size, existing?.uniform_size),
  }
  const { json: socialInsuranceJson } = mergeSocialInsurance(
    t.social_insurance,
    existing?.social_insurance_json
  )
  const customTermsJson =
    t.custom_terms && t.custom_terms.length > 0
      ? JSON.stringify(t.custom_terms)
      : (existing?.custom_terms_json ?? null)

  const warnings = Array.isArray(analysis.warnings)
    ? analysis.warnings.slice(0, 10).map((w) => String(w).slice(0, 300))
    : []

  const wasConfirmed = !!existing?.hire_confirmed
  const hireConfirmed = analysis.hire_confirmed || wasConfirmed
  const hireConfirmedAt = analysis.hire_confirmed && !wasConfirmed ? new Date().toISOString() : (existing?.hire_confirmed_at ?? null)
  const confirmationExcerpt = analysis.hire_confirmed
    ? (analysis.confirmation_excerpt ?? null)
    : (existing?.hire_confirmation_excerpt ?? null)
  const lastMessageId = messages[messages.length - 1].id

  // AI 호출은 수 초가 걸린다. 그동안 이 방의 조건은 다른 경로로 얼마든지
  // 바뀔 수 있다 — 회사가 다른 탭에서 수정 요청을 수락하거나, 조건을 직접
  // 고치거나, 채용을 확정하거나.
  //
  // 그런데 아래 UPSERT 는 호출 전에 읽어 둔 낡은 스냅샷(existing)으로 12개
  // 컬럼을 전부 덮어쓴다. AI 가 언급하지 않은 항목은 mergeValue 가 낡은 값으로
  // 되쓰므로, 그 사이 수락된 인상이 조용히 되돌아간다. 수정 이력과 알림에는
  // "반영되었습니다"가 남아 있는데 저장된 값은 옛 금액이다. hire_confirmed 도
  // 같은 식으로 1에서 0으로 되돌아가, 채용 확정 알림을 받은 지원자가 서명하려
  // 하면 "아직 채용이 확정되지 않았다"는 답을 받는다.
  //
  // 읽었을 때의 updated_at 과 같을 때만 쓴다. 그 사이 누가 썼으면 이 결과는
  // 버린다 — 낡은 값으로 덮어쓰는 것보다 다시 누르게 하는 편이 낫다.
  const written = await env.DB.prepare(
    `INSERT INTO contract_terms (
       room_id, work_location, job_description, contract_start_date, contract_end_date,
       work_hours_start, work_hours_end, work_days, rest_days,
       wage_base_amount, wage_pay_method, wage_pay_date, annual_leave,
       social_insurance_json, uniform_size, custom_terms_json,
       hire_confirmed, hire_confirmed_at, hire_confirmation_excerpt,
       extraction_confidence, last_analyzed_message_id, analysis_warnings_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(room_id) DO UPDATE SET
       work_location=excluded.work_location, job_description=excluded.job_description,
       contract_start_date=excluded.contract_start_date, contract_end_date=excluded.contract_end_date,
       work_hours_start=excluded.work_hours_start, work_hours_end=excluded.work_hours_end,
       work_days=excluded.work_days, rest_days=excluded.rest_days,
       wage_base_amount=excluded.wage_base_amount, wage_pay_method=excluded.wage_pay_method,
       wage_pay_date=excluded.wage_pay_date, annual_leave=excluded.annual_leave,
       social_insurance_json=excluded.social_insurance_json, uniform_size=excluded.uniform_size,
       custom_terms_json=excluded.custom_terms_json,
       hire_confirmed=excluded.hire_confirmed, hire_confirmed_at=excluded.hire_confirmed_at,
       hire_confirmation_excerpt=excluded.hire_confirmation_excerpt,
       extraction_confidence=excluded.extraction_confidence,
       last_analyzed_message_id=excluded.last_analyzed_message_id,
       analysis_warnings_json=excluded.analysis_warnings_json,
       updated_at=datetime('now')
     WHERE contract_terms.updated_at IS ?`
  )
    .bind(
      params.roomId,
      merged.work_location,
      merged.job_description,
      merged.contract_start_date,
      merged.contract_end_date,
      merged.work_hours_start,
      merged.work_hours_end,
      merged.work_days,
      merged.rest_days,
      merged.wage_base_amount,
      merged.wage_pay_method,
      merged.wage_pay_date,
      merged.annual_leave,
      socialInsuranceJson,
      merged.uniform_size,
      customTermsJson,
      hireConfirmed ? 1 : 0,
      hireConfirmedAt,
      confirmationExcerpt,
      analysis.confirmation_confidence ?? null,
      lastMessageId,
      warnings.length > 0 ? JSON.stringify(warnings) : null,
      existing?.updated_at ?? null
    )
    .run()

  if (written.meta.changes === 0) {
    return jsonError(
      '조건을 정리하는 사이에 계약 조건이 바뀌었습니다. 바뀐 내용을 덮어쓰지 않도록 저장하지 않았습니다. 화면을 새로 고친 뒤 다시 시도해주세요.',
      409
    )
  }

  if (hireConfirmed && !wasConfirmed) {
    await env.DB.prepare("UPDATE interview_rooms SET status = 'contract_pending' WHERE id = ?")
      .bind(params.roomId)
      .run()

    const candidate = await env.DB.prepare(
      "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
    )
      .bind(params.roomId)
      .first()
    await notifyUser(env, candidate?.user_id, {
      type: 'hire_confirmed',
      message: '채용이 확정되었습니다! 전자근로계약서를 확인하고 서명해주세요.',
      link: `/rooms/${params.roomId}/contract`,
    })
  }

  return jsonResponse({
    terms: {
      workLocation: merged.work_location,
      jobDescription: merged.job_description,
      contractStartDate: merged.contract_start_date,
      contractEndDate: merged.contract_end_date,
      workHoursStart: merged.work_hours_start,
      workHoursEnd: merged.work_hours_end,
      workDays: merged.work_days,
      restDays: merged.rest_days,
      wageBaseAmount: merged.wage_base_amount,
      wagePayMethod: merged.wage_pay_method,
      wagePayDate: merged.wage_pay_date,
      annualLeave: merged.annual_leave,
      socialInsurance: socialInsuranceJson ? JSON.parse(socialInsuranceJson) : null,
      uniformSize: merged.uniform_size,
      customTerms: customTermsJson ? JSON.parse(customTermsJson) : [],
      analysisWarnings: warnings,
    },
    hireConfirmed,
    hireConfirmedAt,
    confirmationExcerpt,
    reasoning: analysis.reasoning,
  })
}
