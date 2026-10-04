import { jsonResponse, jsonError } from '../../_lib/http.js'
import { canManageRecruiting } from '../../_lib/recruiter.js'
import { applicationStatus } from '../../_lib/applicationAccess.js'

const PAGE_SIZE = 100
const STATUSES = new Set(['submitted', 'passed', 'rejected', 'withdrawn'])

async function filterScope(user, posting, status, search) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify([user.id, !!user.is_admin, posting, status, search])
  ))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function encodeCursor(row, scope) {
  const bytes = new TextEncoder().encode(JSON.stringify({ at: row.created_at, id: row.id, scope }))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(value, scope) {
  if (!/^[A-Za-z0-9_-]{1,1500}$/.test(value)) return null
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
    const cursor = JSON.parse(new TextDecoder().decode(bytes))
    return cursor?.scope === scope && typeof cursor.at === 'string' && cursor.at.length <= 40
      && Number.isFinite(Date.parse(cursor.at)) && typeof cursor.id === 'string' && cursor.id.length > 0
      && cursor.id.length <= 100 ? cursor : null
  } catch { return null }
}

function mapRow(row) {
  return {
    id: row.id,
    postingId: row.posting_id,
    postingTitle: row.posting_title,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    status: applicationStatus(row),
    createdAt: row.created_at,
  }
}

// 관리: 지원서 목록. 관리자는 전체, 채용자는 본인 공고 지원서만.
// 필터는 전체 자료에 먼저 적용하고, 날짜·ID로 다음 페이지를 이어간다.
export async function onRequestGet({ env, data, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (!canManageRecruiting(data.user)) return jsonError('채용 관리 권한이 없습니다.', 403)

  const url = new URL(request.url)
  const postingFilter = (url.searchParams.get('posting') || '').trim()
  const statusFilter = url.searchParams.get('status') || ''
  const search = (url.searchParams.get('q') || '').trim().toLowerCase()
  if (postingFilter.length > 100 || search.length > 200 || (statusFilter && !STATUSES.has(statusFilter))) {
    return jsonError('지원서 검색 조건을 확인해주세요.', 400)
  }
  const scope = await filterScope(data.user, postingFilter, statusFilter, search)
  const rawCursor = url.searchParams.get('cursor') || ''
  const cursor = rawCursor ? decodeCursor(rawCursor, scope) : null
  if (rawCursor && !cursor) return jsonError('목록 위치가 유효하지 않습니다. 첫 페이지부터 다시 조회해주세요.', 400)

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
  if (statusFilter === 'withdrawn') where.push('a.withdrawn_at IS NOT NULL')
  else if (statusFilter) {
    where.push('a.status = ?')
    where.push('a.withdrawn_at IS NULL')
    binds.push(statusFilter)
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, character => `\\${character}`)}%`
    where.push("(LOWER(a.applicant_name) LIKE ? ESCAPE '\\' OR LOWER(a.applicant_email) LIKE ? ESCAPE '\\' OR LOWER(p.title) LIKE ? ESCAPE '\\')")
    binds.push(like, like, like)
  }
  if (cursor) {
    where.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')
    binds.push(cursor.at, cursor.at, cursor.id)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.posting_id, a.applicant_name, a.applicant_email, a.status, a.withdrawn_at, a.created_at,
            p.title AS posting_title
     FROM applications a
     JOIN job_postings p ON p.id = a.posting_id
     ${whereClause}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?`
  )
    .bind(...binds, PAGE_SIZE + 1)
    .all()

  const hasMore = results.length > PAGE_SIZE
  const rows = hasMore ? results.slice(0, PAGE_SIZE) : results
  return jsonResponse({
    applications: rows.map(mapRow),
    truncated: hasMore,
    limit: PAGE_SIZE,
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1], scope) : null,
  })
}
