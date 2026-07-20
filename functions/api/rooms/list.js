import { jsonResponse, jsonError } from '../../_lib/http.js'

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
          WHERE rp2.room_id = r.id AND rp2.role_in_room = 'candidate') AS candidate_name
     FROM interview_rooms r
     JOIN room_participants rp ON rp.room_id = r.id
     WHERE rp.user_id = ?
     ORDER BY r.created_at DESC`
  )
    .bind(data.user.id)
    .all()

  const rooms = results.map((r) => ({
    id: r.id,
    title: r.title,
    inviteCode: r.invite_code,
    status: r.status,
    createdAt: r.created_at,
    companyName: r.company_name,
    candidateName: r.candidate_name,
  }))

  return jsonResponse({ rooms })
}
