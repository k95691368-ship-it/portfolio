import { genId } from '../../../_lib/db.js'
import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { hashPassword } from '../../../_lib/auth.js'
import { genTempPassword } from '../../../_lib/tempPassword.js'
import { requireManageableApplication } from '../../../_lib/applications.js'

function genInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 헷갈리는 글자(0/O, 1/I) 제외
  let code = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (const b of bytes) code += alphabet[b % alphabet.length]
  return code
}

// 관리: 서류합격 처리 — 지원 이메일로 candidate 계정(임시 비밀번호) 생성 +
// 면접방 자동 생성 후 채용자·지원자 착석. 기존 계정이 있으면 재사용.
export async function onRequestPost({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const application = access.application

  if (application.status !== 'submitted') {
    return jsonError('이미 심사가 완료된 지원서입니다.', 409)
  }
  // 면접방을 회사 측으로 생성하므로 company 계정이어야 한다.
  if (data.user.role !== 'company') {
    return jsonError('회사 계정만 서류합격 처리를 할 수 있습니다.', 403)
  }

  // 지원 이메일로 계정 조회 (없으면 신규 생성)
  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(application.applicant_email)
    .first()

  let candidateUserId
  let tempPassword = null
  const alreadyExisted = !!existingUser

  const newUserStatements = []
  if (existingUser) {
    candidateUserId = existingUser.id
  } else {
    candidateUserId = genId()
    tempPassword = genTempPassword()
    const { hash, salt } = await hashPassword(tempPassword)
    newUserStatements.push(
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, must_change_password)
         VALUES (?, ?, ?, ?, 'candidate', ?, 1)`
      ).bind(candidateUserId, application.applicant_email, hash, salt, application.applicant_name)
    )
  }

  // 초대코드 충돌 방지 재시도
  const roomId = genId()
  let inviteCode = genInviteCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await env.DB.prepare('SELECT id FROM interview_rooms WHERE invite_code = ?')
      .bind(inviteCode)
      .first()
    if (!clash) break
    inviteCode = genInviteCode()
  }

  const roomTitle = `${application.applicant_name} · ${application.posting_title}`

  try {
    await env.DB.batch([
      ...newUserStatements,
      env.DB.prepare(
        `INSERT INTO interview_rooms (id, company_user_id, title, invite_code, status)
         VALUES (?, ?, ?, ?, 'active')`
      ).bind(roomId, data.user.id, roomTitle, inviteCode),
      env.DB.prepare(
        `INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, 'company')`
      ).bind(roomId, data.user.id),
      env.DB.prepare(
        `INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, 'candidate')`
      ).bind(roomId, candidateUserId),
      env.DB.prepare(
        `UPDATE applications
         SET status = 'passed', created_user_id = ?, room_id = ?,
             reviewed_by_user_id = ?, reviewed_at = datetime('now')
         WHERE id = ? AND status = 'submitted'`
      ).bind(candidateUserId, roomId, data.user.id, params.id),
    ])
  } catch (err) {
    console.error(`Application pass failed (application ${params.id}):`, err)
    return jsonError('서류합격 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 500)
  }

  return jsonResponse(
    {
      ok: true,
      status: 'passed',
      roomId,
      account: {
        email: application.applicant_email,
        alreadyExisted,
        tempPassword, // 신규 생성 시에만 값이 있으며, 이 응답에서 1회만 노출된다.
      },
    },
    201
  )
}
