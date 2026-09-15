import { genId } from '../../../_lib/db.js'
import { jsonError, jsonResponse } from '../../../_lib/http.js'
import { getRoomForInterview, InterviewAccessError } from '../../../_lib/interviews.js'
import { blockedWhenFrozen } from '../../../_lib/roomLifecycle.js'
import { withScheduleLock, futureSlot, normalizeDuration } from '../../../_lib/interviewScheduling.js'

export async function onRequestGet({ env, data, params }) {
  let access
  try { access = await getRoomForInterview(env, params.roomId, data.user, { allowAdminRead: false }) }
  catch (error) { if (error instanceof InterviewAccessError) return jsonError(error.message, error.status); throw error }
  const { results } = await env.DB.prepare(`SELECT slot.id, slot.starts_at, slot.duration_minutes, slot.recording_required,
    CASE WHEN EXISTS (SELECT 1 FROM interview_sessions s JOIN interview_rooms r ON r.id = s.room_id
      WHERE r.company_user_id = slot.company_user_id AND s.status IN ('scheduled','waiting','live')
        AND datetime(s.scheduled_at) < datetime(slot.starts_at, '+' || slot.duration_minutes || ' minutes')
        AND datetime(s.scheduled_at, '+' || s.duration_minutes || ' minutes') > datetime(slot.starts_at)) THEN 0 ELSE 1 END AS available
    FROM interview_slots slot WHERE slot.company_user_id = ? AND slot.active = 1
      AND datetime(slot.starts_at) > datetime('now') ORDER BY slot.starts_at LIMIT 100`)
    .bind(access.room.company_user_id).all()
  return jsonResponse({ slots: results.map(row => ({ id: row.id, startsAt: row.starts_at, durationMinutes: row.duration_minutes, recordingRequired: row.recording_required === 1, available: row.available === 1 })) })
}

async function mutate({ request, env, data, scheduleAccess: access }) {
  if (access.room.company_user_id !== data.user.id) return jsonError('가능한 시간은 담당자만 등록하거나 철회할 수 있습니다.', 403)
  const frozen = blockedWhenFrozen(access.room, 'edit_interview')
  if (frozen) return jsonError(frozen, 409)
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('요청 내용을 확인해주세요.', 400)
  if (request.method === 'DELETE') {
    if (typeof body.id !== 'string' || body.id.length > 100) return jsonError('시간을 선택해주세요.', 400)
    const result = await env.DB.prepare(`UPDATE interview_slots SET active = 0 WHERE id = ? AND company_user_id = ? AND active = 1
      AND NOT EXISTS (SELECT 1 FROM interview_sessions WHERE booking_slot_id = interview_slots.id AND status IN ('scheduled','waiting','live'))`)
      .bind(body.id, data.user.id).run()
    return result.meta.changes ? jsonResponse({ withdrawn: true }) : jsonError('예약된 시간이거나 철회할 수 없는 시간입니다.', 409)
  }
  let startsAt, duration
  try { startsAt = futureSlot(body.startsAt); duration = normalizeDuration(body.durationMinutes) }
  catch (error) { return jsonError(error.message, 400) }
  if (typeof body.recordingRequired !== 'boolean') return jsonError('녹화 여부를 선택해주세요.', 400)
  const endsAt = new Date(Date.parse(startsAt) + duration * 60000).toISOString()
  const overlap = await env.DB.prepare(`SELECT id FROM interview_slots WHERE company_user_id = ? AND active = 1
    AND datetime(starts_at) < datetime(?) AND datetime(starts_at, '+' || duration_minutes || ' minutes') > datetime(?) LIMIT 1`)
    .bind(data.user.id, endsAt, startsAt).first()
  if (overlap) return jsonError('이미 등록한 시간과 겹칩니다.', 409)
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM interview_slots WHERE company_user_id = ? AND active = 1 AND datetime(starts_at) > datetime('now')").bind(data.user.id).first()
  if (count.n >= 100) return jsonError('예정 시간은 최대 100개까지 등록할 수 있습니다.', 409)
  const id = genId()
  await env.DB.prepare('INSERT INTO interview_slots (id, company_user_id, starts_at, duration_minutes, recording_required) VALUES (?, ?, ?, ?, ?)')
    .bind(id, data.user.id, startsAt, duration, body.recordingRequired ? 1 : 0).run()
  return jsonResponse({ id }, 201)
}
export const onRequestPost = context => withScheduleLock(context, mutate)
export const onRequestDelete = context => withScheduleLock(context, mutate)
