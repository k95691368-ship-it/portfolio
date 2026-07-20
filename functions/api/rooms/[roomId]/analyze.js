import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { analyzeConversation } from '../../../_lib/claude.js'

const COOLDOWN_SECONDS = 45

function toCamelTerms(row) {
  return {
    workLocation: row.work_location ?? null,
    jobDescription: row.job_description ?? null,
    contractStartDate: row.contract_start_date ?? null,
    contractEndDate: row.contract_end_date ?? null,
    workHoursStart: row.work_hours_start ?? null,
    workHoursEnd: row.work_hours_end ?? null,
    workDays: row.work_days ?? null,
    restDays: row.rest_days ?? null,
    wageBaseAmount: row.wage_base_amount ?? null,
    wagePayMethod: row.wage_pay_method ?? null,
    wagePayDate: row.wage_pay_date ?? null,
    annualLeave: row.annual_leave ?? null,
    socialInsurance: row.social_insurance_json ? JSON.parse(row.social_insurance_json) : null,
    uniformSize: row.uniform_size ?? null,
    customTerms: row.custom_terms_json ? JSON.parse(row.custom_terms_json) : [],
  }
}

export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await env.DB.prepare(
    'SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?'
  )
    .bind(params.roomId, data.user.id)
    .first()
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const existing = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  if (existing) {
    const secondsSinceUpdate = (Date.now() - new Date(`${existing.updated_at}Z`).getTime()) / 1000
    if (secondsSinceUpdate < COOLDOWN_SECONDS) {
      return jsonError(
        `너무 잦은 요청입니다. ${Math.ceil(COOLDOWN_SECONDS - secondsSinceUpdate)}초 후 다시 시도해주세요.`,
        429
      )
    }
  }

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

  const transcript = messages
    .map((m) => `${m.role_in_room === 'company' ? '회사' : '지원자'}(${m.display_name}): ${m.body}`)
    .join('\n')

  const previousTerms = existing ? toCamelTerms(existing) : null

  let analysis
  try {
    analysis = await analyzeConversation(env, transcript, previousTerms)
  } catch (err) {
    return jsonError(err.message, 502)
  }

  const t = analysis.terms || {}
  const merge = (newVal, oldVal) => (newVal === null || newVal === undefined ? (oldVal ?? null) : newVal)

  const merged = {
    work_location: merge(t.work_location, existing?.work_location),
    job_description: merge(t.job_description, existing?.job_description),
    contract_start_date: merge(t.contract_start_date, existing?.contract_start_date),
    contract_end_date: merge(t.contract_end_date, existing?.contract_end_date),
    work_hours_start: merge(t.work_hours_start, existing?.work_hours_start),
    work_hours_end: merge(t.work_hours_end, existing?.work_hours_end),
    work_days: merge(t.work_days, existing?.work_days),
    rest_days: merge(t.rest_days, existing?.rest_days),
    wage_base_amount: merge(t.wage_base_amount, existing?.wage_base_amount),
    wage_pay_method: merge(t.wage_pay_method, existing?.wage_pay_method),
    wage_pay_date: merge(t.wage_pay_date, existing?.wage_pay_date),
    annual_leave: merge(t.annual_leave, existing?.annual_leave),
    uniform_size: merge(t.uniform_size, existing?.uniform_size),
  }
  const socialInsuranceJson = t.social_insurance
    ? JSON.stringify(t.social_insurance)
    : (existing?.social_insurance_json ?? null)
  const customTermsJson =
    t.custom_terms && t.custom_terms.length > 0
      ? JSON.stringify(t.custom_terms)
      : (existing?.custom_terms_json ?? null)

  const wasConfirmed = !!existing?.hire_confirmed
  const hireConfirmed = analysis.hire_confirmed || wasConfirmed
  const hireConfirmedAt = analysis.hire_confirmed && !wasConfirmed ? new Date().toISOString() : (existing?.hire_confirmed_at ?? null)
  const confirmationExcerpt = analysis.hire_confirmed
    ? analysis.confirmation_excerpt
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
