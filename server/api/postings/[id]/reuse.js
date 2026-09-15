import { jsonError, jsonResponse } from '../../../_lib/http.js'
import { draftAccess } from '../../../_lib/postingDrafts.js'
import { reusablePostingFields } from '../../../../shared/postingReuse.js'

export async function onRequestGet({ env, data, params }) {
  const denied = draftAccess(data.user)
  if (denied) return denied
  const row = await env.DB.prepare(`SELECT title, department, employment_type, location, description,
    wage_type, wage_min, wage_max, work_hours_start, work_hours_end, work_days
    FROM job_postings WHERE id = ? AND created_by_user_id = ?`).bind(params.id, data.user.id).first()
  if (!row) return jsonError('본인이 작성한 공고만 불러올 수 있습니다.', 404)
  return jsonResponse({ fields: reusablePostingFields(row) })
}
