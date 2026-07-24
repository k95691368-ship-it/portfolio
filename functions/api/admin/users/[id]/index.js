import { jsonResponse, jsonError } from '../../../../_lib/http.js'
import { deleteAllUserSessions } from '../../../../_lib/auth.js'
import { logAdminAction } from '../../../../_lib/auditLog.js'

export async function onRequestPatch({ request, env, data, params }) {
  if (params.id === data.user.id) {
    return jsonError('본인 계정 상태는 이 화면에서 변경할 수 없습니다.', 403)
  }

  const body = await request.json().catch(() => null)
  const hasSuspended = typeof body?.isSuspended === 'boolean'
  const hasRecruiter = typeof body?.isRecruiter === 'boolean'
  if (!hasSuspended && !hasRecruiter) {
    return jsonError('isSuspended 또는 isRecruiter 값(boolean)이 필요합니다.', 400)
  }

  const target = await env.DB.prepare('SELECT id, email, is_admin, is_developer FROM users WHERE id = ?').bind(params.id).first()
  if (!target) return jsonError('사용자를 찾을 수 없습니다.', 404)
  // 개발자 계정은 API로 누구도 변경할 수 없다 (DB 직접 조작 전용).
  if (target.is_developer) {
    return jsonError('개발자 계정은 변경할 수 없습니다.', 403)
  }
  // 관리자 계정은 개발자만 변경할 수 있다 (계정 잠금·탈취 방지).
  if (target.is_admin && !data.user.is_developer) {
    return jsonError('관리자 계정은 개발자 권한만 변경할 수 있습니다.', 403)
  }

  const setClauses = []
  const values = []
  if (hasSuspended) {
    setClauses.push('is_suspended = ?')
    values.push(body.isSuspended ? 1 : 0)
  }
  if (hasRecruiter) {
    setClauses.push('is_recruiter = ?')
    values.push(body.isRecruiter ? 1 : 0)
  }

  await env.DB.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values, params.id)
    .run()

  if (hasSuspended && body.isSuspended) {
    await deleteAllUserSessions(env.DB, params.id)
  }

  if (hasSuspended) {
    await logAdminAction(env, {
      actorId: data.user.id,
      action: body.isSuspended ? 'suspend_user' : 'unsuspend_user',
      targetUserId: params.id,
      detail: `email=${target.email}`,
    })
  }
  if (hasRecruiter) {
    await logAdminAction(env, {
      actorId: data.user.id,
      action: body.isRecruiter ? 'grant_recruiter' : 'revoke_recruiter',
      targetUserId: params.id,
      detail: `email=${target.email}`,
    })
  }

  return jsonResponse({
    ok: true,
    user: {
      id: params.id,
      ...(hasSuspended ? { isSuspended: body.isSuspended } : {}),
      ...(hasRecruiter ? { isRecruiter: body.isRecruiter } : {}),
    },
  })
}

export async function onRequestDelete({ env, data, params }) {
  if (params.id === data.user.id) {
    return jsonError('본인 계정은 삭제할 수 없습니다.', 403)
  }

  const target = await env.DB.prepare('SELECT id, email, is_admin, is_developer FROM users WHERE id = ?').bind(params.id).first()
  if (!target) return jsonError('사용자를 찾을 수 없습니다.', 404)
  // 개발자 계정은 API로 누구도 삭제할 수 없다.
  if (target.is_developer) {
    return jsonError('개발자 계정은 삭제할 수 없습니다.', 403)
  }
  // 관리자 계정은 개발자만 삭제할 수 있다.
  if (target.is_admin && !data.user.is_developer) {
    return jsonError('관리자 계정은 개발자 권한만 삭제할 수 있습니다.', 403)
  }

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

  // 등록한 채용 공고가 있으면 공고(및 그 지원서)가 고아가 되므로 삭제를 막는다.
  const postings = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM job_postings WHERE created_by_user_id = ?'
  )
    .bind(params.id)
    .first()
  if (postings.count > 0) {
    return jsonError('등록한 채용 공고가 있는 계정은 삭제할 수 없습니다. 공고를 먼저 삭제하거나 계정 정지를 이용해주세요.', 409)
  }

  // documents.user_id isn't covered by the room_participants guard above and
  // isn't referenced by any JOIN elsewhere, but leaving it behind would orphan
  // an R2 object and a dangling row forever, so clean it up as part of delete.
  const { results: docs } = await env.DB.prepare('SELECT r2_key FROM documents WHERE user_id = ?')
    .bind(params.id)
    .all()
  const deletions = await Promise.allSettled(docs.map((d) => env.DOCUMENTS.delete(d.r2_key)))
  deletions.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`R2 delete failed for document ${docs[i].r2_key} (user ${params.id}):`, result.reason)
    }
  })

  // D1은 외래키를 강제하므로, users 행을 지우기 전에 이 계정을 참조하는
  // 감사 로그·지원서 심사자 참조를 먼저 정리해야 한다 (안 하면 FK 위반으로 500).
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE applications SET reviewed_by_user_id = NULL WHERE reviewed_by_user_id = ?').bind(params.id),
      env.DB.prepare('UPDATE admin_audit_log SET target_user_id = NULL WHERE target_user_id = ?').bind(params.id),
      env.DB.prepare('DELETE FROM admin_audit_log WHERE actor_user_id = ?').bind(params.id),
      env.DB.prepare('DELETE FROM documents WHERE user_id = ?').bind(params.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(params.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(params.id),
    ])
  } catch (err) {
    console.error(`User delete failed (${params.id}):`, err)
    return jsonError('계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 500)
  }

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'delete_user',
    detail: `email=${target.email}`,
  })

  return jsonResponse({ ok: true, deleted: true })
}
