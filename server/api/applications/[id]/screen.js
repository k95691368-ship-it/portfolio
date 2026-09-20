import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireManageableApplication, parseCareer, reviewRevisionError } from '../../../_lib/applications.js'
import { screenApplication } from '../../../_lib/claude.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'

// 관리: 지원서 AI 스크리닝 실행. 결과는 저장되어 상세 조회에서 재사용된다.
export async function onRequestPost({ env, data, params, request }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const a = access.application
  const revisionError = await reviewRevisionError(request, a)
  if (revisionError) return revisionError
  if (a.status !== 'submitted' || a.withdrawn_at) return jsonError('심사 대기 중인 지원서만 검토할 수 있습니다.', 409)

  const bucket = `screen:${params.id}`
  const ticket = await checkRateLimit(env, bucket, 3, 60)
  if (!ticket) return jsonError('너무 잦은 요청입니다. 잠시 후 다시 시도해주세요.', 429)

  const posting = await env.DB.prepare(
    'SELECT title, department, employment_type, location, description FROM job_postings WHERE id = ?'
  )
    .bind(a.posting_id)
    .first()

  let result
  try {
    result = await screenApplication(env, {
      posting: {
        title: posting.title,
        department: posting.department,
        employmentType: posting.employment_type,
        location: posting.location,
        description: posting.description,
      },
      application: {
        applicantName: a.applicant_name,
        career: parseCareer(a.career_json),
        coverLetter: a.cover_letter,
        applicationSource: a.application_source,
      },
    })
  } catch (err) {
    // 실패한 시도는 한도에서 뺀다 (한도가 3회라 특히 금방 막힌다).
    await releaseRateLimit(env, bucket, ticket)
    return jsonError(err.message, 502)
  }

  const screening = {
    summary: String(result.summary).slice(0, 2000),
    fit: ['high', 'medium', 'low', 'unknown'].includes(result.fit) ? result.fit : 'unknown',
    fitReason: String(result.fit_reason || '').slice(0, 1000),
    strengths: Array.isArray(result.strengths) ? result.strengths.slice(0, 8).map((s) => String(s).slice(0, 300)) : [],
    concerns: Array.isArray(result.concerns) ? result.concerns.slice(0, 8).map((s) => String(s).slice(0, 300)) : [],
    interviewQuestions: Array.isArray(result.interview_questions)
      ? result.interview_questions.slice(0, 7).map((s) => String(s).slice(0, 300))
      : [],
  }

  const saved = await env.DB.prepare(
    "UPDATE applications SET ai_screening_json = ?, screened_at = datetime('now') WHERE id = ? AND revision = ? AND status = 'submitted' AND withdrawn_at IS NULL"
  )
    .bind(JSON.stringify(screening), params.id, a.revision)
    .run()
  if (!saved.meta?.changes) return jsonError('지원서가 수정·철회되거나 심사가 완료되어 검토 결과를 저장하지 않았습니다. 다시 불러와주세요.', 409)

  return jsonResponse({ ok: true, screening })
}
