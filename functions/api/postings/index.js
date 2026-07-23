import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'
import { canManageRecruiting } from '../../_lib/recruiter.js'

const TITLE_MAX = 150
const SHORT_MAX = 100
const DESC_MAX = 20000

function mapRow(row) {
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    employmentType: row.employment_type,
    location: row.location,
    status: row.status,
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
    SELECT p.id, p.title, p.department, p.employment_type, p.location, p.status, p.created_at,
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

  if (!title) return jsonError('공고 제목을 입력해주세요.', 400)
  if (!description) return jsonError('공고 상세 내용을 입력해주세요.', 400)

  const id = genId()
  await env.DB.prepare(
    `INSERT INTO job_postings (id, created_by_user_id, title, department, employment_type, location, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, data.user.id, title, department || null, employmentType || null, location || null, description)
    .run()

  return jsonResponse({ ok: true, id }, 201)
}
