import { jsonResponse } from '../../_lib/http.js'

function mapPostingSummary(row) {
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    employmentType: row.employment_type,
    location: row.location,
    deadline: row.deadline,
    createdAt: row.created_at,
  }
}

// 공개: 모집 중(open)이며 마감일이 지나지 않은 채용 공고 목록. 로그인 불필요.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, department, employment_type, location, deadline, created_at
     FROM job_postings
     WHERE status = 'open' AND (deadline IS NULL OR deadline >= date('now'))
     ORDER BY created_at DESC`
  ).all()

  return jsonResponse({ postings: results.map(mapPostingSummary) })
}
