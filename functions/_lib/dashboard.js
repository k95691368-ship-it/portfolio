import { describeContractPeriod } from './contractPeriod.js'
import { describeApplicationProgress, sortMyApplications } from './applicationProgress.js'

// 대시보드가 쓰는 두 조회.
//
// 면접방 목록과 내 지원 현황은 각각 따로 요청되고 있었는데, 둘 다 로그인
// 직후 같은 화면에서 한꺼번에 필요하다. 같은 코드를 두 곳에 두지 않도록
// 여기로 모으고, 기존 경로와 통합 경로가 함께 쓴다.

const APPLICATION_LIMIT = 50

export async function loadMyRooms(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT
       r.id, r.title, r.invite_code, r.status, r.created_at,
       (SELECT u.display_name FROM room_participants rp2
          JOIN users u ON u.id = rp2.user_id
          WHERE rp2.room_id = r.id AND rp2.role_in_room = 'company') AS company_name,
       (SELECT u.display_name FROM room_participants rp2
          JOIN users u ON u.id = rp2.user_id
          WHERE rp2.room_id = r.id AND rp2.role_in_room = 'candidate') AS candidate_name,
       (SELECT COUNT(*) FROM signatures s WHERE s.room_id = r.id) AS signature_count,
       EXISTS(SELECT 1 FROM signatures s WHERE s.room_id = r.id AND s.signer_user_id = ?) AS i_signed,
       (SELECT ct.contract_start_date FROM contract_terms ct WHERE ct.room_id = r.id) AS start_date,
       (SELECT ct.contract_end_date FROM contract_terms ct WHERE ct.room_id = r.id) AS end_date
     FROM interview_rooms r
     JOIN room_participants rp ON rp.room_id = r.id
     WHERE rp.user_id = ?
     ORDER BY r.created_at DESC`
  )
    .bind(user.id, user.id)
    .all()

  return results.map((r) => {
    // 서명 단계에서 사용자가 지금 해야 할 일을 한 줄로 안내
    let nextAction = null
    if (r.status === 'contract_pending') {
      nextAction = r.i_signed
        ? `상대방 서명 대기 중 (${r.signature_count}/2)`
        : `내 서명 필요 (${r.signature_count}/2)`
    } else if (r.status === 'open') {
      nextAction = '지원자 대기 중'
    }

    // 체결된 계약은 만료가 다가오면 목록에서 바로 보이게 한다.
    let periodAlert = null
    if (r.status === 'signed') {
      const period = describeContractPeriod({
        contractStartDate: r.start_date,
        contractEndDate: r.end_date,
      })
      if (period.status === 'expiring_soon' || period.status === 'expired') {
        periodAlert = period.label
      }
    }

    return {
      id: r.id,
      title: r.title,
      inviteCode: r.invite_code,
      status: r.status,
      createdAt: r.created_at,
      companyName: r.company_name,
      candidateName: r.candidate_name,
      nextAction,
      periodAlert,
    }
  })
}

// 지원은 로그인 없이도 할 수 있고 합격하면 그 이메일로 계정이 만들어진다.
// 그래서 지원서와 계정을 잇는 끈은 두 가지다 — 합격 시 만들어진 계정 연결과,
// 아이디로 쓰는 이메일. 둘 중 하나라도 맞으면 본인 지원서로 본다.
export async function loadMyApplications(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.status, a.created_at, a.reviewed_at, a.room_id, a.lookup_code,
            p.title AS posting_title, p.department, p.employment_type, p.location,
            r.status AS room_status, r.title AS room_title,
            sc.created_at AS signed_at
       FROM applications a
       JOIN job_postings p ON p.id = a.posting_id
       LEFT JOIN interview_rooms r ON r.id = a.room_id
       LEFT JOIN signed_contracts sc ON sc.room_id = a.room_id
      WHERE a.created_user_id = ? OR LOWER(a.applicant_email) = LOWER(?)
      ORDER BY a.created_at DESC
      LIMIT ?`
  )
    .bind(user.id, user.email, APPLICATION_LIMIT)
    .all()

  const applications = results.map((r) => {
    const base = {
      id: r.id,
      postingTitle: r.posting_title,
      department: r.department,
      employmentType: r.employment_type,
      location: r.location,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
      roomId: r.room_id,
      roomStatus: r.room_status,
      roomTitle: r.room_title,
      signedAt: r.signed_at,
      lookupCode: r.lookup_code,
    }
    return { ...base, progress: describeApplicationProgress(base) }
  })

  return sortMyApplications(applications)
}
