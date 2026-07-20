import { jsonResponse, jsonError } from '../../../_lib/http.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await env.DB.prepare(
    'SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?'
  )
    .bind(params.roomId, data.user.id)
    .first()
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const row = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  if (!row) return jsonResponse({ terms: null, hireConfirmed: false })

  return jsonResponse({
    terms: {
      workLocation: row.work_location,
      jobDescription: row.job_description,
      contractStartDate: row.contract_start_date,
      contractEndDate: row.contract_end_date,
      workHoursStart: row.work_hours_start,
      workHoursEnd: row.work_hours_end,
      workDays: row.work_days,
      restDays: row.rest_days,
      wageBaseAmount: row.wage_base_amount,
      wagePayMethod: row.wage_pay_method,
      wagePayDate: row.wage_pay_date,
      annualLeave: row.annual_leave,
      socialInsurance: row.social_insurance_json ? JSON.parse(row.social_insurance_json) : null,
      uniformSize: row.uniform_size,
      customTerms: row.custom_terms_json ? JSON.parse(row.custom_terms_json) : [],
    },
    hireConfirmed: !!row.hire_confirmed,
    hireConfirmedAt: row.hire_confirmed_at,
    confirmationExcerpt: row.hire_confirmation_excerpt,
    updatedAt: row.updated_at,
  })
}
