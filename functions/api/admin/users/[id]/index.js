import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { deleteAllUserSessions } from '../../../../_lib/auth.js'

export async function onRequestPatch({ request, env, data, params }) {
  if (params.id === data.user.id) {
    return jsonError('본인 계정 상태는 이 화면에서 변경할 수 없습니다.', 403)
  }

  const body = await request.json().catch(() => null)
  if (typeof body?.isSuspended !== 'boolean') {
    return jsonError('isSuspended 값(boolean)이 필요합니다.', 400)
  }

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(params.id).first()
  if (!target) return jsonError('사용자를 찾을 수 없습니다.', 404)

  await env.DB.prepare('UPDATE users SET is_suspended = ? WHERE id = ?')
    .bind(body.isSuspended ? 1 : 0, params.id)
    .run()

  if (body.isSuspended) {
    await deleteAllUserSessions(env.DB, params.id)
  }

  return jsonResponse({ ok: true, user: { id: params.id, isSuspended: body.isSuspended } })
}

export async function onRequestDelete({ env, data, params }) {
  if (params.id === data.user.id) {
    return jsonError('본인 계정은 삭제할 수 없습니다.', 403)
  }

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(params.id).first()
  if (!target) return jsonError('사용자를 찾을 수 없습니다.', 404)

  const participation = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM room_participants WHERE user_id = ?'
  )
    .bind(params.id)
    .first()

  if (participation.count > 0) {
    return jsonError(
      '면접방에 참여한 기록이 있는 계정은 영구 삭제할 수 없습니다. 계정 정지를 이용해주세요.',
      409
    )
  }

  // documents.user_id isn't covered by the room_participants guard above and
  // isn't referenced by any JOIN elsewhere, but leaving it behind would orphan
  // an R2 object and a dangling row forever, so clean it up as part of delete.
  const { results: docs } = await env.DB.prepare('SELECT r2_key FROM documents WHERE user_id = ?')
    .bind(params.id)
    .all()
  await Promise.allSettled(docs.map((d) => env.DOCUMENTS.delete(d.r2_key)))

  await env.DB.batch([
    env.DB.prepare('DELETE FROM documents WHERE user_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(params.id),
  ])

  return jsonResponse({ ok: true, deleted: true })
}
