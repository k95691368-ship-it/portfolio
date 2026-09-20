import { jsonError } from './http.js'

export function applicationStatus(row) {
  return row.withdrawn_at ? 'withdrawn' : row.status
}

export function randomCapability() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')
}

export async function hashCapability(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function submissionHash(postingId, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
  return hashCapability(`application-submit:${postingId}:${token}`)
}

export async function requireApplicationAccess({ env, request }, applicationId = null) {
  const authorization = request.headers.get('X-Application-Authorization') || ''
  const token = authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!token) return { error: jsonError('이메일의 확인 링크로 지원 내역을 열어주세요.', 401) }
  const session = await env.DB.prepare(`SELECT email FROM application_access_sessions
    WHERE token_hash = ? AND datetime(expires_at) > datetime('now')`)
    .bind(await hashCapability(token)).first()
  if (!session) return { error: jsonError('확인 시간이 만료되었습니다. 이메일 확인 링크를 다시 요청해주세요.', 401) }
  if (!applicationId) return { email: session.email }
  const application = await env.DB.prepare(`SELECT a.*, p.title AS posting_title, p.status AS posting_status,
    (p.deadline IS NOT NULL AND p.deadline < date('now', '+9 hours')) AS posting_expired
    FROM applications a JOIN job_postings p ON p.id = a.posting_id
    WHERE a.id = ? AND a.applicant_email = ? AND a.purged_at IS NULL`)
    .bind(applicationId, session.email).first()
  if (!application) return { error: jsonError('지원 내역을 찾을 수 없습니다.', 404) }
  return { email: session.email, application }
}

export async function applicationSelfView(env, row) {
  const { results: documents } = await env.DB.prepare(`SELECT id, doc_type, filename, size_bytes
    FROM application_documents WHERE application_id = ? AND superseded_at IS NULL ORDER BY uploaded_at`)
    .bind(row.id).all()
  let career = []
  try { career = JSON.parse(row.career_json || '[]') } catch { /* Invalid old data stays readable. */ }
  return {
    id: row.id, postingId: row.posting_id, postingTitle: row.posting_title,
    applicantName: row.applicant_name, applicantEmail: row.applicant_email, applicantPhone: row.applicant_phone,
    career: Array.isArray(career) ? career : [], applicationSource: row.application_source || '', coverLetter: row.cover_letter || '',
    consentOptional: !!row.consent_optional, status: applicationStatus(row), revision: row.revision,
    lookupCode: row.lookup_code, createdAt: row.created_at, reviewedAt: row.reviewed_at, withdrawnAt: row.withdrawn_at,
    canEdit: row.status === 'submitted' && !row.withdrawn_at && row.posting_status === 'open' && !row.posting_expired,
    canWithdraw: row.status === 'submitted' && !row.withdrawn_at,
    documents: documents.map(doc => ({ id: doc.id, docType: doc.doc_type, filename: doc.filename, sizeBytes: doc.size_bytes })),
  }
}
