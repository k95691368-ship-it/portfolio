import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { analyzeConversation } from '../../../_lib/claude.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { mergeValue, mergeSocialInsurance } from '../../../_lib/merge.js'

const COOLDOWN_SECONDS = 45

export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const { results: messages } = await env.DB.prepare(
    `SELECT m.id, m.body, rp.role_in_room, u.display_name
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_user_id
     JOIN room_participants rp ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
     WHERE m.room_id = ?
     ORDER BY m.id ASC`
  )
    .bind(params.roomId)
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

  const transcript = messages
    .map((m) => `${m.role_in_room === 'company' ? '회사' : '지원자'}(${m.display_name}): ${m.body}`)
    .join('\n')

  const previousTerms = rowToCamelTerms(existing)

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

  const wasConfirmed = !!existing?.hire_confirmed
  const hireConfirmed = analysis.hire_confirmed || wasConfirmed
  const hireConfirmedAt = analysis.hire_confirmed && !wasConfirmed ? new Date().toISOString() : (existing?.hire_confirmed_at ?? null)
  const confirmationExcerpt = analysis.hire_confirmed
    ? (analysis.confirmation_excerpt ?? null)
    : (existing?.hire_confirmation_excerpt ?? null)
  const lastMessageId = messages[messages.length - 1].id

  await env.DB.prepare(
    `INSERT INTO contract_terms (
       room_id, work_location, job_description, contract_start_date, contract_end_date,
       work_hours_start, work_hours_end, work_days, rest_days,
       wage_base_amount, wage_pay_method, wage_pay_date, annual_leave,
       social_insurance_json, uniform_size, custom_terms_json,
       hire_confirmed, hire_confirmed_at, hire_confirmation_excerpt,
       extraction_confidence, last_analyzed_message_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
       updated_at=datetime('now')`
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
      lastMessageId
    )
    .run()

  if (hireConfirmed && !wasConfirmed) {
    await env.DB.prepare("UPDATE interview_rooms SET status = 'contract_pending' WHERE id = ?")
      .bind(params.roomId)
      .run()
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
    },
    hireConfirmed,
    hireConfirmedAt,
    confirmationExcerpt,
    reasoning: analysis.reasoning,
  })
}
