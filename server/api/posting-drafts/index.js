import { jsonResponse } from '../../_lib/http.js'
import { draftAccess } from '../../_lib/postingDrafts.js'

export async function onRequestGet({ env, data }) {
  const denied = draftAccess(data.user)
  if (denied) return denied
  // No administrator override: unpublished content belongs only to its author.
  const { results } = await env.DB.prepare(
    `SELECT id, title, revision, updated_at FROM posting_drafts
     WHERE user_id = ? AND published_at IS NULL ORDER BY updated_at DESC, id`
  ).bind(data.user.id).all()
  return jsonResponse({ drafts: results.map(row => ({
    id: row.id, title: row.title, revision: row.revision, updatedAt: row.updated_at,
  })) })
}
