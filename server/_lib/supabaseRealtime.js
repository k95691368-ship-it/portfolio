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

function serviceKey(env) {
  return String(
    env?.SUPABASE_SERVICE_ROLE_KEY ||
      firstKey(env?.SUPABASE_SECRET_KEYS)
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
  const projectUrl = String(env?.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const key = serviceKey(env)
  if (!projectUrl || !key) return

  const response = await fetch(`${projectUrl}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          topic: `interview:${meetingId}`,
          event: 'control',
          private: false,
          payload: { event, ...payload },
        },
      ],
    }),
  }).catch(() => null)

  if (!response?.ok) {
    throw new VideoServiceError('화상 면접 제어 신호를 보내지 못했습니다.', response?.status || 503)
  }
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
    ...config,
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
