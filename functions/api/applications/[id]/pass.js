import { genId } from '../../../_lib/db.js'
import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { hashPassword } from '../../../_lib/auth.js'
import { genTempPassword } from '../../../_lib/tempPassword.js'
import { requireManageableApplication } from '../../../_lib/applications.js'
import { seedTermsFromApplication } from '../../../_lib/seedTerms.js'
import { logAdminAction } from '../../../_lib/auditLog.js'
import { isEmailConfigured, sendApplicationResultEmail } from '../../../_lib/email.js'
import { notifyUser } from '../../../_lib/notify.js'

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
  const existingUser = await env.DB.prepare('SELECT id, role FROM users WHERE email = ?')
    .bind(application.applicant_email)
    .first()

  // 본인(채용자) 계정이면 회사·지원자로 동시 착석하게 되어 충돌하므로 거부
  if (existingUser && existingUser.id === data.user.id) {
    return jsonError('본인 계정 이메일로는 서류합격 처리를 할 수 없습니다.', 409)
  }
  // 이미 다른 유형(회사/관리자)으로 쓰이는 이메일은 지원자로 편입할 수 없음
  if (existingUser && existingUser.role !== 'candidate') {
    return jsonError('이 이메일은 이미 다른 유형의 계정으로 사용 중이라 지원자로 연결할 수 없습니다.', 409)
  }

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

  // 동시 요청으로 인한 고아 면접방을 막기 위해, 먼저 지원서를 원자적으로 '선점'한다.
  const claim = await env.DB.prepare(
    `UPDATE applications
     SET status = 'passed', reviewed_by_user_id = ?, reviewed_at = datetime('now')
     WHERE id = ? AND status = 'submitted'`
  )
    .bind(data.user.id, params.id)
    .run()
  if (claim.meta.changes === 0) {
    return jsonError('이미 심사가 완료된 지원서입니다.', 409)
  }

  const roomId = genId()
  const roomTitle = `${application.applicant_name} · ${application.posting_title}`

  // 지원서·공고에서 계약 조건의 출발점을 만든다.
  const seed = seedTermsFromApplication({
    posting: {
      title: application.posting_title,
      department: application.posting_department,
      location: application.posting_location,
      employment_type: application.posting_employment_type,
    },
    application,
    companyUser: data.user,
  })

  // 초대코드는 UNIQUE 제약이 막아 주므로 미리 조회하지 않는다. 겹치면 다시
  // 뽑아 넣고, 그래도 안 되면 지원서 선점을 되돌린다. 미리 조회하는 방식은
  // 왕복을 늘리면서도 동시 생성을 막지 못했다.
  let inviteCode = genInviteCode()
  for (let attempt = 0; ; attempt += 1) {
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
          `UPDATE applications SET created_user_id = ?, room_id = ? WHERE id = ?`
        ).bind(candidateUserId, roomId, params.id),
        // 계약서를 빈 종이에서 시작하지 않는다. 앱은 지원서에서 근로자 이름을,
        // 공고와 회사 계정에서 사업체명·근무장소·업무를 이미 알고 있다. 이 넷은
        // 근로기준법 제17조 명시사항이라 비어 있으면 서명 자체가 열리지 않는다.
        env.DB.prepare(
          `INSERT INTO contract_terms (room_id, employer_name, employee_name, work_location, job_description)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(room_id) DO NOTHING`
        ).bind(
          roomId,
          seed.employerName,
          seed.employeeName,
          seed.workLocation,
          seed.jobDescription
        ),
      ])
      break
    } catch (err) {
      // 초대코드가 겹친 것뿐이면 코드만 새로 뽑아 다시 시도한다.
      if (String(err?.message || err).includes('UNIQUE') && attempt < 4) {
        inviteCode = genInviteCode()
        continue
      }
      console.error(`Application pass failed (application ${params.id}):`, err)
      // 선점만 되고 계정·면접방 생성이 실패했으면 지원서 상태를 되돌린다.
      await env.DB.prepare(
        `UPDATE applications SET status = 'submitted', reviewed_by_user_id = NULL, reviewed_at = NULL WHERE id = ?`
      )
        .bind(params.id)
        .run()
        .catch(() => {})
      return jsonError('서류합격 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 500)
    }
  }

  const companyName = data.user.company_name || data.user.display_name

  // 지원자 인앱 알림 (첫 로그인 시 확인)
  await notifyUser(env, candidateUserId, {
    type: 'application_passed',
    message: `${companyName} 서류 전형에 합격했습니다! 면접방에서 절차를 이어가세요.`,
    link: `/rooms/${roomId}`,
  })

  // 감사 로그 기록 (실패해도 처리 결과에는 영향 없음)
  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'application_pass',
    targetUserId: candidateUserId,
    targetRoomId: roomId,
    detail: `${application.applicant_email} · ${application.posting_title}`,
  }).catch(() => {})

  // 지원자에게 합격 안내 이메일 (설정된 경우에만, 실패해도 무시)
  let emailStatus = 'not_sent'
  let emailError = null
  if (isEmailConfigured(env)) {
    try {
      await sendApplicationResultEmail(env, {
        to: application.applicant_email,
        applicantName: application.applicant_name,
        companyName,
        result: 'passed',
        // 지원자가 그 자리에서 들어올 수 있게 코드를 메일에 담는다.
        inviteCode,
      })
      emailStatus = 'sent'
    } catch (err) {
      emailStatus = 'failed'
      emailError = String(err?.message || err).slice(0, 300)
      console.error(`Pass result email failed (application ${params.id}):`, emailError)
    }
  }

  return jsonResponse(
    {
      ok: true,
      status: 'passed',
      roomId,
      // 지원자에게 건네야 하는 것은 이제 이 코드다.
      //
      // 예전에는 임시 비밀번호를 화면에 띄우고 담당자가 따로 전달하게 했다.
      // 그런데 지원자에게는 로그인할 이유도, 로그인 화면으로 가는 길도 없다.
      // 코드만 있으면 공고 화면에서 바로 들어온다.
      inviteCode,
      emailStatus,
      emailError,
      account: {
        email: application.applicant_email,
        alreadyExisted,
        // 계정은 서명 기록의 신원으로 계속 필요하다. 다만 지원자에게 먼저
        // 건네는 것은 비밀번호가 아니라 위 코드다.
        tempPassword,
      },
    },
    201
  )
}
