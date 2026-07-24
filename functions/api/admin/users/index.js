import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { genId } from '../../../_lib/db.js'
import { hashPassword } from '../../../_lib/auth.js'
import { genTempPassword } from '../../../_lib/tempPassword.js'
import { logAdminAction } from '../../../_lib/auditLog.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, display_name, company_name, role, is_admin, is_recruiter, is_developer, is_suspended,
            must_change_password, created_at
     FROM users ORDER BY created_at DESC`
  ).all()

  return jsonResponse({
    users: results.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      companyName: u.company_name,
      role: u.role,
      isAdmin: !!u.is_admin,
      isRecruiter: !!u.is_recruiter,
      isDeveloper: !!u.is_developer,
      isSuspended: !!u.is_suspended,
      mustChangePassword: !!u.must_change_password,
      createdAt: u.created_at,
    })),
  })
}

export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => null)
  const { email, displayName, role, companyName, isRecruiter } = body || {}
  if (!email || !displayName || !role) {
    return jsonError('이메일, 이름, 역할은 필수입니다.', 400)
  }
  if (!['company', 'candidate'].includes(role)) {
    return jsonError('역할이 올바르지 않습니다.', 400)
  }

  const tempPassword = genTempPassword()
  const { hash, salt } = await hashPassword(tempPassword)
  const id = genId()
  const recruiterFlag = isRecruiter ? 1 : 0

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, company_name, must_change_password, is_recruiter)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(id, email, hash, salt, role, displayName, companyName || null, recruiterFlag)
      .run()
  } catch (err) {
    if (String(err?.message || err).includes('UNIQUE')) {
      return jsonError('이미 가입된 이메일입니다.', 409)
    }
    throw err
  }

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'create_user',
    targetUserId: id,
    detail: `email=${email}, role=${role}, isRecruiter=${!!recruiterFlag}`,
  })

  return jsonResponse(
    {
      ok: true,
      user: {
        id,
        email,
        displayName,
        companyName: companyName || null,
        role,
        isAdmin: false,
        isRecruiter: !!recruiterFlag,
        isSuspended: false,
        mustChangePassword: true,
      },
      tempPassword,
    },
    201
  )
}
