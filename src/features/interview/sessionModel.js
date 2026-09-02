const SESSION_STATUS_LABELS = {
  draft: '준비 중',
  scheduled: '예정',
  waiting: '입장 대기',
  live: '진행 중',
  ended: '종료',
  cancelled: '취소',
  failed: '연결 실패',
}

const RECORDING_STATUS_ALIASES = {
  idle: 'idle',
  off: 'idle',
  not_started: 'idle',
  starting: 'starting',
  invoked: 'starting',
  recording: 'recording',
  active: 'recording',
  paused: 'paused',
  resuming: 'resuming',
  stopping: 'stopping',
  uploading: 'processing',
  processing: 'processing',
  uploaded: 'available',
  completed: 'available',
  available: 'available',
  failed: 'failed',
  errored: 'failed',
  deleted: 'deleted',
}

const RECORDING_STATUS_LABELS = {
  idle: '녹화 시작 전',
  starting: '녹화 시작 중',
  recording: '녹화 중',
  paused: '녹화 일시정지',
  resuming: '녹화 재개 중',
  stopping: '녹화 종료 중',
  processing: '녹화 처리 중',
  available: '녹화 완료',
  failed: '녹화 실패',
  deleted: '보관 기간 만료',
}

const CLOSED_SESSION_STATUSES = new Set(['ended', 'cancelled', 'failed'])

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function unwrapSession(payload) {
  if (!payload || typeof payload !== 'object') return null
  return payload.session ?? payload.interviewSession ?? payload.interview ?? payload
}

function normalizeConsentNotice(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    version: raw.version ?? null,
    hash: raw.hash ?? null,
    purpose: raw.purpose ?? '',
    items: Array.isArray(raw.items) ? raw.items.filter(Boolean) : raw.items ? [raw.items] : [],
    retention: raw.retention ?? '',
    refusalEffect: raw.refusalEffect ?? raw.refusal_effect ?? '',
  }
}

function normalizeConsent(raw, session) {
  const consent = firstDefined(raw, session.myConsent, session.consent, session.viewer?.consent)
  if (consent && typeof consent === 'object') {
    return {
      granted: firstDefined(consent.granted, consent.accepted, consent.consented),
      version: consent.version ?? null,
      hash: consent.hash ?? null,
    }
  }
  const granted = firstDefined(
    session.myConsentGranted,
    session.my_consent_granted,
    session.consentGranted,
    session.consent_granted
  )
  if (granted === true || granted === 1 || granted === '1' || granted === 'true') {
    return { granted: true }
  }
  // `false`만으로는 아직 선택하지 않음과 명시적 거절을 구분할 수 없다.
  // 서버가 동의 응답 존재 여부를 함께 줄 때만 거절 상태로 확정한다.
  const decided = firstDefined(session.myConsentDecided, session.my_consent_decided)
  return normalizeBoolean(decided, false) ? { granted: false } : null
}

function latestRecordingFromList(recordings) {
  if (!Array.isArray(recordings) || recordings.length === 0) return null
  return [...recordings].sort((a, b) => {
    const aTime = Date.parse(a?.startedAt ?? a?.started_at ?? a?.createdAt ?? a?.created_at ?? 0) || 0
    const bTime = Date.parse(b?.startedAt ?? b?.started_at ?? b?.createdAt ?? b?.created_at ?? 0) || 0
    return bTime - aTime
  })[0]
}

export function normalizeRecording(raw) {
  if (!raw || typeof raw !== 'object') {
    return { id: null, status: 'idle', label: RECORDING_STATUS_LABELS.idle }
  }
  const statusKey = String(raw.status ?? raw.state ?? 'idle').trim().toLowerCase().replaceAll('-', '_')
  const status = RECORDING_STATUS_ALIASES[statusKey] ?? 'idle'
  return {
    ...raw,
    id: raw.id ?? raw.recordingId ?? raw.providerRecordingId ?? null,
    status,
    label: RECORDING_STATUS_LABELS[status],
  }
}

export function normalizeSession(payload) {
  const session = unwrapSession(payload)
  if (!session) return null
  const id = firstDefined(session.id, session.sessionId, session.interviewSessionId)
  const status = String(session.status ?? 'scheduled').toLowerCase()
  const myRole = firstDefined(
    session.videoRole,
    session.viewerRole,
    session.participantRole,
    session.myRole,
    session.viewer?.role
  )
  const currentRecording = firstDefined(
    session.currentRecording,
    session.recording,
    latestRecordingFromList(session.recordings)
  )
  return {
    ...session,
    id: id == null ? '' : String(id),
    title: session.title || '화상 면접',
    status,
    statusLabel: SESSION_STATUS_LABELS[status] ?? status,
    scheduledAt: firstDefined(session.scheduledAt, session.scheduled_at),
    recordingRequired: normalizeBoolean(
      firstDefined(session.recordingRequired, session.recording_required),
      false
    ),
    providerConfigured: firstDefined(
      session.providerConfigured,
      session.provider_configured,
      session.provider?.configured
    ),
    myRole: myRole ? String(myRole).toLowerCase() : '',
    viewerUserId: firstDefined(
      session.viewerUserId,
      session.viewer_user_id,
      session.viewer?.userId
    ) ?? null,
    members: Array.isArray(session.members)
      ? session.members
          .filter((member) => member && typeof member === 'object')
          .map((member) => ({
            ...member,
            userId: firstDefined(member.userId, member.user_id) ?? null,
            customParticipantId:
              firstDefined(member.customParticipantId, member.custom_participant_id) ?? null,
            displayName: firstDefined(member.displayName, member.display_name) ?? '참가자',
            role: String(member.role ?? '').toLowerCase(),
          }))
      : [],
    recordings: Array.isArray(session.recordings)
      ? session.recordings.map(normalizeRecording)
      : [],
    canControlRecording: normalizeBoolean(
      firstDefined(
        session.permissions?.canControlRecording,
        session.canControlRecording,
        session.can_control_recording,
        session.canManage
      ),
      ['organizer', 'host', 'company'].includes(String(myRole ?? '').toLowerCase())
    ),
    consentNotice: normalizeConsentNotice(
      firstDefined(session.consentNotice, session.consent_notice)
    ),
    myConsent: normalizeConsent(null, session),
    recording: normalizeRecording(currentRecording),
  }
}

export function normalizeSessionList(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.sessions ?? payload?.interviews ?? payload?.items ?? []
  return rows.map((row) => normalizeSession(row)).filter((row) => row?.id)
}

export function isClosedInterviewStatus(status) {
  return CLOSED_SESSION_STATUSES.has(String(status ?? '').toLowerCase())
}

export function latestSession(payload) {
  const serverSelected = normalizeSession(payload?.latestSession)
  if (serverSelected?.id) return serverSelected
  const rows = normalizeSessionList(payload)
  return rows.sort((a, b) => {
    const aTime = Date.parse(a.scheduledAt ?? a.createdAt ?? a.created_at ?? 0) || 0
    const bTime = Date.parse(b.scheduledAt ?? b.createdAt ?? b.created_at ?? 0) || 0
    return bTime - aTime
  })[0] ?? null
}

export function hasCompleteConsentNotice(notice) {
  return Boolean(
    notice?.version &&
      notice?.hash &&
      notice?.purpose &&
      notice?.items?.length &&
      notice?.retention &&
      notice?.refusalEffect
  )
}

export function extractJoinCredentials(payload) {
  if (!payload || typeof payload !== 'object') return null
  const source = payload.participant ?? payload.credentials ?? payload
  const authToken = firstDefined(source.authToken, source.auth_token, source.token)
  if (!authToken || typeof authToken !== 'string') return null
  return {
    authToken,
    roomName: firstDefined(source.roomName, source.room_name, payload.roomName, payload.room_name),
  }
}

export function recordingActions(recording, required = true) {
  if (!required) return []
  const status = normalizeRecording(recording).status
  if (['idle', 'available', 'failed', 'deleted'].includes(status)) return ['start']
  if (status === 'recording') return ['pause', 'stop']
  if (status === 'paused') return ['resume', 'stop']
  return []
}

export function toScheduledIso(localValue) {
  if (!localValue) return null
  const date = new Date(localValue)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function formatScheduledAt(value) {
  if (!value) return '시간 미정'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '시간 미정'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function interviewPagePath(roomId, sessionId) {
  return `/rooms/${encodeURIComponent(roomId)}/interview/${encodeURIComponent(sessionId)}`
}

export function interviewerPagePath(roomId, sessionId) {
  return `${interviewPagePath(roomId, sessionId)}?identity=account`
}

export function recordingFilePath(
  roomId,
  sessionId,
  recordingId,
  download = false,
  identity = ''
) {
  const path = `/api/rooms/${encodeURIComponent(roomId)}/interviews/${encodeURIComponent(
    sessionId
  )}/recordings/${encodeURIComponent(recordingId)}/file`
  const params = new URLSearchParams()
  if (download) params.set('download', '1')
  if (identity === 'code' || identity === 'account') params.set('identity', identity)
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}`
}
