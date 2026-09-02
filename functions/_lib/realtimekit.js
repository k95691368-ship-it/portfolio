const API_ORIGIN = 'https://api.cloudflare.com/client/v4'

export class RealtimeKitConfigError extends Error {
  constructor(missing) {
    super(`RealtimeKit 설정이 없습니다: ${missing.join(', ')}`)
    this.name = 'RealtimeKitConfigError'
    this.missing = missing
  }
}

export class RealtimeKitApiError extends Error {
  constructor(message, status, providerCode = null) {
    super(message)
    this.name = 'RealtimeKitApiError'
    this.status = status
    this.providerCode = providerCode
  }
}

export function isRealtimeKitAlreadyEnded(error) {
  if (!(error instanceof RealtimeKitApiError)) return false
  if (error.status === 404) return true
  return (
    [400, 409].includes(error.status) &&
    /(\binactive\b|\bno active\b|\bnot active\b|\balready (?:been )?ended\b)/i.test(error.message)
  )
}

function required(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function getRealtimeKitConfig(env) {
  const config = {
    accountId: required(env?.CLOUDFLARE_ACCOUNT_ID),
    appId: required(env?.REALTIMEKIT_APP_ID),
    apiToken: required(env?.REALTIMEKIT_API_TOKEN),
  }
  const missing = []
  if (!config.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID')
  if (!config.appId) missing.push('REALTIMEKIT_APP_ID')
  if (!config.apiToken) missing.push('REALTIMEKIT_API_TOKEN')
  if (missing.length) throw new RealtimeKitConfigError(missing)
  return config
}

function providerMessage(payload, fallback) {
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : null
  return first?.message || payload?.message || fallback
}

export async function realtimeKitRequest(env, path, { method = 'GET', body } = {}) {
  const { accountId, appId, apiToken } = getRealtimeKitConfig(env)
  const base = `${API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/realtime/kit/${encodeURIComponent(appId)}`
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new RealtimeKitApiError('화상 면접 서비스에 연결할 수 없습니다.', 503)
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    // HTML 오류 페이지나 빈 응답을 그대로 노출하지 않는다.
  }

  if (!response.ok || payload?.success === false) {
    throw new RealtimeKitApiError(
      providerMessage(payload, '화상 면접 서비스 요청이 실패했습니다.'),
      response.status,
      payload?.errors?.[0]?.code ?? null
    )
  }
  if (!payload || payload.success !== true || payload.data === undefined) {
    throw new RealtimeKitApiError('화상 면접 서비스 응답 형식을 확인할 수 없습니다.', 502)
  }
  return payload.data
}

function meetingPath(meetingId, suffix = '') {
  return `/meetings/${encodeURIComponent(meetingId)}${suffix}`
}

export function createMeeting(env, { title }) {
  return realtimeKitRequest(env, '/meetings', {
    method: 'POST',
    body: {
      title,
      record_on_start: false,
      // 공개 채팅 정본은 D1에 남기고, 면접관 귓속말은 공급자에 장기 보관하지 않는다.
      persist_chat: false,
    },
  })
}

// RealtimeKit은 meeting DELETE를 제공하지 않는다. 고아 회의가 다시 열리지 않게
// 공식 Update Meeting API의 INACTIVE 상태로 비활성화한다.
export function deleteMeeting(env, { meetingId }) {
  return realtimeKitRequest(env, meetingPath(meetingId), {
    method: 'PATCH',
    body: { status: 'INACTIVE' },
  })
}

export function addParticipant(
  env,
  { meetingId, customParticipantId, presetName, name }
) {
  return realtimeKitRequest(env, meetingPath(meetingId, '/participants'), {
    method: 'POST',
    body: {
      custom_participant_id: customParticipantId,
      preset_name: presetName,
      ...(name ? { name } : {}),
    },
  }).then(normalizeParticipantToken)
}

export function refreshParticipantToken(env, { meetingId, participantId }) {
  return realtimeKitRequest(
    env,
    meetingPath(
      meetingId,
      `/participants/${encodeURIComponent(participantId)}/token`
    ),
    { method: 'POST' }
  ).then(normalizeParticipantToken)
}

function normalizeParticipantToken(data) {
  if (!data || typeof data !== 'object') return data
  return { ...data, token: data.authToken || data.auth_token || data.token || null }
}

export function listParticipants(env, { meetingId }) {
  return realtimeKitRequest(env, meetingPath(meetingId, '/participants?per_page=100'))
}

export function kickParticipants(env, { meetingId, customParticipantIds }) {
  if (!Array.isArray(customParticipantIds) || customParticipantIds.length === 0) {
    throw new TypeError('퇴장시킬 참가자가 없습니다.')
  }
  return realtimeKitRequest(env, meetingPath(meetingId, '/active-session/kick'), {
    method: 'POST',
    body: { custom_participant_ids: customParticipantIds },
  })
}

export function kickAllParticipants(env, { meetingId }) {
  return realtimeKitRequest(env, meetingPath(meetingId, '/active-session/kick-all'), {
    method: 'POST',
  })
}

export function deleteParticipant(env, { meetingId, participantId }) {
  return realtimeKitRequest(
    env,
    meetingPath(meetingId, `/participants/${encodeURIComponent(participantId)}`),
    { method: 'DELETE' }
  )
}

export function startRecording(env, { meetingId, fileNamePrefix }) {
  const prefix = String(fileNamePrefix || '').trim()
  if (!/^[A-Za-z0-9_]{1,100}$/.test(prefix)) {
    throw new TypeError('녹화 파일 접두사가 올바르지 않습니다.')
  }
  return realtimeKitRequest(env, '/recordings', {
    method: 'POST',
    body: {
      meeting_id: meetingId,
      allow_multiple_recordings: false,
      file_name_prefix: prefix,
      video_config: { codec: 'H264' },
    },
  })
}

export function controlRecording(env, { recordingId, action }) {
  if (!['pause', 'resume', 'stop'].includes(action)) {
    throw new TypeError('지원하지 않는 녹화 제어입니다.')
  }
  return realtimeKitRequest(env, `/recordings/${encodeURIComponent(recordingId)}`, {
    method: 'PUT',
    body: { action },
  })
}

export function getRecording(env, { recordingId }) {
  return realtimeKitRequest(env, `/recordings/${encodeURIComponent(recordingId)}`)
}
