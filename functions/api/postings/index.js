import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'
import { canManageRecruiting } from '../../_lib/recruiter.js'
import { logAdminAction } from '../../_lib/auditLog.js'
import { normalizePostingConditions } from '../../_lib/postingConditions.js'

const TITLE_MAX = 150
const SHORT_MAX = 100
const DESC_MAX = 20000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function mapRow(row) {
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    employmentType: row.employment_type,
    location: row.location,
    status: row.status,
    deadline: row.deadline,
    createdBy: row.created_by_display_name || null,
    applicationCount: row.application_count ?? 0,
    createdAt: row.created_at,
  }
}

// 관리: 채용자는 본인 공고, 관리자는 전체 공고 목록 (지원자 수 포함).
export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (!canManageRecruiting(data.user)) return jsonError('채용 관리 권한이 없습니다.', 403)

  const base = `
    SELECT p.id, p.title, p.department, p.employment_type, p.location, p.status, p.deadline, p.created_at,
           u.display_name AS created_by_display_name,
           (SELECT COUNT(*) FROM applications a WHERE a.posting_id = p.id) AS application_count
    FROM job_postings p
    JOIN users u ON u.id = p.created_by_user_id
  `
  const stmt = data.user.is_admin
    ? env.DB.prepare(`${base} ORDER BY p.created_at DESC`)
    : env.DB.prepare(`${base} WHERE p.created_by_user_id = ? ORDER BY p.created_at DESC`).bind(
        data.user.id
      )

  const { results } = await stmt.all()
  return jsonResponse({ postings: results.map(mapRow) })
}

// 관리: 채용 공고 등록.
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (!canManageRecruiting(data.user)) return jsonError('채용 공고를 등록할 권한이 없습니다.', 403)

  const body = await request.json().catch(() => null)
  const title = (body?.title || '').toString().trim().slice(0, TITLE_MAX)
  const description = (body?.description || '').toString().trim().slice(0, DESC_MAX)
  const department = (body?.department || '').toString().trim().slice(0, SHORT_MAX)
  const employmentType = (body?.employmentType || '').toString().trim().slice(0, SHORT_MAX)
  const location = (body?.location || '').toString().trim().slice(0, SHORT_MAX)
  const deadline = (body?.deadline || '').toString().trim()

  // 공고에 제시하는 근로조건. 계약서와 대조하려면 값으로 남아 있어야 한다
  // (채용절차법 제4조 제3항 — 제시한 조건을 불리하게 바꾸는 것을 금지한다).
  const conditions = normalizePostingConditions(body)

  if (!title) return jsonError('공고 제목을 입력해주세요.', 400)
  if (!description) return jsonError('공고 상세 내용을 입력해주세요.', 400)
  if (deadline && !DATE_RE.test(deadline)) return jsonError('마감일 형식이 올바르지 않습니다.', 400)
  if (conditions.error) return jsonError(conditions.error, 400)

  const id = genId()
  await env.DB.prepare(
    `INSERT INTO job_postings
       (id, created_by_user_id, title, department, employment_type, location, description, deadline,
        wage_type, wage_min, wage_max, work_hours_start, work_hours_end, work_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      data.user.id,
      title,
      department || null,
      employmentType || null,
      location || null,
      description,
      deadline || null,
      conditions.wageType,
      conditions.wageMin,
      conditions.wageMax,
      conditions.workHoursStart,
      conditions.workHoursEnd,
      conditions.workDays
    )
    .run()

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'posting_create',
    detail: title,
  }).catch(() => {})

  return jsonResponse({ ok: true, id }, 201)
}
