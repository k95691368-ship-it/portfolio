import { describeContractPeriod } from './contractPeriod.js'
import { describeApplicationProgress, sortMyApplications } from './applicationProgress.js'

// 대시보드가 쓰는 두 조회.
//
// 면접방 목록과 내 지원 현황은 각각 따로 요청되고 있었는데, 둘 다 로그인
// 직후 같은 화면에서 한꺼번에 필요하다. 같은 코드를 두 곳에 두지 않도록
// 여기로 모으고, 기존 경로와 통합 경로가 함께 쓴다.

const APPLICATION_LIMIT = 50

// 면접방 목록에는 상한이 없었다. 채용을 오래 한 회사 계정은 방이 수백 개가
// 되고, 그 전부를 방마다 여섯 번의 딸린 조회와 함께 읽어 첫 화면에 한꺼번에
// 그렸다. 로그인 직후 가장 먼저 열리는 화면이 가장 무거웠던 셈이다.
//
// 최신부터 자른다. 그리고 잘랐다는 사실을 반드시 함께 돌려준다 — 조용히
// 자르면 화면은 "이게 전부"라고 말하는 것이 되고, 그것은 거짓말이다.
const ROOM_LIMIT = 100

export async function loadMyRooms(env, user) {
  // 한 건 더 읽어 잘렸는지 판단한다. 세어 보는 조회를 한 번 더 하지 않는다.
  const { results } = await env.DB.prepare(
    `SELECT
       r.id, r.title, r.invite_code, r.status, r.created_at, r.archived_at,
       (SELECT u.display_name FROM room_participants rp2
          JOIN users u ON u.id = rp2.user_id
          WHERE rp2.room_id = r.id AND rp2.role_in_room = 'company') AS company_name,
       (SELECT u.display_name FROM room_participants rp2
          JOIN users u ON u.id = rp2.user_id
          WHERE rp2.room_id = r.id AND rp2.role_in_room = 'candidate') AS candidate_name,
       (SELECT COUNT(*) FROM signatures s WHERE s.room_id = r.id) AS signature_count,
       EXISTS(SELECT 1 FROM signatures s WHERE s.room_id = r.id AND s.signer_user_id = ?) AS i_signed,
       ct.contract_start_date AS start_date,
       ct.contract_end_date AS end_date
     FROM interview_rooms r
     JOIN room_participants rp ON rp.room_id = r.id
     LEFT JOIN contract_terms ct ON ct.room_id = r.id
     WHERE rp.user_id = ?
     ORDER BY r.created_at DESC
     LIMIT ?`
  )
    .bind(user.id, user.id, ROOM_LIMIT + 1)
    .all()

  const truncated = results.length > ROOM_LIMIT
  const rooms = (truncated ? results.slice(0, ROOM_LIMIT) : results).map((r) => {
    // 보관된 방은 손댈 수 없다. 그런데 목록은 그것을 모른 채 "내 서명 필요"라고
    // 재촉했다 — 눌러 봐도 잠겨 있는 일을 하라고 하는 셈이다. 할 일 안내와
    // 만료 경고는 무언가 할 수 있을 때만 뜻이 있다.
    const archived = !!r.archived_at

    // 서명 단계에서 사용자가 지금 해야 할 일을 한 줄로 안내
    let nextAction = null
    if (archived) {
      nextAction = null
    } else if (r.status === 'contract_pending') {
      nextAction = r.i_signed
        ? `상대방 서명 대기 중 (${r.signature_count}/2)`
        : `내 서명 필요 (${r.signature_count}/2)`
    } else if (r.status === 'open') {
      nextAction = '지원자 대기 중'
    }

    // 체결된 계약은 만료가 다가오면 목록에서 바로 보이게 한다.
    let periodAlert = null
    if (!archived && r.status === 'signed') {
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
      // 보관은 status 를 덮지 않는다. 목록에서도 원래 상태와 나란히 보여 준다.
      archivedAt: r.archived_at ?? null,
      createdAt: r.created_at,
      companyName: r.company_name,
      candidateName: r.candidate_name,
      nextAction,
      periodAlert,
    }
  })

  return { rooms, truncated, limit: ROOM_LIMIT }
}

// 지원은 로그인 없이도 할 수 있고 합격하면 그 이메일로 계정이 만들어진다.
//
// 예전에는 "계정 이메일이 지원서 이메일과 같으면 본인"으로 보았다. 그런데 이
// 서비스에는 이메일 소유 확인이 없다. 가입은 아무 이메일로나 되고 즉시 로그인
// 세션이 생긴다. 그래서 남이 지원할 때 쓴 이메일로 가입하기만 하면 그 사람의
// 지원 이력과 접수번호까지 보였다 — 접수번호는 로그인 없이 현황을 조회하는
// 열쇠이므로, 이메일 하나로 남의 전형 상태를 계속 들여다볼 수 있었다.
//
// 이제 명시적으로 이어진 것(합격 시 만들어진 계정, 또는 접수번호로 직접 연결한
// 것)만 본인 지원서로 본다. 증명 없이 추측으로 소유를 인정하지 않는다.
export async function loadMyApplications(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.status, a.created_at, a.reviewed_at, a.room_id, a.lookup_code,
            p.title AS posting_title, p.department, p.employment_type, p.location,
            r.status AS room_status, r.title AS room_title, r.archived_at AS room_archived_at,
            sc.created_at AS signed_at
       FROM applications a
       JOIN job_postings p ON p.id = a.posting_id
       LEFT JOIN interview_rooms r ON r.id = a.room_id
       LEFT JOIN signed_contracts sc ON sc.room_id = a.room_id
      WHERE a.created_user_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?`
  )
    .bind(user.id, APPLICATION_LIMIT + 1)
    .all()

  const truncated = results.length > APPLICATION_LIMIT
  const applications = (truncated ? results.slice(0, APPLICATION_LIMIT) : results).map((r) => {
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
      // 보관된 방은 서명할 수 없다. 이것을 넘기지 않으면 잠긴 계약서를 두고
      // "확인하고 서명해주세요"라고 재촉하게 된다.
      roomArchived: !!r.room_archived_at,
      roomTitle: r.room_title,
      signedAt: r.signed_at,
      lookupCode: r.lookup_code,
    }
    return { ...base, progress: describeApplicationProgress(base) }
  })

  return { applications: sortMyApplications(applications), truncated, limit: APPLICATION_LIMIT }
}
