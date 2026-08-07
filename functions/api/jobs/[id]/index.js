import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { postingConditionsFromRow } from '../../../_lib/postingConditions.js'

// 공개: 채용 공고 상세. 모집 중(open)인 공고만 노출. 로그인 불필요.
export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare(
    `SELECT id, title, department, employment_type, location, description, status, deadline, created_at,
            wage_type, wage_min, wage_max, work_hours_start, work_hours_end, work_days,
            (deadline IS NOT NULL AND deadline < date('now', '+9 hours')) AS expired
     FROM job_postings
     WHERE id = ?`
  )
    .bind(params.id)
    .first()

  if (!row || row.status !== 'open' || row.expired) {
    return jsonError('마감되었거나 존재하지 않는 채용 공고입니다.', 404)
  }

  return jsonResponse({
    posting: {
      id: row.id,
      title: row.title,
      department: row.department,
      employmentType: row.employment_type,
      location: row.location,
      description: row.description,
      deadline: row.deadline,
      createdAt: row.created_at,
      // 공고에 제시한 근로조건. 지원자가 무엇을 전제로 지원하는지 알고,
      // 나중에 계약서와 대조할 수 있게 값으로 내려준다.
      conditions: postingConditionsFromRow(row),
    },
  })
}
