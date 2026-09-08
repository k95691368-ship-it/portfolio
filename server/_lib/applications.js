import { jsonError } from './http.js'
import { canManagePosting } from './recruiter.js'

// 지원서를 로드하고, 이 사용자가 해당 공고를 관리할 수 있는지 확인.
// 성공: { application } (posting 소유자 컬럼 포함), 실패: { error: Response }.
export async function requireManageableApplication(env, user, appId) {
  if (!user) return { error: jsonError('로그인이 필요합니다.', 401) }

  const row = await env.DB.prepare(
    `SELECT a.*, p.created_by_user_id AS posting_created_by, p.title AS posting_title,
            p.department AS posting_department, p.location AS posting_location,
            p.employment_type AS posting_employment_type
     FROM applications a
     JOIN job_postings p ON p.id = a.posting_id
     WHERE a.id = ?`
  )
    .bind(appId)
    .first()

  if (!row) return { error: jsonError('지원서를 찾을 수 없습니다.', 404) }

  const posting = { id: row.posting_id, created_by_user_id: row.posting_created_by }
  if (!canManagePosting(user, posting)) {
    return { error: jsonError('이 지원서를 관리할 권한이 없습니다.', 403) }
  }

  return { application: row }
}

export function parseCareer(careerJson) {
  if (!careerJson) return []
  try {
    const parsed = JSON.parse(careerJson)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
