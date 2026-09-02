import { getRoomAccess } from './rooms.js'

export const CONSENT_NOTICE_VERSION = '2026-09-02.v1'
export const CONSENT_NOTICE_HASH =
  'a183895684472837714d686ebabee14034664f409d4ddc9321b747d96b17d2f9'

export const CONSENT_NOTICE = Object.freeze({
  version: CONSENT_NOTICE_VERSION,
  hash: CONSENT_NOTICE_HASH,
  purpose: '화상 면접 진행 사실 확인 및 채용 절차 기록',
  items: '면접 중 영상, 음성, 화면 공유 화면, 참가자 표시 이름',
  retention: '녹화 종료일부터 30일',
  refusalEffect:
    '녹화에 동의하지 않으면 녹화가 필수인 화상 면접에 입장할 수 없습니다.',
})

export class InterviewAccessError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'InterviewAccessError'
    this.status = status
  }
}

export function roleFromRoomRole(role) {
  if (role === 'company') return 'host'
  if (role === 'candidate') return 'candidate'
  return null
}

function videoRoleFromRoomAccess(room, user, roomRole) {
  if (roomRole === 'company') {
    return user.id === room.company_user_id ? 'host' : 'interviewer'
  }
  return roleFromRoomRole(roomRole)
}

export function presetForRole(env, role) {
  const configured = configuredPresetForRole(env, role)
  if (configured) return configured
  return role === 'host' ? 'group_call_host' : 'group_call_participant'
}

export function configuredPresetForRole(env, role) {
  const configured = {
    host: env?.REALTIMEKIT_HOST_PRESET,
    interviewer: env?.REALTIMEKIT_INTERVIEWER_PRESET,
    candidate: env?.REALTIMEKIT_CANDIDATE_PRESET,
    observer: env?.REALTIMEKIT_OBSERVER_PRESET,
  }[role]
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  return null
}

export function mapProviderSessionStatus(status) {
  const value = String(status ?? '').toUpperCase()
  if (value === 'LIVE') return 'live'
  if (value === 'ENDED') return 'ended'
  if (value === 'CANCELLED' || value === 'CANCELED') return 'cancelled'
  return null
}

export function mapProviderRecordingStatus(status) {
  const value = String(status ?? '').toUpperCase()
  return {
    INVOKED: 'starting',
    RECORDING: 'recording',
    PAUSED: 'paused',
    UPLOADING: 'processing',
    UPLOADED: 'available',
    ERRORED: 'failed',
  }[value] ?? null
}

export function normalizeProviderRecording(recording) {
  if (!recording || typeof recording !== 'object') return null
  const nested = recording.recording || recording.data?.recording
  const source = nested && typeof nested === 'object' ? nested : recording
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return {
    providerRecordingId: source.recordingId || source.recording_id || source.id || null,
    providerSessionId: source.sessionId || source.session_id || source.roomUUID || null,
    meetingId: source.meetingId || source.meeting_id || null,
    status: mapProviderRecordingStatus(source.status),
    downloadUrl: source.downloadUrl || source.download_url || null,
    downloadUrlExpiresAt:
      source.downloadUrlExpiry || source.download_url_expiry || null,
    sizeBytes: numberOrNull(source.fileSize ?? source.file_size),
    durationSeconds: numberOrNull(
      source.recordingDuration ?? source.recording_duration
    ),
    filename: source.outputFileName || source.output_file_name || null,
    startedAt: source.startedTime || source.started_time || null,
    stoppedAt: source.stoppedTime || source.stopped_time || null,
  }
}

export function consentIsCurrent(row) {
  return !!(
    row &&
    Number(row.granted) === 1 &&
    row.notice_version === CONSENT_NOTICE_VERSION &&
    row.notice_hash === CONSENT_NOTICE_HASH &&
    !row.revoked_at
  )
}

export function serializeRecording(row) {
  if (!row) return null
  const expired = retentionHasExpired(row.retention_until)
  return {
    id: row.id,
    status: expired ? 'deleted' : row.status,
    storageStatus: expired ? 'deleted' : row.storage_status ?? 'pending',
    filename: row.filename ?? null,
    sizeBytes: row.size_bytes ?? null,
    durationSeconds: row.duration_seconds ?? null,
    startedAt: row.started_at ?? null,
    stoppedAt: row.stopped_at ?? null,
    retentionUntil: row.retention_until ?? null,
    available:
      !expired && row.status === 'available' && !!(row.r2_key || row.provider_download_url),
    expired,
    failureReason: row.status === 'failed' ? row.failure_reason ?? null : null,
  }
}

export function serializeInterviewMember(member) {
  return {
    userId: member.user_id,
    customParticipantId: member.custom_participant_id,
    displayName: member.display_name,
    role: member.role,
    admittedAt: member.admitted_at ?? null,
    joinedAt: member.joined_at ?? null,
    leftAt: member.left_at ?? null,
    consentGranted: Number(member.consent_granted) === 1,
  }
}

export function retentionHasExpired(value, now = Date.now()) {
  if (!value) return false
  const normalized = String(value).replace(' ', 'T')
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const expiresAt = Date.parse(hasZone ? normalized : `${normalized}Z`)
  // 만료 값이 있는데 읽지 못하면 영구 제공하지 않고 닫는 쪽으로 실패한다.
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

export function serializeSession(row, { members = [], recordings = [] } = {}) {
  const myRole = row.my_role ?? null
  const serializedRecordings = recordings.map(serializeRecording)
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    status: row.status,
    scheduledAt: row.scheduled_at ?? null,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    recordingRequired: Number(row.recording_required) === 1,
    viewerUserId: row.viewer_user_id ?? null,
    myRole,
    myConsentDecided: Number(row.my_consent_decided) === 1,
    myConsentGranted: Number(row.my_consent_granted) === 1,
    canManage: myRole === 'host',
    consentNotice: CONSENT_NOTICE,
    participantCount: Number(row.participant_count ?? members.length ?? 0),
    consentedCount: Number(row.consented_count ?? 0),
    members: members.map(serializeInterviewMember),
    recordings: serializedRecordings,
    currentRecording:
      serializedRecordings.find((recording) =>
        ['starting', 'recording', 'paused', 'stopping', 'processing'].includes(recording.status)
      ) ?? serializedRecordings[0] ?? null,
  }
}

export async function getRoomForInterview(env, roomId, user, { allowAdminRead = true } = {}) {
  if (!user) throw new InterviewAccessError('로그인이 필요합니다.', 401)
  const room = await env.DB.prepare(
    'SELECT id, company_user_id, title, status, archived_at FROM interview_rooms WHERE id = ?'
  )
    .bind(roomId)
    .first()
  if (!room) throw new InterviewAccessError('면접방을 찾을 수 없습니다.', 404)

  if (user.is_admin && !allowAdminRead) {
    throw new InterviewAccessError('관리자는 화상 면접에 참여할 수 없습니다.', 403)
  }
  const access = await getRoomAccess(env, roomId, user)
  if (!access) throw new InterviewAccessError('이 면접방에 참여하지 않았습니다.', 403)
  if (access.role_in_room === 'admin' && !allowAdminRead) {
    throw new InterviewAccessError('관리자는 화상 면접에 참여할 수 없습니다.', 403)
  }
  return {
    room,
    roomRole: access.role_in_room,
    videoRole: videoRoleFromRoomAccess(room, user, access.role_in_room),
  }
}

// 일반 면접방 권한은 늘리지 않고 이 화상 세션에 등록된 계정만 추가로 통과시킨다.
// 이 함수는 session detail/consent/join/recording 경로에서만 사용한다.
export async function getInterviewSessionAccess(
  env,
  roomId,
  sessionId,
  user,
  { allowAdminRead = true, allowRoomParticipant = true } = {}
) {
  if (!user) throw new InterviewAccessError('로그인이 필요합니다.', 401)
  const row = await env.DB.prepare(
    `SELECT r.id, r.company_user_id, r.title, r.status, r.archived_at,
            r.last_message_email_at,
            s.id AS interview_session_id, m.role AS video_role
       FROM interview_rooms r
       JOIN interview_sessions s ON s.room_id = r.id AND s.id = ?
       LEFT JOIN interview_session_members m ON m.session_id = s.id AND m.user_id = ?
      WHERE r.id = ?`
  )
    .bind(sessionId, user.id, roomId)
    .first()
  if (!row) throw new InterviewAccessError('화상 면접을 찾을 수 없습니다.', 404)
  if (user.is_admin) {
    if (!allowAdminRead) {
      throw new InterviewAccessError('관리자는 화상 면접에 참여할 수 없습니다.', 403)
    }
    return { room: row, roomRole: 'admin', videoRole: row.video_role ?? null }
  }
  if (row.video_role) {
    return { room: row, roomRole: null, videoRole: row.video_role }
  }
  if (allowRoomParticipant) {
    const access = await getRoomAccess(env, roomId, user)
    if (access && access.role_in_room !== 'admin') {
      return {
        room: row,
        roomRole: access.role_in_room,
        videoRole: videoRoleFromRoomAccess(row, user, access.role_in_room),
      }
    }
  }
  throw new InterviewAccessError('이 화상 면접의 참가자가 아닙니다.', 403)
}

export async function loadSessionForUser(env, roomId, sessionId, userId) {
  return env.DB.prepare(
    `SELECT s.*,
            mine.role AS my_role,
            mine.user_id AS viewer_user_id,
            CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS my_consent_decided,
            CASE WHEN c.granted = 1 AND c.notice_hash = ? AND c.revoked_at IS NULL THEN 1 ELSE 0 END AS my_consent_granted,
            (SELECT COUNT(*) FROM interview_session_members all_members WHERE all_members.session_id = s.id) AS participant_count,
            (SELECT COUNT(*)
               FROM interview_recording_consents all_consents
              WHERE all_consents.session_id = s.id
                AND all_consents.notice_version = ?
                AND all_consents.notice_hash = ?
                AND all_consents.granted = 1
                AND all_consents.revoked_at IS NULL) AS consented_count
       FROM interview_sessions s
       LEFT JOIN interview_session_members mine
         ON mine.session_id = s.id AND mine.user_id = ?
       LEFT JOIN interview_recording_consents c
         ON c.session_id = s.id AND c.user_id = ? AND c.notice_version = ?
      WHERE s.id = ? AND s.room_id = ?`
  )
    .bind(
      CONSENT_NOTICE_HASH,
      CONSENT_NOTICE_VERSION,
      CONSENT_NOTICE_HASH,
      userId,
      userId,
      CONSENT_NOTICE_VERSION,
      sessionId,
      roomId
    )
    .first()
}

export async function loadSessionsForUser(env, roomId, userId) {
  const { results } = await env.DB.prepare(
    `SELECT s.*,
            mine.role AS my_role,
            mine.user_id AS viewer_user_id,
            CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS my_consent_decided,
            CASE WHEN c.granted = 1 AND c.notice_hash = ? AND c.revoked_at IS NULL THEN 1 ELSE 0 END AS my_consent_granted,
            (SELECT COUNT(*) FROM interview_session_members all_members WHERE all_members.session_id = s.id) AS participant_count,
            (SELECT COUNT(*)
               FROM interview_recording_consents all_consents
              WHERE all_consents.session_id = s.id
                AND all_consents.notice_version = ?
                AND all_consents.notice_hash = ?
                AND all_consents.granted = 1
                AND all_consents.revoked_at IS NULL) AS consented_count
       FROM interview_sessions s
       LEFT JOIN interview_session_members mine
         ON mine.session_id = s.id AND mine.user_id = ?
       LEFT JOIN interview_recording_consents c
         ON c.session_id = s.id AND c.user_id = ? AND c.notice_version = ?
      WHERE s.room_id = ?
      ORDER BY COALESCE(s.scheduled_at, s.created_at) DESC, s.created_at DESC`
  )
    .bind(
      CONSENT_NOTICE_HASH,
      CONSENT_NOTICE_VERSION,
      CONSENT_NOTICE_HASH,
      userId,
      userId,
      CONSENT_NOTICE_VERSION,
      roomId
    )
    .all()
  return results || []
}

export async function loadSessionMembers(env, sessionId) {
  const { results } = await env.DB.prepare(
    `SELECT m.user_id, m.custom_participant_id, m.role, m.admitted_at, m.joined_at, m.left_at,
            u.display_name,
            CASE WHEN c.granted = 1 AND c.notice_hash = ? AND c.revoked_at IS NULL THEN 1 ELSE 0 END AS consent_granted
       FROM interview_session_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN interview_recording_consents c
         ON c.session_id = m.session_id AND c.user_id = m.user_id AND c.notice_version = ?
      WHERE m.session_id = ?
      ORDER BY CASE m.role WHEN 'host' THEN 0 WHEN 'interviewer' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END,
               m.created_at ASC`
  )
    .bind(CONSENT_NOTICE_HASH, CONSENT_NOTICE_VERSION, sessionId)
    .all()
  return results || []
}

export async function loadSessionRecordings(env, sessionId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM interview_recordings
      WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`
  )
    .bind(sessionId)
    .all()
  return results || []
}

export async function ensureSessionMember(env, sessionId, userId, role) {
  let member = await env.DB.prepare(
    'SELECT * FROM interview_session_members WHERE session_id = ? AND user_id = ?'
  )
    .bind(sessionId, userId)
    .first()
  if (member) return member
  if (!role) return null

  const customId = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_session_members
       (session_id, user_id, role, custom_participant_id)
     VALUES (?, ?, ?, ?)`
  )
    .bind(sessionId, userId, role, customId)
    .run()
  member = await env.DB.prepare(
    'SELECT * FROM interview_session_members WHERE session_id = ? AND user_id = ?'
  )
    .bind(sessionId, userId)
    .first()
  return member
}

export async function hasCurrentConsent(env, sessionId, userId) {
  const row = await env.DB.prepare(
    `SELECT granted, notice_version, notice_hash, revoked_at
       FROM interview_recording_consents
      WHERE session_id = ? AND user_id = ? AND notice_version = ?`
  )
    .bind(sessionId, userId, CONSENT_NOTICE_VERSION)
    .first()
  return consentIsCurrent(row)
}

export async function logInterviewEvent(
  env,
  { sessionId, eventType, actorUserId = null, details = null, occurredAt = null, providerEventId = null }
) {
  const id = providerEventId || crypto.randomUUID()
  await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_events
       (id, session_id, provider_event_id, event_type, actor_user_id, details_json, occurred_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      id,
      sessionId,
      providerEventId,
      eventType,
      actorUserId,
      details ? JSON.stringify(details) : null,
      occurredAt
    )
    .run()
}

export function clientAddress(request) {
  return (request.headers.get('CF-Connecting-IP') || '').slice(0, 64) || null
}

export function clientUserAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0, 500) || null
}

export function normalizeScheduledAt(value) {
  if (value === null || value === undefined || value === '') return null
  const stamp = new Date(value)
  if (!Number.isFinite(stamp.getTime())) {
    throw new TypeError('면접 일시를 확인해주세요.')
  }
  return stamp.toISOString()
}

export function normalizeTitle(value, fallback = '화상 면접') {
  const title = String(value ?? fallback).trim()
  if (!title) throw new TypeError('면접 제목을 입력해주세요.')
  if (title.length > 120) throw new TypeError('면접 제목은 120자 이하여야 합니다.')
  return title
}
