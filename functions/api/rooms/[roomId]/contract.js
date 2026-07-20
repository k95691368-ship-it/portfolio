import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'

const EDITABLE_FIELDS = {
  employerName: 'employer_name',
  employerAddress: 'employer_address',
  employeeName: 'employee_name',
  employeeAddress: 'employee_address',
  workLocation: 'work_location',
  jobDescription: 'job_description',
  contractStartDate: 'contract_start_date',
  contractEndDate: 'contract_end_date',
  workHoursStart: 'work_hours_start',
  workHoursEnd: 'work_hours_end',
  workDays: 'work_days',
  restDays: 'rest_days',
  wageBaseAmount: 'wage_base_amount',
  wagePayMethod: 'wage_pay_method',
  wagePayDate: 'wage_pay_date',
  annualLeave: 'annual_leave',
  uniformSize: 'uniform_size',
}

async function loadParticipant(env, roomId, userId) {
  return env.DB.prepare('SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first()
}

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await loadParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const row = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  if (!row) return jsonResponse({ terms: null, hireConfirmed: false })

  return jsonResponse({
    terms: rowToCamelTerms(row),
    hireConfirmed: !!row.hire_confirmed,
    hireConfirmedAt: row.hire_confirmed_at,
    confirmationExcerpt: row.hire_confirmation_excerpt,
    updatedAt: row.updated_at,
  })
}

export async function onRequestPatch({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await loadParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') return jsonError('이미 서명이 완료된 계약서는 수정할 수 없습니다.', 409)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

  const columns = []
  const values = []
  for (const [camelKey, column] of Object.entries(EDITABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
      columns.push(column)
      values.push(body[camelKey] === '' ? null : body[camelKey])
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'socialInsurance')) {
    columns.push('social_insurance_json')
    values.push(body.socialInsurance ? JSON.stringify(body.socialInsurance) : null)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'customTerms')) {
    columns.push('custom_terms_json')
    values.push(body.customTerms && body.customTerms.length > 0 ? JSON.stringify(body.customTerms) : null)
  }

  if (columns.length === 0) return jsonError('수정할 항목이 없습니다.', 400)

  const existing = await env.DB.prepare('SELECT room_id FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  if (existing) {
    const setSql = columns.map((c) => `${c} = ?`).join(', ') + ", updated_at = datetime('now')"
    await env.DB.prepare(`UPDATE contract_terms SET ${setSql} WHERE room_id = ?`)
      .bind(...values, params.roomId)
      .run()
  } else {
    const insertCols = ['room_id', ...columns]
    const placeholders = insertCols.map(() => '?').join(', ')
    await env.DB.prepare(`INSERT INTO contract_terms (${insertCols.join(', ')}) VALUES (${placeholders})`)
      .bind(params.roomId, ...values)
      .run()
  }

  const row = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  return jsonResponse({
    terms: rowToCamelTerms(row),
    hireConfirmed: !!row.hire_confirmed,
    hireConfirmedAt: row.hire_confirmed_at,
    confirmationExcerpt: row.hire_confirmation_excerpt,
    updatedAt: row.updated_at,
  })
}
