import { jsonResponse, jsonError } from '../../_lib/http.js'
import { canManageRecruiting } from '../../_lib/recruiter.js'

function mapRow(row) {
  return {
    id: row.id,
    postingId: row.posting_id,
    postingTitle: row.posting_title,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    status: row.status,
    createdAt: row.created_at,
  }
}

// 관리: 지원서 목록. 관리자는 전체, 채용자는 본인 공고 지원서만.
// ?posting=<id>, ?status=<submitted|passed|rejected> 필터 지원.
export async function onRequestGet({ env, data, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (!canManageRecruiting(data.user)) return jsonError('채용 관리 권한이 없습니다.', 403)

  const url = new URL(request.url)
  const postingFilter = url.searchParams.get('posting')
  const statusFilter = url.searchParams.get('status')

  const where = []
  const binds = []
  if (!data.user.is_admin) {
    where.push('p.created_by_user_id = ?')
    binds.push(data.user.id)
  }
  if (postingFilter) {
    where.push('a.posting_id = ?')
    binds.push(postingFilter)
  }
  if (statusFilter && ['submitted', 'passed', 'rejected'].includes(statusFilter)) {
    where.push('a.status = ?')
    binds.push(statusFilter)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.posting_id, a.applicant_name, a.applicant_email, a.status, a.created_at,
            p.title AS posting_title
     FROM applications a
     JOIN job_postings p ON p.id = a.posting_id
     ${whereClause}
     ORDER BY a.created_at DESC`
  )
    .bind(...binds)
    .all()

  return jsonResponse({ applications: results.map(mapRow) })
}
