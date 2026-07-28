import { jsonResponse, jsonError } from '../../_lib/http.js'
import { describeContractPeriod } from '../../_lib/contractPeriod.js'

export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

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
    .bind(data.user.id, data.user.id)
    .all()

  const rooms = results.map((r) => {
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

  return jsonResponse({ rooms })
}
