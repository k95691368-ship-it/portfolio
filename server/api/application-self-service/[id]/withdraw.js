import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireApplicationAccess } from '../../../_lib/applicationAccess.js'

export async function onRequestPost(context) {
  const { env, request, params } = context
  const access = await requireApplicationAccess(context, params.id)
  if (access.error) return access.error
  const body = await request.json().catch(() => null)
  if (access.application.withdrawn_at) return jsonResponse({ ok: true, status: 'withdrawn' })
  if (!Number.isSafeInteger(body?.revision)) return jsonError('지원서를 다시 불러와 확인해주세요.', 400)
  const result = await env.DB.prepare(`UPDATE applications SET withdrawn_at = datetime('now'), revision = revision + 1,
    ai_screening_json = NULL, screened_at = NULL WHERE id = ? AND revision = ?
    AND status = 'submitted' AND withdrawn_at IS NULL AND purged_at IS NULL`)
    .bind(params.id, body.revision).run()
  return result.meta?.changes ? jsonResponse({ ok: true, status: 'withdrawn' })
    : jsonError('지원서가 변경되었거나 이미 심사가 완료되어 철회할 수 없습니다. 다시 불러와 확인해주세요.', 409)
}
