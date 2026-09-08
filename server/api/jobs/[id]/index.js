import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { postingConditionsFromRow } from '../../../_lib/postingConditions.js'

// 공개: 채용 공고 상세. 모집 중(open)인 공고만 노출. 로그인 불필요.
//
// 다만 그 공고를 낸 사람과 관리자에게는 마감된 뒤에도 보여 준다. 채용 관리
// 화면에서 자기 공고 제목을 눌렀는데 "존재하지 않는 공고"가 나오면 안 되고,
// 무엇보다 공고에 무엇을 적었는지는 계약 조건이 공고보다 불리해졌는지를
// 따지는 판정(채용절차법 제4조 제3항)의 기준이라 마감 뒤에도 확인할 수 있어야
// 한다. 지원 버튼은 내려간다 — 볼 수 있는 것과 지원할 수 있는 것은 다르다.
export async function onRequestGet({ env, params, data }) {
  const row = await env.DB.prepare(
    `SELECT id, title, department, employment_type, location, description, status, deadline, created_at,
            created_by_user_id,
            wage_type, wage_min, wage_max, work_hours_start, work_hours_end, work_days,
            (deadline IS NOT NULL AND deadline < date('now', '+9 hours')) AS expired
     FROM job_postings
     WHERE id = ?`
  )
    .bind(params.id)
    .first()

  if (!row) return jsonError('마감되었거나 존재하지 않는 채용 공고입니다.', 404)

  const user = data?.user ?? null
  const isOwner = !!user && (user.is_admin || row.created_by_user_id === user.id)
  const open = row.status === 'open' && !row.expired
  if (!open && !isOwner) {
    return jsonError('마감되었거나 존재하지 않는 채용 공고입니다.', 404)
  }

  return jsonResponse({
    posting: {
      id: row.id,
      // 마감된 공고를 보고 있는 것인지 화면이 알아야 지원 버튼을 내린다.
      open,
      closedReason: open ? null : row.expired ? 'expired' : 'closed',
      viewerIsOwner: isOwner,
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
