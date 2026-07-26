import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'

function maskName(name) {
  const s = String(name || '')
  if (s.length <= 1) return s
  return s[0] + '*'.repeat(s.length - 1)
}

// 공개: 접수번호로 본인 지원 심사 상태 조회. 로그인 불필요.
export async function onRequestGet({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `status-lookup:${ip}`, 20, 600)
  if (!allowed) return jsonError('조회 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const url = new URL(request.url)
  const code = (url.searchParams.get('code') || '').trim().toUpperCase()
  if (!code || code.length < 8 || code.length > 20) {
    return jsonError('접수번호를 입력해주세요.', 400)
  }

  const row = await env.DB.prepare(
    `SELECT a.applicant_name, a.status, a.created_at, a.reviewed_at, p.title AS posting_title
     FROM applications a
     JOIN job_postings p ON p.id = a.posting_id
     WHERE a.lookup_code = ?`
  )
    .bind(code)
    .first()

  if (!row) return jsonError('해당 접수번호의 지원 내역을 찾을 수 없습니다.', 404)

  return jsonResponse({
    postingTitle: row.posting_title,
    applicantName: maskName(row.applicant_name),
    status: row.status,
    submittedAt: row.created_at,
    reviewedAt: row.reviewed_at,
  })
}
