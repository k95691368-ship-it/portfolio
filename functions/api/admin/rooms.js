import { jsonResponse } from '../../_lib/http.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.title, r.invite_code, r.status, r.created_at,
       (SELECT u.display_name FROM room_participants rp JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = r.id AND rp.role_in_room = 'company') AS company_name,
       (SELECT u.display_name FROM room_participants rp JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = r.id AND rp.role_in_room = 'candidate') AS candidate_name
     FROM interview_rooms r
     ORDER BY r.created_at DESC`
  ).all()

  return jsonResponse({
    rooms: results.map((r) => ({
      id: r.id,
      title: r.title,
      inviteCode: r.invite_code,
      status: r.status,
      companyName: r.company_name,
      candidateName: r.candidate_name,
      createdAt: r.created_at,
    })),
  })
}
