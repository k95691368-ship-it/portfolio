import { jsonResponse, jsonError } from '../_lib/http.js'
import { describeApplicationProgress, sortMyApplications } from '../_lib/applicationProgress.js'

const LIMIT = 50

// 로그인한 사용자가 자기 지원서를 모아 본다.
//
// 지원은 로그인 없이도 할 수 있고, 서류합격하면 그 이메일로 계정이 만들어진다.
// 그래서 지원서와 계정을 잇는 끈은 두 가지다 — 합격 시 만들어진 계정 연결과,
// 아이디로 쓰는 이메일. 둘 중 하나라도 맞으면 본인 지원서로 본다.
export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.status, a.created_at, a.reviewed_at, a.room_id, a.lookup_code,
            p.title AS posting_title, p.department, p.employment_type, p.location,
            r.status AS room_status, r.title AS room_title,
            sc.created_at AS signed_at
       FROM applications a
       JOIN job_postings p ON p.id = a.posting_id
       LEFT JOIN interview_rooms r ON r.id = a.room_id
       LEFT JOIN signed_contracts sc ON sc.room_id = a.room_id
      WHERE a.created_user_id = ? OR LOWER(a.applicant_email) = LOWER(?)
      ORDER BY a.created_at DESC
      LIMIT ?`
  )
    .bind(data.user.id, data.user.email, LIMIT)
    .all()

  const applications = results.map((r) => {
    const base = {
      id: r.id,
      postingTitle: r.posting_title,
      department: r.department,
      employmentType: r.employment_type,
      location: r.location,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
      roomId: r.room_id,
      roomStatus: r.room_status,
      roomTitle: r.room_title,
      signedAt: r.signed_at,
      lookupCode: r.lookup_code,
    }
    return { ...base, progress: describeApplicationProgress(base) }
  })

  return jsonResponse({ applications: sortMyApplications(applications) })
}
