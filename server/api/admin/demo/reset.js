import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { genId } from '../../../_lib/db.js'
import { hashPassword } from '../../../_lib/auth.js'
import { logAdminAction } from '../../../_lib/auditLog.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { contractFingerprint } from '../../../_lib/contractDocument.js'
import { buildAuditEvents, describeSigningEnvironment } from '../../../_lib/auditTrail.js'
import { describeContractPeriod, describeRetention } from '../../../_lib/contractPeriod.js'
import { describeDeliveryState, channelLabel } from '../../../_lib/delivery.js'
import {
  formatSerial,
  buildCertificate,
  canonicalizeCertificate,
  certificateFingerprint,
  resolveDocumentIdentity,
} from '../../../_lib/auditCertificate.js'
import {
  DEMO_DOMAIN,
  DEMO_PASSWORD,
  DEMO_ACCOUNTS,
  DEMO_POSTING,
  DEMO_APPLICATIONS,
  DEMO_ROOMS,
  DEMO_MESSAGES,
  demoSignatureDataUrl,
} from '../../../_lib/demoSeed.js'
import {
  InterviewDeletionError,
  acquireInterviewRoomDeletionLocks,
  inspectInterviewRoomDeletion,
  prepareInterviewRoomDeletion,
  releaseInterviewRoomDeletionLocks,
} from '../../../_lib/interviewDeletion.js'

// 평가자용 체험 데모를 처음 상태로 만든다.
//
// 스크립트가 아니라 엔드포인트인 이유: 공개된 계정으로 아무나 들어와 데모를
// 어지럽힐 수 있고, 그때 되돌릴 방법이 화면에 있어야 한다. 몇 번을 눌러도 같은
// 상태가 되도록 지우고 다시 만든다.
//
// 지우는 범위는 @demo.invalid 표식이 붙은 것뿐이다. 실제 데이터는 건드리지
// 않는다 — 이 경계가 무너지면 운영 도구가 아니라 사고 도구가 된다.

const CAMEL_TO_COLUMN = {
  employerName: 'employer_name',
  employerAddress: 'employer_address',
  employeeName: 'employee_name',
  employeeAddress: 'employee_address',
  contractStartDate: 'contract_start_date',
  contractEndDate: 'contract_end_date',
  workLocation: 'work_location',
  jobDescription: 'job_description',
  workHoursStart: 'work_hours_start',
  workHoursEnd: 'work_hours_end',
  breakTime: 'break_time',
  workDays: 'work_days',
  restDays: 'rest_days',
  wageBaseAmount: 'wage_base_amount',
  wagePayMethod: 'wage_pay_method',
  wagePayDate: 'wage_pay_date',
  annualLeave: 'annual_leave',
  uniformSize: 'uniform_size',
}

async function wipeDemo(env) {
  const { results: users } = await env.DB.prepare(
    `SELECT id FROM users WHERE email LIKE ?`
  )
    .bind(`%@${DEMO_DOMAIN}`)
    .all()
  const userIds = users.map((u) => u.id)

  const { results: rooms } = await env.DB.prepare(
    `SELECT DISTINCT room_id AS id FROM room_participants WHERE user_id IN (${userIds.map(() => '?').join(',') || "''"})`
  )
    .bind(...userIds)
    .all()
  const roomIds = rooms.map((r) => r.id)

  // 삭제 범위가 '데모가 만든 것'이 아니라 '데모가 참여한 것'이다.
  //
  // 외래키 때문에 그래야 한다 — 데모 계정이 남의 방에 참여해 있으면 그 행부터
  // 끊지 않고는 계정을 지울 수 없다. 그런데 그 방을 통째로 지우면, 남의 회사가
  // 만든 방과 그 안의 체결된 계약서까지 함께 사라진다. 계약서는 근로관계
  // 종료일부터 3년 보존해야 하는 문서다(근로기준법 제42조).
  //
  // 그런 방이 하나라도 있으면 지우지 않고 멈춘다. 사람이 확인해야 할 일이지,
  // 초기화 버튼이 조용히 결정할 일이 아니다.
  if (roomIds.length > 0) {
    const { results: foreign } = await env.DB.prepare(
      `SELECT r.id, r.title
         FROM interview_rooms r
         JOIN room_participants rp ON rp.room_id = r.id AND rp.role_in_room = 'company'
        WHERE r.id IN (${roomIds.map(() => '?').join(',')})
          AND rp.user_id NOT IN (${userIds.map(() => '?').join(',') || "''"})`
    )
      .bind(...roomIds, ...userIds)
      .all()
    if (foreign.length > 0) {
      const titles = foreign.map((f) => f.title).join(', ')
      return {
        blocked: `데모가 아닌 회사의 면접방에 데모 계정이 참여해 있어 초기화를 멈췄습니다: ${titles}. 그 방에서 데모 계정을 내보낸 뒤 다시 시도해주세요.`,
      }
    }
  }

  const { results: postings } = await env.DB.prepare(
    `SELECT id FROM job_postings WHERE created_by_user_id IN (${userIds.map(() => '?').join(',') || "''"})`
  )
    .bind(...userIds)
    .all()
  const postingIds = postings.map((p) => p.id)

  let deletionLock = null
  try {
    await inspectInterviewRoomDeletion(env, roomIds)
    deletionLock = await acquireInterviewRoomDeletionLocks(
      env,
      roomIds,
      crypto.randomUUID()
    )
    await prepareInterviewRoomDeletion(env, roomIds)
  } catch (error) {
    if (deletionLock) {
      await releaseInterviewRoomDeletionLocks(env, deletionLock).catch((releaseError) => {
        console.error('Demo interview deletion lock release failed:', releaseError)
      })
    }
    if (error instanceof InterviewDeletionError) {
      return { blocked: error.message, status: error.status }
    }
    throw error
  }

  try {

  // R2 객체는 키를 잃기 전에 지운다. 데모는 파일을 올리지 않지만, 누군가
  // 데모 계정으로 지원서를 넣었을 수 있다.
  if (postingIds.length > 0) {
    const { results: docs } = await env.DB.prepare(
      `SELECT d.r2_key FROM application_documents d
         JOIN applications a ON a.id = d.application_id
        WHERE a.posting_id IN (${postingIds.map(() => '?').join(',')})`
    )
      .bind(...postingIds)
      .all()
    await Promise.allSettled(docs.map((d) => env.DOCUMENTS.delete(d.r2_key)))
  }
  if (roomIds.length > 0) {
    const { results: pdfs } = await env.DB.prepare(
      `SELECT r2_key FROM signed_contracts WHERE room_id IN (${roomIds.map(() => '?').join(',')})`
    )
      .bind(...roomIds)
      .all()
    await Promise.allSettled(pdfs.map((p) => env.DOCUMENTS.delete(p.r2_key)))

  }
  if (userIds.length > 0) {
    const { results: userDocs } = await env.DB.prepare(
      `SELECT r2_key FROM documents WHERE user_id IN (${userIds.map(() => '?').join(',')})`
    )
      .bind(...userIds)
      .all()
    await Promise.allSettled(userDocs.map((d) => env.DOCUMENTS.delete(d.r2_key)))
  }

  const inRooms = (table, col = 'room_id') =>
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM ${table} WHERE ${col} IN (${roomIds.map(() => '?').join(',')})`
        ).bind(...roomIds)
      : null
  const inUsers = (sql) =>
    userIds.length > 0
      ? env.DB.prepare(sql.replace('__IN__', userIds.map(() => '?').join(','))).bind(...userIds)
      : null
  const inPostings = (sql) =>
    postingIds.length > 0
      ? env.DB.prepare(sql.replace('__IN__', postingIds.map(() => '?').join(','))).bind(...postingIds)
      : null

  const statements = [
    // 화상 면접은 세션과 녹화 아래에 외래키가 여러 겹이다. 아래쪽부터 지운다.
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM recording_access_logs
            WHERE recording_id IN (
              SELECT r.id FROM interview_recordings r
              JOIN interview_sessions s ON s.id = r.session_id
              WHERE s.room_id IN (${roomIds.map(() => '?').join(',')})
            )`
        ).bind(...roomIds)
      : null,
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM interview_events
            WHERE session_id IN (
              SELECT id FROM interview_sessions
              WHERE room_id IN (${roomIds.map(() => '?').join(',')})
            )`
        ).bind(...roomIds)
      : null,
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM interview_recording_consents
            WHERE session_id IN (
              SELECT id FROM interview_sessions
              WHERE room_id IN (${roomIds.map(() => '?').join(',')})
            )`
        ).bind(...roomIds)
      : null,
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM interview_recordings
            WHERE session_id IN (
              SELECT id FROM interview_sessions
              WHERE room_id IN (${roomIds.map(() => '?').join(',')})
            )`
        ).bind(...roomIds)
      : null,
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM interview_session_members
            WHERE session_id IN (
              SELECT id FROM interview_sessions
              WHERE room_id IN (${roomIds.map(() => '?').join(',')})
            )`
        ).bind(...roomIds)
      : null,
    inRooms('interview_sessions'),
    inRooms('room_access_sessions'),
    inRooms('audit_certificates'),
    inRooms('contract_deliveries'),
    inRooms('signature_revocations'),
    inRooms('contract_translations'),
    inRooms('interview_summaries'),
    inRooms('contract_change_requests'),
    inRooms('signatures'),
    inRooms('signed_contracts'),
    inRooms('final_offer_emails'),
    inRooms('chat_messages'),
    inRooms('contract_edit_history'),
    // 처우 협의 이력(0047)도 방을 외래키로 참조한다. 빠뜨리면 대화를 한 번이라도
    // 나눈 데모는 두 번 다시 초기화되지 않는다.
    inRooms('negotiation_log'),
    // 방 수명 기록(0044)도 방을 외래키로 참조한다. 빠뜨리면 전형을 한 번이라도
    // 종료해 본 데모는 두 번 다시 초기화되지 않는다.
    inRooms('room_lifecycle_log'),
    // 갱신 연결을 먼저 끊지 않으면 방을 지울 수 없다.
    roomIds.length > 0
      ? env.DB.prepare(
          `UPDATE contract_terms SET previous_room_id = NULL WHERE previous_room_id IN (${roomIds.map(() => '?').join(',')})`
        ).bind(...roomIds)
      : null,
    inRooms('contract_terms'),
    inPostings(
      `DELETE FROM application_documents WHERE application_id IN (SELECT id FROM applications WHERE posting_id IN (__IN__))`
    ),
    inPostings('DELETE FROM applications WHERE posting_id IN (__IN__)'),
    inRooms('room_participants'),
    // 지원서는 공고 기준으로 지운다. 그런데 applications.room_id 는 방을
    // 외래키로 참조하므로, 데모 공고가 아닌 지원서가 이 방을 가리키고 있으면
    // 방 삭제가 FK 위반으로 실패하고 batch 전체가 롤백된다. R2 객체는 batch
    // 밖에서 이미 지운 뒤라, 파일만 사라지고 기록은 그대로 남는다.
    roomIds.length > 0
      ? env.DB.prepare(
          `UPDATE applications SET room_id = NULL WHERE room_id IN (${roomIds.map(() => '?').join(',')})`
        ).bind(...roomIds)
      : null,
    // 같은 이유로 계정 참조도 끊는다. 데모 계정이 남긴 지원서가 데모 공고가
    // 아닌 곳에 있으면 계정 삭제가 실패한다.
    inUsers('UPDATE applications SET created_user_id = NULL WHERE created_user_id IN (__IN__)'),
    inUsers('UPDATE applications SET reviewed_by_user_id = NULL WHERE reviewed_by_user_id IN (__IN__)'),
    // 감사 로그는 방을 외래키로 참조한다(admin_audit_log.target_room_id).
    // 끊지 않으면 방 삭제가 FK 위반으로 실패하고 batch 전체가 롤백되어,
    // 데모를 두 번 다시 초기화할 수 없게 된다.
    //
    // 도달 경로가 실제로 있다: 평가자가 데모에서 "서류 합격"을 누르면
    // applications/[id]/pass.js 가 targetRoomId 와 함께 감사 로그를 남긴다.
    // 그 한 번의 클릭이 데모를 영구히 망가뜨린다.
    roomIds.length > 0
      ? env.DB.prepare(
          `UPDATE admin_audit_log SET target_room_id = NULL WHERE target_room_id IN (${roomIds.map(() => '?').join(',')})`
        ).bind(...roomIds)
      : null,
    // 알림은 방을 외래키로 참조하지 않지만 링크로 가리킨다. 데모 계정이 아닌
    // 사람이 받은 알림이 남으면 눌러도 404가 나는 항목이 영영 남는다.
    ...roomIds.map((id) =>
      env.DB.prepare('DELETE FROM notifications WHERE link LIKE ?').bind(`/rooms/${id}%`)
    ),
    roomIds.length > 0
      ? env.DB.prepare(
          `DELETE FROM interview_rooms WHERE id IN (${roomIds.map(() => '?').join(',')})`
        ).bind(...roomIds)
      : null,
    inPostings('DELETE FROM job_postings WHERE id IN (__IN__)'),
    inUsers('DELETE FROM documents WHERE user_id IN (__IN__)'),
    inUsers('DELETE FROM notifications WHERE user_id IN (__IN__)'),
    inUsers('UPDATE admin_audit_log SET target_user_id = NULL WHERE target_user_id IN (__IN__)'),
    inUsers('DELETE FROM admin_audit_log WHERE actor_user_id IN (__IN__)'),
    inUsers('DELETE FROM sessions WHERE user_id IN (__IN__)'),
    inUsers('DELETE FROM users WHERE id IN (__IN__)'),
  ].filter(Boolean)

    if (statements.length > 0) await env.DB.batch(statements)
    return { users: userIds.length, rooms: roomIds.length, postings: postingIds.length }
  } catch (error) {
    if (deletionLock) {
      await releaseInterviewRoomDeletionLocks(env, deletionLock).catch((releaseError) => {
        console.error('Demo interview deletion lock release failed:', releaseError)
      })
    }
    throw error
  }
}

async function seedDemo(env) {
  // 계정
  const accountIds = {}
  const accountStatements = []
  for (const a of DEMO_ACCOUNTS) {
    const id = genId()
    accountIds[a.key] = id
    const { hash, salt } = await hashPassword(DEMO_PASSWORD)
    accountStatements.push(
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, company_name, is_recruiter)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, a.email, hash, salt, a.role, a.displayName, a.companyName, a.isRecruiter ? 1 : 0)
    )
  }
  await env.DB.batch(accountStatements)

  // 공고
  const postingId = genId()
  await env.DB.prepare(
    `INSERT INTO job_postings
       (id, created_by_user_id, title, department, employment_type, location, description, status,
        wage_type, wage_min, wage_max, work_hours_start, work_hours_end, work_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      postingId,
      accountIds.company,
      DEMO_POSTING.title,
      DEMO_POSTING.department,
      DEMO_POSTING.employmentType,
      DEMO_POSTING.location,
      DEMO_POSTING.description,
      DEMO_POSTING.wageType,
      DEMO_POSTING.wageMin,
      DEMO_POSTING.wageMax,
      DEMO_POSTING.workHoursStart,
      DEMO_POSTING.workHoursEnd,
      DEMO_POSTING.workDays
    )
    .run()

  // 방
  const roomIds = {}
  for (const room of DEMO_ROOMS) {
    const roomId = genId()
    roomIds[room.key] = roomId
    const inviteCode = formatSerial(crypto.getRandomValues(new Uint8Array(12))).replace(/^AC-/, 'DM-')

    await env.DB.prepare(
      `INSERT INTO interview_rooms (id, company_user_id, title, invite_code, status)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(roomId, accountIds.company, room.title, inviteCode, room.status)
      .run()

    // 계약서에 적힌 이름과 실제로 그 방에 있는 사람이 달라서는 안 된다.
    const candidateId = accountIds[room.candidateKey ?? 'candidate']
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, 'company')`
      ).bind(roomId, accountIds.company),
      env.DB.prepare(
        `INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, 'candidate')`
      ).bind(roomId, candidateId),
    ])

    // 계약 조건
    const t = room.terms
    const cols = Object.keys(CAMEL_TO_COLUMN)
    const columnNames = cols.map((c) => CAMEL_TO_COLUMN[c])
    await env.DB.prepare(
      `INSERT INTO contract_terms
         (room_id, ${columnNames.join(', ')}, social_insurance_json, custom_terms_json,
          wage_items_json, hire_confirmed, hire_confirmed_at)
       VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, 1, datetime('now', '-14 days'))`
    )
      .bind(
        roomId,
        ...cols.map((c) => t[c] ?? null),
        JSON.stringify(t.socialInsurance ?? {}),
        JSON.stringify(t.customTerms ?? []),
        t.wageItems ? JSON.stringify(t.wageItems) : null
      )
      .run()

    // 대화
    const lines = DEMO_MESSAGES[room.key] ?? []
    if (lines.length > 0) {
      await env.DB.batch(
        lines.map(([who, body], i) =>
          env.DB.prepare(
            `INSERT INTO chat_messages (room_id, sender_user_id, body, created_at)
             VALUES (?, ?, ?, datetime('now', '-14 days', '+' || ? || ' minutes'))`
          ).bind(roomId, who === 'company' ? accountIds.company : candidateId, body, i * 3)
        )
      )
    }

    // 서명 (체결된 방만)
    if (room.status === 'signed') {
      const documentSha256 = await contractFingerprint(t)
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO signatures
             (id, room_id, signer_user_id, signer_role, image_data_url, signed_at,
              signer_ip, signer_user_agent, signer_country, document_sha256,
              verified_email, session_started_at, verification_method)
           VALUES (?, ?, ?, 'company', ?, datetime('now', '-13 days'), '203.0.113.10',
                   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0 Safari/537.36', 'KR', ?, ?,
                   datetime('now', '-13 days', '-20 minutes'), 'account_password')`
        ).bind(
          genId(),
          roomId,
          accountIds.company,
          demoSignatureDataUrl(DEMO_ACCOUNTS[0].displayName),
          documentSha256,
          DEMO_ACCOUNTS[0].email
        ),
        env.DB.prepare(
          `INSERT INTO signatures
             (id, room_id, signer_user_id, signer_role, image_data_url, signed_at,
              signer_ip, signer_user_agent, signer_country, document_sha256,
              verified_email, session_started_at, verification_method)
           VALUES (?, ?, ?, 'candidate', ?, datetime('now', '-13 days', '+35 minutes'), '198.51.100.24',
                   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1 Safari/604.1', 'KR', ?, ?,
                   datetime('now', '-13 days', '+10 minutes'), 'account_password')`
        ).bind(
          genId(),
          roomId,
          candidateId,
          demoSignatureDataUrl(t.employeeName),
          documentSha256,
          DEMO_ACCOUNTS.find((a) => a.key === (room.candidateKey ?? 'candidate')).email
        ),
        // 교부 — 체결과 동시에 근로자가 열람 가능해진 사실 (제17조 제2항)
        env.DB.prepare(
          `INSERT INTO contract_deliveries
             (id, room_id, recipient_user_id, channel, recipient_address, status, delivered_at, first_viewed_at)
           VALUES (?, ?, ?, 'in_app', ?, 'delivered',
                   datetime('now', '-13 days', '+35 minutes'),
                   datetime('now', '-12 days'))`
        ).bind(genId(), roomId, candidateId, DEMO_ACCOUNTS.find((a) => a.key === (room.candidateKey ?? 'candidate')).email),
      ])
    }
  }

  // 방 A를 방 C의 갱신으로 잇는다. 계속근로기간이 합산되어 기간제 2년 상한이
  // 하나의 계약만 볼 때와 다르게 계산되는 것을 보여 준다.
  await env.DB.prepare('UPDATE contract_terms SET previous_room_id = ? WHERE room_id = ?')
    .bind(roomIds.previous, roomIds.signed)
    .run()

  // 지원서.
  //
  // 방에 연결하는 것이 중요하다. 계약서 화면은 applications.room_id 로 이 방이
  // 어느 공고에서 왔는지 찾아, 공고에 제시한 근로조건과 계약서를 대조한다
  // (채용절차법 제4조 제3항). 연결이 없으면 그 대조가 통째로 사라진다.
  const roomByApplication = {}
  for (const room of DEMO_ROOMS) {
    if (room.applicationKey) roomByApplication[room.applicationKey] = roomIds[room.key]
  }
  const userByEmail = {}
  for (const a of DEMO_ACCOUNTS) userByEmail[a.email] = accountIds[a.key]

  const applicationStatements = DEMO_APPLICATIONS.map((a) =>
    env.DB.prepare(
      `INSERT INTO applications
         (id, posting_id, applicant_name, applicant_email, applicant_phone, career_json,
          cover_letter, consent_required, consented_at, status, created_at,
          room_id, created_user_id, reviewed_by_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '-20 days'), ?, datetime('now', '-20 days'),
               ?, ?, ?, ?)`
    ).bind(
      genId(),
      postingId,
      a.name,
      a.email,
      a.phone,
      JSON.stringify(a.career),
      a.coverLetter,
      a.status,
      roomByApplication[a.key] ?? null,
      userByEmail[a.email] ?? null,
      a.status === 'passed' ? accountIds.company : null,
      null // reviewed_at 은 SQL 함수라 바인딩할 수 없어 아래에서 채운다
    )
  )
  await env.DB.batch(applicationStatements)

  // reviewed_at 은 바인딩으로 SQL 함수를 넣을 수 없어 따로 채운다.
  await env.DB.prepare(
    `UPDATE applications SET reviewed_at = datetime('now', '-18 days')
      WHERE posting_id = ? AND status = 'passed'`
  )
    .bind(postingId)
    .run()

  return { accountIds, postingId, roomIds }
}

// 체결된 방에 증명서 한 장을 미리 발급해 둔다. 발급번호가 있어야 평가자가
// /verify 를 바로 시험해 볼 수 있다.
async function issueDemoCertificate(env, roomId, issuerName) {
  const [room, participants, termsRow, signatureRows, deliveryRows] = await Promise.all([
    env.DB.prepare('SELECT id, title, status, created_at FROM interview_rooms WHERE id = ?')
      .bind(roomId)
      .first(),
    env.DB.prepare(
      `SELECT u.display_name, u.company_name, rp.role_in_room, rp.joined_at
         FROM room_participants rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ?`
    )
      .bind(roomId)
      .all(),
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
    env.DB.prepare(
      `SELECT signer_role, signed_at, signer_ip, signer_user_agent, signer_country,
              document_sha256, verified_email, session_started_at, verification_method
         FROM signatures WHERE room_id = ?`
    )
      .bind(roomId)
      .all(),
    env.DB.prepare(
      `SELECT channel, status, delivered_at, first_viewed_at, downloaded_at
         FROM contract_deliveries WHERE room_id = ?`
    )
      .bind(roomId)
      .all(),
  ])

  const terms = rowToCamelTerms(termsRow)
  const currentSha256 = terms ? await contractFingerprint(terms) : null
  const deliveries = deliveryRows.results.map((d) => ({
    channel: d.channel,
    channelLabel: channelLabel(d.channel),
    status: d.status,
    deliveredAt: d.delivered_at,
    firstViewedAt: d.first_viewed_at,
    downloadedAt: d.downloaded_at,
  }))

  const document = resolveDocumentIdentity({
    signatures: signatureRows.results,
    storedPdfSha256: null,
    currentSha256,
  })

  const lastSignedAt = signatureRows.results.map((s) => s.signed_at).filter(Boolean).sort().pop() ?? null

  const events = buildAuditEvents({
    room,
    participants: participants.results,
    terms: termsRow,
    history: [],
    signatures: signatureRows.results,
    signedContract: null,
    finalOffer: null,
    revocations: [],
    changeRequests: [],
    deliveries,
    translations: [],
    certificates: [],
  })

  const issuedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const serial = formatSerial(crypto.getRandomValues(new Uint8Array(12)))

  const certificate = buildCertificate({
    serial,
    issuedAt,
    issuedByName: issuerName,
    room,
    participants: participants.results,
    signatures: signatureRows.results.map((s) => ({ ...s, environment: describeSigningEnvironment(s) })),
    revokedSignatures: [],
    deliveries,
    deliveryState: describeDeliveryState(deliveries),
    events,
    document,
    period: terms ? describeContractPeriod(terms) : null,
    retention: terms ? describeRetention(terms, lastSignedAt, new Date(), terms.employmentEndedAt) : null,
  })

  const canonicalText = canonicalizeCertificate(certificate)
  const certificateSha256 = await certificateFingerprint(canonicalText)

  await env.DB.prepare(
    `INSERT INTO audit_certificates
       (id, room_id, serial, issued_by_user_id, issued_at, document_sha256,
        certificate_sha256, canonical_text, snapshot_json, event_count)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      genId(),
      roomId,
      serial,
      issuedAt,
      document.signedSha256,
      certificateSha256,
      canonicalText,
      JSON.stringify(certificate),
      events.length
    )
    .run()

  return { serial, certificateSha256 }
}

export async function onRequestPost({ env, data }) {
  const removed = await wipeDemo(env)
  // 지울 수 없는 것이 섞여 있으면 아무것도 지우지 않은 상태로 멈춘다.
  if (removed.blocked) return jsonError(removed.blocked, removed.status || 409)

  const seeded = await seedDemo(env)
  const certificate = await issueDemoCertificate(env, seeded.roomIds.signed, DEMO_ACCOUNTS[0].displayName)

  await logAdminAction(env, {
    actorId: data.user.id,
    action: 'demo_reset',
    detail: `발급번호=${certificate.serial}`,
  })

  return jsonResponse({
    ok: true,
    removed,
    accounts: DEMO_ACCOUNTS.map((a) => ({ email: a.email, role: a.role, displayName: a.displayName })),
    password: DEMO_PASSWORD,
    certificateSerial: certificate.serial,
    rooms: Object.keys(seeded.roomIds).length,
  })
}

// 지금 데모가 살아 있는지, 발급번호가 무엇인지.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT c.serial, c.issued_at FROM audit_certificates c
       JOIN room_participants rp ON rp.room_id = c.room_id
       JOIN users u ON u.id = rp.user_id
      WHERE u.email LIKE ? ORDER BY c.issued_at DESC LIMIT 1`
  )
    .bind(`%@${DEMO_DOMAIN}`)
    .all()

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users WHERE email LIKE ?1) AS accounts,
            (SELECT COUNT(*) FROM job_postings p JOIN users u ON u.id = p.created_by_user_id
              WHERE u.email LIKE ?1) AS postings`
  )
    .bind(`%@${DEMO_DOMAIN}`)
    .first()

  return jsonResponse({
    seeded: (counts?.accounts ?? 0) > 0,
    accounts: counts?.accounts ?? 0,
    postings: counts?.postings ?? 0,
    certificateSerial: results[0]?.serial ?? null,
  })
}
