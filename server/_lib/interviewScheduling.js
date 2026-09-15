import { getRoomForInterview, getInterviewSessionAccess, InterviewAccessError } from './interviews.js'
import { jsonError } from './http.js'

export function normalizeDuration(value = 30) {
  if (![15, 30, 45, 60, 90, 120].includes(value)) throw new TypeError('면접 시간은 15·30·45·60·90·120분 중 선택해주세요.')
  return value
}

export function futureSlot(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new TypeError('시간대가 포함된 면접 일시를 입력해주세요.')
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new TypeError('올바른 날짜를 입력해주세요.')
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp) || stamp <= now || stamp > now + 180 * 86400000) throw new TypeError('현재 이후부터 180일 이내의 시간을 선택해주세요.')
  return new Date(stamp).toISOString()
}

// Every scheduling write, including the existing host-only paths, uses the same
// company-scoped transaction lock. Availability checks and inserts cannot race.
export async function withScheduleLock(context, operation, { sessionAccess = false } = {}) {
  try {
    const authorize = env => sessionAccess
      ? getInterviewSessionAccess(env, context.params.roomId, context.params.sessionId, context.data.user, { allowAdminRead: false })
      : getRoomForInterview(env, context.params.roomId, context.data.user, { allowAdminRead: false })
    const access = await authorize(context.env)
    const execute = async (DB) => {
      const env = { ...context.env, DB }
      const freshAccess = await authorize(env)
      return operation({ ...context, env, scheduleAccess: freshAccess })
    }
    if (context.env.DB.withRateLimitLock) {
      return await context.env.DB.withRateLimitLock(`interview-schedule:${access.room.company_user_id}`, execute)
    }
    return await execute(context.env.DB)
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }
}

export async function findScheduleConflict(env, companyId, startsAt, duration, exceptSession = '') {
  if (!startsAt) return null
  const endsAt = new Date(Date.parse(startsAt) + duration * 60000).toISOString()
  return env.DB.prepare(`SELECT s.id FROM interview_sessions s
    JOIN interview_rooms r ON r.id = s.room_id
    WHERE r.company_user_id = ? AND s.id <> ? AND s.status IN ('scheduled','waiting','live')
      AND datetime(s.scheduled_at) < datetime(?)
      AND datetime(s.scheduled_at, '+' || s.duration_minutes || ' minutes') > datetime(?) LIMIT 1`)
    .bind(companyId, exceptSession, endsAt, startsAt).first()
}

export async function getSelectableSlot(env, companyId, id, exceptSession = '') {
  if (typeof id !== 'string' || id.length > 100) throw new InterviewAccessError('선택할 시간을 확인해주세요.', 400)
  const slot = await env.DB.prepare('SELECT * FROM interview_slots WHERE id = ? AND company_user_id = ? AND active = 1').bind(id, companyId).first()
  if (!slot || Date.parse(slot.starts_at) <= Date.now()) throw new InterviewAccessError('선택할 수 없는 시간입니다. 목록을 새로고침해주세요.', 409)
  if (await findScheduleConflict(env, companyId, slot.starts_at, slot.duration_minutes, exceptSession)) {
    throw new InterviewAccessError('이미 예약된 시간입니다. 다른 시간을 선택해주세요.', 409)
  }
  return slot
}
