export class VideoServiceConfigError extends Error {
  constructor(missing) {
    super(`Supabase 화상 면접 설정이 없습니다: ${missing.join(', ')}`)
    this.name = 'VideoServiceConfigError'
    this.missing = missing
  }
}

export class VideoServiceError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'VideoServiceError'
    this.status = status
  }
}

function firstKey(value) {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value)
    return String(parsed.default || Object.values(parsed)[0] || '').trim()
  } catch {
    return ''
  }
}

function publicKey(env) {
  return String(
    env?.SUPABASE_PUBLISHABLE_KEY ||
      env?.SUPABASE_ANON_KEY ||
      firstKey(env?.SUPABASE_PUBLISHABLE_KEYS)
  ).trim()
}


export function getSupabaseRealtimeConfig(env) {
  const projectUrl = String(env?.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const publishableKey = publicKey(env)
  const missing = []
  if (!projectUrl) missing.push('SUPABASE_URL')
  if (!publishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY')
  if (missing.length) throw new VideoServiceConfigError(missing)
  return { projectUrl, publishableKey }
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function createMeeting() {
  return Promise.resolve({ id: crypto.randomUUID() })
}

async function broadcastControl(env, meetingId, event, payload = {}) {
  if (!env.DB) throw new VideoServiceConfigError(['DB'])
  const session = await env.DB.prepare('SELECT id FROM interview_sessions WHERE provider_meeting_id = ?').bind(meetingId).first()
  if (!session) throw new VideoServiceError('회의를 찾을 수 없습니다.', 404)
  if (event === 'meeting-ended') {
    await env.DB.prepare("UPDATE interview_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?").bind(session.id).run()
  }
  const ids = payload.customParticipantIds || []
  const scoped = event === 'participants-kicked'
  await env.DB.prepare(`UPDATE interview_session_members SET provider_participant_id = NULL,
    signaling_seen_at = NULL, admitted_at = NULL, left_at = datetime('now')
    WHERE session_id = ?${scoped ? ' AND (custom_participant_id IN (' + ids.map(() => '?').join(',') + ') OR provider_participant_id IN (' + ids.map(() => '?').join(',') + '))' : ''}`)
    .bind(session.id, ...(scoped ? [...ids, ...ids] : [])).run()
}

export async function closeMeeting(env, { meetingId }) {
  await broadcastControl(env, meetingId, 'meeting-ended')
  return { id: meetingId, status: 'ended' }
}

export async function kickParticipants(env, { meetingId, customParticipantIds }) {
  if (!Array.isArray(customParticipantIds) || customParticipantIds.length === 0) {
    throw new TypeError('퇴장시킬 참가자가 없습니다.')
  }
  await broadcastControl(env, meetingId, 'participants-kicked', { customParticipantIds })
  return { success: true }
}

export async function kickAllParticipants(env, { meetingId }) {
  await broadcastControl(env, meetingId, 'all-participants-kicked')
  return { success: true }
}

export function deleteParticipant(env, { meetingId, customParticipantId, participantId }) {
  return kickParticipants(env, {
    meetingId,
    customParticipantIds: [customParticipantId || participantId],
  })
}

export function issueParticipantCredentials(
  env,
  { meetingId, participantId, customParticipantId, role, displayName }
) {
  const config = getSupabaseRealtimeConfig(env)
  return {
    projectUrl: config.projectUrl,
    transport: 'authenticated-api',
    authToken: randomToken(),
    meetingId,
    participantId,
    customParticipantId,
    role,
    displayName,
  }
}

export function isMeetingAlreadyEnded(error) {
  return error instanceof VideoServiceError && [404, 409].includes(error.status)
}

export async function controlRecording(_env, { recordingId, action }) {
  if (!['pause', 'resume', 'stop'].includes(action)) {
    throw new TypeError('지원하지 않는 녹화 제어입니다.')
  }
  return {
    id: recordingId,
    status: { pause: 'PAUSED', resume: 'RECORDING', stop: 'UPLOADING' }[action],
    stopped_time: action === 'stop' ? new Date().toISOString() : null,
  }
}
