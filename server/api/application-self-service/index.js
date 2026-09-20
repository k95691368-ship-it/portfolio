import { jsonResponse } from '../../_lib/http.js'
import { requireApplicationAccess, applicationStatus } from '../../_lib/applicationAccess.js'

export async function onRequestGet(context) {
  const access = await requireApplicationAccess(context)
  if (access.error) return access.error
  const { results } = await context.env.DB.prepare(`SELECT a.id, a.status, a.withdrawn_at, a.lookup_code, a.created_at,
    p.title AS posting_title FROM applications a JOIN job_postings p ON p.id = a.posting_id
    WHERE a.applicant_email = ? AND a.purged_at IS NULL ORDER BY a.created_at DESC LIMIT 101`)
    .bind(access.email).all()
  return jsonResponse({ applications: results.slice(0, 100).map(row => ({ id: row.id, postingTitle: row.posting_title,
    status: applicationStatus(row), lookupCode: row.lookup_code, createdAt: row.created_at })), truncated: results.length > 100 })
}
