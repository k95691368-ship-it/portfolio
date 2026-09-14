import { CONSENT_NOTICE_HASH, CONSENT_NOTICE_VERSION } from './interviews.js'

// Keep ordering aligned with the time-range index so LIMIT does not encourage
// PostgreSQL to scan old primary-key entries looking for a recent message.
export const SIGNAL_INBOX_SQL = `SELECT id, sender_id, payload FROM interview_signals
  WHERE session_id = ? AND recipient_id = ? AND created_at > datetime('now', '-30 seconds')
  ORDER BY created_at, id LIMIT 600`

// Identity, admission, consent and role are read from the database on every
// exchange. No public Realtime presence/broadcast data is trusted.
export async function activeSignalMembers(db, roomId, sessionId) {
  const { results } = await db.prepare(`SELECT m.user_id, m.provider_participant_id,
      m.custom_participant_id, m.role, m.signaling_seen_at, u.display_name, s.huddle_active
    FROM interview_session_members m
    JOIN interview_sessions s ON s.id = m.session_id
    JOIN interview_rooms r ON r.id = s.room_id
    JOIN users u ON u.id = m.user_id
    LEFT JOIN interview_recording_consents c ON c.session_id = m.session_id AND c.user_id = m.user_id
    WHERE s.id = ? AND s.room_id = ? AND s.status IN ('scheduled','waiting','live')
      AND r.archived_at IS NULL AND r.status IN ('open','active','contract_pending')
      AND u.is_suspended = 0 AND m.admitted_at IS NOT NULL AND m.left_at IS NULL
      AND m.provider_participant_id IS NOT NULL
      AND (s.recording_required = 0 OR (c.granted = 1 AND c.revoked_at IS NULL
        AND c.notice_version = ? AND c.notice_hash = ?))`)
    .bind(sessionId, roomId, CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH).all()
  return results || []
}

export const isInterviewStaff = (member) => ['host', 'interviewer'].includes(member?.role)

export function validateSignal(body, self, members) {
  if (body.action === 'heartbeat' || body.action === 'leave') return null
  if (body.action !== 'send') return '지원하지 않는 신호입니다.'
  if (body.event === 'huddle') return isInterviewStaff(self) && typeof body.payload?.active === 'boolean'
    ? null : '면접관만 귓속말 모드를 변경할 수 있습니다.'
  if (body.event !== 'signal') return '클라이언트는 회의 제어 신호를 발행할 수 없습니다.'
  const payload = body.payload
  if (!members.some((m) => m.provider_participant_id === payload?.to && m.user_id !== self.user_id)) return '수신자가 입장 중이 아닙니다.'
  if (payload?.description) {
    if (!['offer', 'answer'].includes(payload.description.type) || typeof payload.description.sdp !== 'string' || payload.description.sdp.length > 60000) return '잘못된 연결 정보입니다.'
  } else if (!payload?.candidate || typeof payload.candidate.candidate !== 'string' || payload.candidate.candidate.length > 4096) return '잘못된 ICE 정보입니다.'
  return null
}
