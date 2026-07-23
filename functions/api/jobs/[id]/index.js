import { jsonResponse, jsonError } from '../../../_lib/http.js'

// 공개: 채용 공고 상세. 모집 중(open)인 공고만 노출. 로그인 불필요.
export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare(
    `SELECT id, title, department, employment_type, location, description, status, created_at
     FROM job_postings
     WHERE id = ?`
  )
    .bind(params.id)
    .first()

  if (!row || row.status !== 'open') {
    return jsonError('채용 공고를 찾을 수 없습니다.', 404)
  }

  return jsonResponse({
    posting: {
      id: row.id,
      title: row.title,
      department: row.department,
      employmentType: row.employment_type,
      location: row.location,
      description: row.description,
      createdAt: row.created_at,
    },
  })
}
