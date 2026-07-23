import { jsonResponse, jsonError } from '../../../_lib/http.js'

// 공개: 채용 공고 상세. 모집 중(open)인 공고만 노출. 로그인 불필요.
export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare(
    `SELECT id, title, department, employment_type, location, description, status, deadline, created_at,
            (deadline IS NOT NULL AND deadline < date('now')) AS expired
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
    },
  })
}
