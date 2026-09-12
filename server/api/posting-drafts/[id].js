import { jsonResponse, jsonError } from '../../_lib/http.js'
import { draftAccess, draftFields, validDraftId } from '../../_lib/postingDrafts.js'

export async function onRequestGet({ env, data, params }) {
  const denied = draftAccess(data.user)
  if (denied) return denied
  if (!validDraftId(params.id)) return jsonError('임시저장 공고를 찾을 수 없습니다.', 404)
  const row = await env.DB.prepare(
    `SELECT id, payload, revision, updated_at FROM posting_drafts
     WHERE id = ? AND user_id = ? AND published_at IS NULL`
  ).bind(params.id, data.user.id).first()
  if (!row) return jsonError('임시저장 공고를 찾을 수 없습니다.', 404)
  return jsonResponse({ draft: {
    id: row.id, fields: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at,
  } })
}

export async function onRequestPut({ request, env, data, params }) {
  const denied = draftAccess(data.user)
  if (denied) return denied
  if (!validDraftId(params.id)) return jsonError('임시저장 요청이 올바르지 않습니다.', 400)
  const body = await request.json().catch(() => null)
  const fields = draftFields(body?.fields)
  const revision = body?.revision
  if (!fields || !Number.isSafeInteger(revision) || revision < 0) {
    return jsonError('입력 내용의 형식 또는 길이를 확인해주세요.', 400)
  }
  const payload = JSON.stringify(fields)
  const now = new Date().toISOString()
  const result = revision === 0
    ? await env.DB.prepare(
      `INSERT INTO posting_drafts (id, user_id, title, payload, revision, updated_at)
       VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING`
    ).bind(params.id, data.user.id, fields.title, payload, now).run()
    : await env.DB.prepare(
      `UPDATE posting_drafts SET title = ?, payload = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND revision = ? AND published_at IS NULL`
    ).bind(fields.title, payload, now, params.id, data.user.id, revision).run()
  if (!result.meta.changes) {
    // Identical retry after a lost response is safe; never overwrite a newer edit.
    const existing = await env.DB.prepare(
      `SELECT payload, revision, updated_at FROM posting_drafts
       WHERE id = ? AND user_id = ? AND published_at IS NULL`
    ).bind(params.id, data.user.id).first()
    if (existing?.payload === payload && existing.revision === revision + 1) {
      return jsonResponse({ id: params.id, revision: existing.revision, updatedAt: existing.updated_at })
    }
    return jsonError('다른 창에서 변경되었거나 사용할 수 없는 임시저장 공고입니다. 목록에서 다시 불러와주세요.', 409)
  }
  return jsonResponse({ id: params.id, revision: revision + 1, updatedAt: now })
}
