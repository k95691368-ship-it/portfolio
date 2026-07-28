import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { canManagePosting } from '../../../_lib/recruiter.js'
import { parseCareer } from '../../../_lib/applications.js'
import { rankApplicants, summarizeRanking } from '../../../_lib/ranking.js'

const MAX_APPLICANTS = 300

// 관리: 한 공고의 지원자를 한 화면에서 비교한다.
//
// 지원서 하나하나를 눌러 들어가지 않고 같은 기준으로 견줄 수 있게, 이미
// 저장된 AI 심사 결과와 경력을 모아 결정론적으로 정렬해 돌려준다.
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const posting = await env.DB.prepare(
    'SELECT id, created_by_user_id, title, department, employment_type, location FROM job_postings WHERE id = ?'
  )
    .bind(params.id)
    .first()
  if (!posting) return jsonError('채용 공고를 찾을 수 없습니다.', 404)
  if (!canManagePosting(data.user, posting)) {
    return jsonError('이 공고의 지원자를 볼 권한이 없습니다.', 403)
  }

  const { results } = await env.DB.prepare(
    `SELECT id, applicant_name, status, created_at, career_json, ai_screening_json
       FROM applications
      WHERE posting_id = ?
      ORDER BY created_at ASC
      LIMIT ?`
  )
    .bind(params.id, MAX_APPLICANTS)
    .all()

  const rows = results.map((r) => {
    let screening = null
    if (r.ai_screening_json) {
      try {
        screening = JSON.parse(r.ai_screening_json)
      } catch {
        screening = null
      }
    }
    return {
      id: r.id,
      applicantName: r.applicant_name,
      status: r.status,
      createdAt: r.created_at,
      career: parseCareer(r.career_json),
      screening,
    }
  })

  const ranked = rankApplicants(rows)

  return jsonResponse({
    posting: {
      id: posting.id,
      title: posting.title,
      department: posting.department,
      employmentType: posting.employment_type,
      location: posting.location,
    },
    summary: summarizeRanking(ranked),
    applicants: ranked,
  })
}
