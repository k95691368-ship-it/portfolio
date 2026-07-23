import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { canManagePosting } from '../../../_lib/recruiter.js'
import { logAdminAction } from '../../../_lib/auditLog.js'

const TITLE_MAX = 150
const SHORT_MAX = 100
const DESC_MAX = 20000

async function loadPosting(env, id) {
  return env.DB.prepare(
    `SELECT id, created_by_user_id, title, department, employment_type, location, description, status, created_at
     FROM job_postings WHERE id = ?`
  )
    .bind(id)
    .first()
}

// 관리: 공고 상세 (수정 화면용, 상태 무관).
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const posting = await loadPosting(env, params.id)
  if (!posting) return jsonError('채용 공고를 찾을 수 없습니다.', 404)
  if (!canManagePosting(data.user, posting)) return jsonError('이 공고를 관리할 권한이 없습니다.', 403)

  return jsonResponse({
    posting: {
      id: posting.id,
      title: posting.title,
      department: posting.department,
      employmentType: posting.employment_type,
      location: posting.location,
      description: posting.description,
      status: posting.status,
      createdAt: posting.created_at,
    },
  })
}

// 관리: 공고 내용/상태 수정.
export async function onRequestPatch({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const posting = await loadPosting(env, params.id)
  if (!posting) return jsonError('채용 공고를 찾을 수 없습니다.', 404)
  if (!canManagePosting(data.user, posting)) return jsonError('이 공고를 수정할 권한이 없습니다.', 403)

  const body = await request.json().catch(() => null)
  if (!body) return jsonError('잘못된 요청입니다.', 400)

  const fields = []
  const values = []

  if (body.title !== undefined) {
    const title = body.title.toString().trim().slice(0, TITLE_MAX)
    if (!title) return jsonError('공고 제목을 입력해주세요.', 400)
    fields.push('title = ?')
    values.push(title)
  }
  if (body.description !== undefined) {
    const description = body.description.toString().trim().slice(0, DESC_MAX)
    if (!description) return jsonError('공고 상세 내용을 입력해주세요.', 400)
    fields.push('description = ?')
    values.push(description)
  }
  if (body.department !== undefined) {
    fields.push('department = ?')
    values.push(body.department.toString().trim().slice(0, SHORT_MAX) || null)
  }
  if (body.employmentType !== undefined) {
    fields.push('employment_type = ?')
    values.push(body.employmentType.toString().trim().slice(0, SHORT_MAX) || null)
  }
  if (body.location !== undefined) {
    fields.push('location = ?')
    values.push(body.location.toString().trim().slice(0, SHORT_MAX) || null)
  }
  if (body.status !== undefined) {
    if (!['open', 'closed'].includes(body.status)) return jsonError('상태 값이 올바르지 않습니다.', 400)
    fields.push('status = ?')
    values.push(body.status)
  }

  if (fields.length === 0) return jsonError('수정할 내용이 없습니다.', 400)

  fields.push("updated_at = datetime('now')")
  values.push(params.id)
  await env.DB.prepare(`UPDATE job_postings SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()

  if (body.status !== undefined && body.status !== posting.status) {
    await logAdminAction(env, {
      actorId: data.user.id,
      action: body.status === 'closed' ? 'posting_close' : 'posting_reopen',
      detail: posting.title,
    }).catch(() => {})
  }

  return jsonResponse({ ok: true })
}

// 관리: 공고 삭제 — 지원 이력이 있으면 마감(closed)을 안내하며 차단.
export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const posting = await loadPosting(env, params.id)
  if (!posting) return jsonError('채용 공고를 찾을 수 없습니다.', 404)
  if (!canManagePosting(data.user, posting)) return jsonError('이 공고를 삭제할 권한이 없습니다.', 403)

  const hasApplications = await env.DB.prepare(
    `SELECT 1 FROM applications WHERE posting_id = ? LIMIT 1`
  )
    .bind(params.id)
    .first()
  if (hasApplications) {
    return jsonError('지원 이력이 있는 공고는 삭제할 수 없습니다. 대신 마감 처리해주세요.', 409)
  }

  await env.DB.prepare('DELETE FROM job_postings WHERE id = ?').bind(params.id).run()

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'posting_delete',
    detail: posting.title,
  }).catch(() => {})

  return jsonResponse({ ok: true })
}
