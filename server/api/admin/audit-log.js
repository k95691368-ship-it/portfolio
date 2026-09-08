import { jsonResponse } from '../../_lib/http.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.action, l.detail, l.created_at,
            actor.email AS actor_email,
            target.email AS target_email,
            room.title AS room_title
     FROM admin_audit_log l
     JOIN users actor ON actor.id = l.actor_user_id
     LEFT JOIN users target ON target.id = l.target_user_id
     LEFT JOIN interview_rooms room ON room.id = l.target_room_id
     ORDER BY l.id DESC
     LIMIT 200`
  ).all()

  return jsonResponse({
    entries: results.map((r) => ({
      id: r.id,
      action: r.action,
      detail: r.detail,
      actorEmail: r.actor_email,
      targetEmail: r.target_email,
      roomTitle: r.room_title,
      createdAt: r.created_at,
    })),
  })
}
